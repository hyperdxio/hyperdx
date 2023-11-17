import os from 'os';
import url from 'url';

import winston from 'winston';
import { HyperDXWinston } from '@hyperdx/node-logger';

import * as clickhouse from '@/clickhouse';
import * as config from '@/config';
import Team from '@/models/team';
import User from '@/models/user';

import type { ResponseJSON } from '@clickhouse/client';

const hyperdxTransport = new HyperDXWinston({
  apiKey: '3f26ffad-14cf-4fb7-9dc9-e64fa0b84ee0', // hyperdx usage stats service api key
  baseUrl: 'https://in.hyperdx.io',
  maxLevel: 'info',
  service: 'hyperdx-oss-usage-stats',
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [hyperdxTransport],
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

  const ingestorUrl = url.parse(config.INGESTOR_API_URL ?? '');
  const otelCollectorUrl = url.parse(config.OTEL_EXPORTER_OTLP_ENDPOINT ?? '');
  const aggregatorUrl = url.parse(config.AGGREGATOR_API_URL ?? '');

  const [pingIngestor, pingOtelCollector, pingAggregator, pingMiner, pingCH] =
    await Promise.all([
      ingestorUrl.hostname && ingestorUrl.protocol
        ? ping(`${ingestorUrl.protocol}//${ingestorUrl.hostname}:8686/health`)
        : Promise.resolve(null),
      otelCollectorUrl.hostname && otelCollectorUrl.protocol
        ? ping(
            `${otelCollectorUrl.protocol}//${otelCollectorUrl.hostname}:13133`,
          )
        : Promise.resolve(null),
      aggregatorUrl.href
        ? ping(`${aggregatorUrl.href}health`)
        : Promise.resolve(null),
      ping(`${config.MINER_API_URL}/health`),
      ping(`${config.CLICKHOUSE_HOST}/ping`),
    ]);

  return {
    pingIngestor,
    pingOtelCollector,
    pingAggregator,
    pingMiner,
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
