import type { ResponseJSON } from '@clickhouse/client';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse';
import * as HyperDX from '@hyperdx/node-opentelemetry';
import ms from 'ms';
import os from 'os';
import winston from 'winston';

import { MetricsDataType, SourceKind } from '@/../../common-utils/dist/types';
import * as config from '@/config';
import Connection from '@/models/connection';
import { Source, SourceDocument } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    HyperDX.getWinstonTransport('info', {
      headers: {
        Authorization: '3f26ffad-14cf-4fb7-9dc9-e64fa0b84ee0', // hyperdx usage stats service api key
      },
      baseUrl: 'https://in-otel.hyperdx.io/v1/logs',
      maxLevel: 'info',
      service: 'hyperdx-oss-usage-stats',
    }),
  ],
});

function extractTableNames(source: SourceDocument): string[] {
  const tables: string[] = [];
  if (source.kind === SourceKind.Metric) {
    for (const key of Object.values(MetricsDataType)) {
      const metricTable = source.metricTables?.[key];
      if (!metricTable) continue;
      tables.push(metricTable);
    }
  } else {
    tables.push(source.from.tableName);
  }
  return tables;
}

const getClickhouseTableSize = async () => {
  // fetch mongo data
  const connections = await Connection.find();
  const sources = await Source.find();

  // build map for each db instance
  const distributedTableMap = new Map<string, string[]>();
  for (const source of sources) {
    const key = `${source.connection.toString()},${source.from.databaseName}`;
    if (distributedTableMap.has(key)) {
      distributedTableMap.get(key)?.push(...extractTableNames(source));
    } else {
      distributedTableMap.set(key, extractTableNames(source));
    }
  }

  // fetch usage data
  const results: any[] = [];
  for (const [key, tables] of distributedTableMap) {
    const [connectionId, dbName] = key.split(',');
    const tableListString = tables
      .map((_, idx) => `table = {table${idx}: String}`)
      .join(' OR ');
    const query_params = tables.reduce(
      (acc, table, idx) => {
        acc[`table${idx}`] = table;
        return acc;
      },
      {} as { [key: string]: string },
    );
    query_params.dbName = dbName;

    // find connection
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) continue;

    // query clickhouse
    try {
      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });
      const _rows = await clickhouseClient.query({
        query: `
        SELECT
            table,
            sum(bytes) AS size,
            sum(rows) AS rows,
            min(min_time) AS min_time,
            max(max_time) AS max_time,
            max(modification_time) AS latestModification,
            toUInt32((max_time - min_time) / 86400) AS days,
            size / ((max_time - min_time) / 86400) AS avgDaySize
        FROM system.parts
        WHERE active
        AND database = {dbName: String}
        AND (${tableListString})
        GROUP BY table
        ORDER BY rows DESC
      `,
        format: 'JSON',
        query_params,
      });
      const res = await _rows.json<ResponseJSON<any>>();
      results.push(...res.data);
    } catch (error) {
      // ignore
    }
  }
  return results;
};

async function getUsageStats() {
  try {
    const nowInMs = Date.now();
    const [userCounts, team, chTables] = await Promise.all([
      User.countDocuments(),
      Team.find(
        {},
        {
          _id: 1,
        },
      ).limit(1),
      getClickhouseTableSize(),
    ]);
    const clusterId = team[0]?._id;
    logger.info({
      message: 'track-hyperdx-oss-usage-stats',
      clusterId,
      version: config.CODE_VERSION,
      userCounts,
      os: {
        arch: os.arch(),
        freemem: os.freemem(),
        uptime: os.uptime(),
      },
      chStats: {
        tables: chTables.reduce(
          (acc, curr) => ({
            ...acc,
            [curr.table]: {
              avgDaySize: parseInt(curr.avgDaySize),
              days: parseInt(curr.days),
              lastModified: new Date(curr.latestModification).getTime(),
              maxTime: new Date(curr.max_time).getTime(),
              minTime: new Date(curr.min_time).getTime(),
              rows: parseInt(curr.rows),
              size: parseInt(curr.size),
            },
          }),
          {},
        ),
        rows: chTables.reduce((acc, curr) => acc + parseInt(curr.rows), 0),
        size: chTables.reduce((acc, curr) => acc + parseInt(curr.size), 0),
      },
      timestamp: nowInMs,
    });
  } catch (err) {
    // ignore
  }
}

export default function () {
  void getUsageStats();
  setInterval(() => {
    void getUsageStats();
  }, ms('4h'));
}
