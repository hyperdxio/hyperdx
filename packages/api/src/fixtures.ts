import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  AlertThresholdType,
  BuilderSavedChartConfig,
  DisplayType,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  Tile,
} from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import ms from 'ms';
import request from 'supertest';

import * as config from '@/config';
import { AlertInput } from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import { findUserByEmail } from '@/controllers/user';
import { mongooseConnection } from '@/models';
import { AlertInterval, AlertSource } from '@/models/alert';
import Server from '@/server';
import logger from '@/utils/logger';
import { MetricModel } from '@/utils/logParser';

import { ExternalDashboardTile } from './utils/zod';

const MOCK_USER = {
  email: 'fake@deploysentinel.com',
  password: 'TacoCat!2#4X',
};

export const DEFAULT_DATABASE = 'default';
export const DEFAULT_LOGS_TABLE = 'otel_logs';
export const DEFAULT_TRACES_TABLE = 'otel_traces';
export const DEFAULT_METRICS_TABLE = {
  GAUGE: 'otel_metrics_gauge',
  SUM: 'otel_metrics_sum',
  HISTOGRAM: 'otel_metrics_histogram',
  SUMMARY: 'otel_metrics_summary',
  EXPONENTIAL_HISTOGRAM: 'otel_metrics_exponential_histogram',
};

let clickhouseClient: any;

export const getTestFixtureClickHouseClient = async () => {
  if (!clickhouseClient) {
    clickhouseClient = createNativeClient({
      url: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
      request_timeout: ms('1m'),
      compression: {
        request: false,
        response: false, // has to be off to enable streaming
      },
      clickhouse_settings: {
        connect_timeout: ms('1m') / 1000,
        date_time_output_format: 'iso',
        max_download_buffer_size: (10 * 1024 * 1024).toString(), // default
        max_download_threads: 32,
        max_execution_time: ms('2m') / 1000,
      },
    });
  }
  return clickhouseClient;
};

const healthCheck = async () => {
  const client = await getTestFixtureClickHouseClient();
  const result = await client.ping();
  if (!result.success) {
    logger.error({ error: result.error }, 'ClickHouse health check failed');
    throw result.error;
  }
};

const REQUIRED_TABLES = [
  DEFAULT_LOGS_TABLE,
  DEFAULT_TRACES_TABLE,
  DEFAULT_METRICS_TABLE.GAUGE,
  DEFAULT_METRICS_TABLE.SUM,
  DEFAULT_METRICS_TABLE.HISTOGRAM,
  DEFAULT_METRICS_TABLE.SUMMARY,
  DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM,
];

