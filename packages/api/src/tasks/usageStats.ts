import type { ResponseJSON } from '@clickhouse/client';
import * as HyperDX from '@hyperdx/node-opentelemetry';
import os from 'os';
import winston from 'winston';

import * as clickhouse from '@/clickhouse';
import * as config from '@/config';
import Team from '@/models/team';
import User from '@/models/user';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    HyperDX.getWinstonTransport('info', {
      apiKey: '3f26ffad-14cf-4fb7-9dc9-e64fa0b84ee0', // hyperdx usage stats service api key
      baseUrl: 'https://in-otel.hyperdx.io/v1/logs',
      maxLevel: 'info',
      service: 'hyperdx-oss-usage-stats',
    } as any),
  ],
});

const getClickhouseTableSize = async () => {
  const rows = await clickhouse.client.query({
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
      AND database = 'default'
      AND (table = {table1: String} OR table = {table2: String} OR table = {table3: String})
      GROUP BY table
      ORDER BY rows DESC
    `,
    format: 'JSON',
    query_params: {
      table1: clickhouse.TableName.LogStream,
      table2: clickhouse.TableName.Rrweb,
      table3: clickhouse.TableName.Metric,
    },
  });
  const result = await rows.json<ResponseJSON<any>>();
  return result.data;
};

const healthChecks = async () => {
  const ping = async (url: string) => {
    try {
      const res = await fetch(url);
      return res.status === 200;
    } catch (err) {
      return false;
    }
  };

  const otelCollectorUrl = new URL(config.OTEL_EXPORTER_OTLP_ENDPOINT ?? '');

  const [pingOtelCollector, pingCH] = await Promise.all([
    otelCollectorUrl.hostname && otelCollectorUrl.protocol
      ? ping(`${otelCollectorUrl.protocol}//${otelCollectorUrl.hostname}:13133`)
      : Promise.resolve(null),
    ping(`${config.CLICKHOUSE_HOST}/ping`),
  ]);

  return {
    pingOtelCollector,
    pingCH,
  };
};

export default async () => {
  try {
    const nowInMs = Date.now();
    const [userCounts, team, chTables, servicesHealth] = await Promise.all([
      User.countDocuments(),
      Team.find(
        {},
        {
          _id: 1,
        },
      ).limit(1),
      getClickhouseTableSize(),
      healthChecks(),
    ]);
    const clusterId = team[0]?._id;
    logger.info({
      message: 'track-hyperdx-oss-usage-stats',
      clusterId,
      version: config.CODE_VERSION,
      userCounts,
      servicesHealth,
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
};