const waitForClickhouseSchema = async () => {
  await healthCheck();

  const client = await getTestFixtureClickHouseClient();
  const maxWaitMs = 30_000;
  const pollIntervalMs = 500;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const result = await client
      .query({
        query: `SELECT name FROM system.tables WHERE database = '${DEFAULT_DATABASE}'`,
        format: 'JSONEachRow',
      })
      .then((res: any) => res.json());

    const existingTables = new Set(result.map((row: any) => row.name));
    const missing = REQUIRED_TABLES.filter(t => !existingTables.has(t));

    if (missing.length === 0) {
      logger.info('All required ClickHouse tables are ready');
      return;
    }

    logger.info(
      `Waiting for ClickHouse tables: ${missing.join(', ')} (${Math.round((Date.now() - start) / 1000)}s elapsed)`,
    );
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for ClickHouse tables after ${maxWaitMs / 1000}s`,
  );
};

export const connectDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  if (config.MONGO_URI == null) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(config.MONGO_URI);
};

export const closeDB = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await mongooseConnection.dropDatabase();
};

export const clearDBCollections = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  const collections = mongooseConnection.collections;
  await Promise.all(
    Object.values(collections).map(async collection => {
      await collection.deleteMany({}); // an empty mongodb selector object ({}) must be passed as the filter argument
    }),
  );
};

// after connectDB
export const initCiEnvs = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }

  // Populate fake persistent data here...
  await waitForClickhouseSchema();
};

class MockServer extends Server {
  protected shouldHandleGracefulShutdown = false;

  getHttpServer() {
    return this.appServer;
  }

  async start(): Promise<void> {
    if (!config.IS_CI) {
      throw new Error('ONLY execute this in CI env 😈 !!!');
    }
    try {
      await super.start();
      await initCiEnvs();
    } catch (err) {
      console.error(err);
    }
  }

  stop() {
    return new Promise<void>((resolve, reject) => {
      this.appServer.close(err => {
        if (err) {
          reject(err);
          return;
        }
        this.opampServer.close(err => {
          if (err) {
            reject(err);
            return;
          }
          super
            .shutdown()
            .then(() => resolve())
            .catch(err => reject(err));
        });
      });
    });
  }

  clearDBs() {
    return Promise.all([clearClickhouseTables(), clearDBCollections()]);
  }
}

export const getServer = () => new MockServer();

export const getAgent = (server: MockServer) =>
  request.agent(server.getHttpServer());

export const getLoggedInAgent = async (server: MockServer) => {
  const agent = getAgent(server);

  await agent
    .post('/register/password')
    .send({ ...MOCK_USER, confirmPassword: MOCK_USER.password })
    .expect(200);

  const user = await findUserByEmail(MOCK_USER.email);
  const team = await getTeam(user?.team as any);

  if (team === null || user === null) {
    throw Error('team or user not found');
  }

  // login app
  await agent.post('/login/password').send(MOCK_USER).expect(302);

  return {
    agent,
    team,
    user,
  };
};

// ------------------------------------------------
// ------------------ Clickhouse ------------------
// ------------------------------------------------
export const executeSqlCommand = async (sql: string) => {
  const client = await getTestFixtureClickHouseClient();
  return await client.command({
    query: sql,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });
};

export const clearClickhouseTables = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  const tables = [
    `${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`,
    // `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.GAUGE}`,
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.SUM}`,
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.HISTOGRAM}`,
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.SUMMARY}`,
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM}`,
  ];

  const promises: any = [];
  const client = await getTestFixtureClickHouseClient();
  for (const table of tables) {
    promises.push(
      client.command({
        query: `TRUNCATE TABLE ${table}`,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      }),
    );
  }
  await Promise.all(promises);
};

export const selectAllLogs = async () => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  return clickhouseClient
    .query({
      query: `SELECT * FROM ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`,
      format: 'JSONEachRow',
    })
    .then(res => res.json());
};

export const bulkInsertData = async (
  table: string,
  data: Record<string, any>[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  const client = await getTestFixtureClickHouseClient();
  await client.insert({
    table,
    values: data,
    format: 'JSONEachRow',
    clickhouse_settings: {
      // Allows to insert serialized JS Dates (such as '2023-12-06T10:54:48.000Z')
      date_time_input_format: 'best_effort',
      wait_end_of_query: 1,
    },
  });
};

export const bulkInsertLogs = async (
  events: {
    Body: string;
    ServiceName: string;
    SeverityText: string;
    Timestamp: Date;
  }[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await bulkInsertData(`${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`, events);
};

export const bulkInsertMetricsGauge = async (
  metrics: {
    MetricName: string;
    ResourceAttributes: Record<string, string>;
    ServiceName: string;
    TimeUnix: Date;
    Value: number;
  }[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.GAUGE}`,
    metrics,
  );
};

export const bulkInsertMetricsSum = async (
  metrics: {
    AggregationTemporality: number;
    IsMonotonic: boolean;
    MetricName: string;
    ResourceAttributes: Record<string, string>;
    ServiceName: string;
    TimeUnix: Date;
    Value: number;
  }[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.SUM}`,
    metrics,
  );
};

export const bulkInsertMetricsHistogram = async (
  metrics: {
    MetricName: string;
    ResourceAttributes: Record<string, string>;
    TimeUnix: Date;
    BucketCounts: number[];
    ExplicitBounds: number[];
    AggregationTemporality: number;
  }[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.HISTOGRAM}`,
    metrics,
  );
};

enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
  Summary = 'Summary',
  // TODO: support 'ExponentialHistogram'
}

// TODO: DEPRECATED
export function buildMetricSeries({
  tags,
  name,
  points,
  data_type,
  is_delta,
  is_monotonic,
  unit,
  team_id,
}: {
  tags: Record<string, string>;
  name: string;
  points: { value: number; timestamp: number; le?: string }[];
  data_type: MetricsDataType;
  is_monotonic: boolean;
  is_delta: boolean;
  unit: string;
  team_id: string;
}): MetricModel[] {
  // @ts-ignore TODO: Fix Timestamp types
  return points.map(({ value, timestamp, le }) => ({
    _string_attributes: { ...tags, ...(le && { le }) },
    name,
    value,
    timestamp: `${timestamp}000000`,
    data_type,
    is_monotonic,
    is_delta,
    unit,
    team_id,
  }));
}

export const randomMongoId = () => new mongoose.Types.ObjectId().toHexString();

export const makeTile = (opts?: {
  id?: string;
  alert?: BuilderSavedChartConfig['alert'];
  sourceId?: string;
}): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: makeChartConfig(opts),
});

export const makeChartConfig = (opts?: {
  id?: string;
  alert?: BuilderSavedChartConfig['alert'];
  sourceId?: string;
}): SavedChartConfig => ({
  name: 'Test Chart',
  source: opts?.sourceId ?? 'test-source',
  displayType: DisplayType.Line,
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  granularity: 'auto',
  implicitColumnExpression: 'Body',
  numberFormat: {
    output: 'number',
  },
  filters: [],
  alert: opts?.alert,
});

// TODO: DEPRECATED
export const makeExternalChart = (opts?: {
  id?: string;
  sourceId?: string;
}) => ({
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  series: [
    {
      type: 'time',
      sourceId: opts?.sourceId ?? '68dd82484f54641b08667897',
      aggFn: 'count',
      where: '',
      groupBy: [],
    },
  ],
});

export const makeExternalTile = (opts?: {
  sourceId?: string;
}): ExternalDashboardTile => ({
  name: 'Test Chart',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    displayType: 'line',
    sourceId: opts?.sourceId ?? '68dd82484f54641b08667897',
    select: [
      {
        aggFn: 'count',
        where: '',
      },
    ],
  },
});

export const makeRawSqlTile = (opts?: {
  id?: string;
  displayType?: DisplayType;
  sqlTemplate?: string;
  connectionId?: string;
}): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    configType: 'sql',
    displayType: opts?.displayType ?? DisplayType.Line,
    sqlTemplate: opts?.sqlTemplate ?? 'SELECT 1',
    connection: opts?.connectionId ?? 'test-connection',
  } satisfies RawSqlSavedChartConfig,
});

export const RAW_SQL_ALERT_TEMPLATE = [
  'SELECT toStartOfInterval(Timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts,',
  ' count() AS cnt',
  ' FROM default.otel_logs',
  ' WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
  ' AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
  ' GROUP BY ts ORDER BY ts',
].join('');

export const makeRawSqlAlertTile = (opts?: {
  id?: string;
  connectionId?: string;
  sqlTemplate?: string;
}): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    configType: 'sql',
    displayType: DisplayType.Line,
    sqlTemplate: opts?.sqlTemplate ?? RAW_SQL_ALERT_TEMPLATE,
    connection: opts?.connectionId ?? 'test-connection',
  } satisfies RawSqlSavedChartConfig,
});

export const RAW_SQL_NUMBER_ALERT_TEMPLATE = [
  'SELECT count() AS cnt',
  ' FROM default.otel_logs',
  ' WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
  ' AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
].join('');

export const makeRawSqlNumberAlertTile = (opts?: {
  id?: string;
  connectionId?: string;
  sqlTemplate?: string;
}): Tile => ({
  id: opts?.id ?? randomMongoId(),
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    configType: 'sql',
    displayType: DisplayType.Number,
    sqlTemplate: opts?.sqlTemplate ?? RAW_SQL_NUMBER_ALERT_TEMPLATE,
    connection: opts?.connectionId ?? 'test-connection',
  } satisfies RawSqlSavedChartConfig,
});

export const makeAlertInput = ({
  dashboardId,
  interval = '15m',
  threshold = 8,
  tileId,
  webhookId = 'test-webhook-id',
}: {
  dashboardId: string;
  interval?: AlertInterval;
  threshold?: number;
  tileId: string;
  webhookId?: string;
}): Partial<AlertInput> => ({
  channel: {
    type: 'webhook',
    webhookId,
  },
  interval,
  threshold,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.TILE,
  dashboardId,
  tileId,
});

export const makeSavedSearchAlertInput = ({
  savedSearchId,
  interval = '15m',
  threshold = 8,
  webhookId = 'test-webhook-id',
}: {
  savedSearchId: string;
  interval?: AlertInterval;
  threshold?: number;
  webhookId?: string;
}): Partial<AlertInput> => ({
  channel: {
    type: 'webhook',
    webhookId,
  },
  interval,
  threshold,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId,
});
