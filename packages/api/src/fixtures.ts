import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  AlertChartConfig,
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

export const closeTestFixtureClickHouseClient = async () => {
  if (clickhouseClient) {
    await clickhouseClient.close();
    clickhouseClient = null;
  }
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
  await mongoose.disconnect();
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

  async stop() {
    await new Promise<void>((resolve, reject) => {
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
          resolve();
        });
      });
    });
    await closeTestFixtureClickHouseClient();
    await super.shutdown();
  }

  clearDBs() {
    return Promise.all([clearClickhouseTables(), clearDBCollections()]);
  }
}

export const getServer = () => new MockServer();

export const getAgent = (server: MockServer) =>
  request.agent(server.getHttpServer());

export const getLoggedInAgent = async (
  server: MockServer,
  credentials?: { email: string; password: string },
) => {
  const agent = getAgent(server);
  const creds = credentials ?? MOCK_USER;

  await agent
    .post('/register/password')
    .send({ ...creds, confirmPassword: creds.password })
    .expect(200);

  const user = await findUserByEmail(creds.email);
  const team = await getTeam(user?.team as any);

  if (team === null || user === null) {
    throw Error('team or user not found');
  }

  // login app — 303 See Other so the browser follows the redirect with GET
  // (see redirectToDashboard in middleware/auth.ts).
  await agent.post('/login/password').send(creds).expect(303);

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

// The TimeSeries engine is experimental, and its flag is a *query* setting — it
// cannot ride along in a CREATE's own SETTINGS clause, which only takes storage
// settings. Every statement therefore carries it, which is why these tables
// cannot go through `executeSqlCommand`.
export const executeTimeSeriesSqlCommand = async (sql: string) => {
  const client = await getTestFixtureClickHouseClient();
  return await client.command({
    query: sql,
    clickhouse_settings: {
      allow_experimental_time_series_table: 1,
      wait_end_of_query: 1,
    },
  });
};

export const dropTimeSeriesTable = async ({
  table,
  database = DEFAULT_DATABASE,
}: {
  table: string;
  database?: string;
}) => executeTimeSeriesSqlCommand(`DROP TABLE IF EXISTS ${database}.${table}`);

export type TimeSeriesFixtureSeries = {
  metricName: string;
  /** Labels other than `__name__`, which is derived from `metricName`. */
  tags: Record<string, string>;
  /** Series window in unix seconds; ignored when the table stores no bounds. */
  startSec: number;
  endSec: number;
};

/**
 * (Re)creates a TimeSeries table and writes `series` straight into its tags
 * inner table — Prometheus remote-write is the only other way in, and label
 * lookups never read the data inner table.
 *
 * `storeTimeBounds: false` creates the table with
 * `store_min_time_and_max_time = 0`, which leaves the tags table without the
 * min_time/max_time columns a time-bounded lookup reads.
 */
export const seedTimeSeriesTagsTable = async ({
  table,
  series,
  database = DEFAULT_DATABASE,
  storeTimeBounds = true,
}: {
  table: string;
  series: TimeSeriesFixtureSeries[];
  database?: string;
  storeTimeBounds?: boolean;
}) => {
  await dropTimeSeriesTable({ table, database });
  await executeTimeSeriesSqlCommand(
    `CREATE TABLE ${database}.${table} ENGINE = TimeSeries${
      storeTimeBounds ? '' : ' SETTINGS store_min_time_and_max_time = 0'
    }`,
  );

  const quoted = (v: string) => `'${v.replace(/'/g, "\\'")}'`;
  const mapLiteral = (tags: Record<string, string>) =>
    `map(${Object.entries(tags)
      .flatMap(([k, v]) => [quoted(k), quoted(v)])
      .join(', ')})`;

  const columns = storeTimeBounds
    ? '(metric_name, tags, all_tags, min_time, max_time)'
    : '(metric_name, tags, all_tags)';
  const values = series
    .map(s => {
      const row = [
        quoted(s.metricName),
        mapLiteral(s.tags),
        mapLiteral({ __name__: s.metricName, ...s.tags }),
      ];
      if (storeTimeBounds) {
        row.push(
          `toDateTime64(${s.startSec}, 3)`,
          `toDateTime64(${s.endSec}, 3)`,
        );
      }
      return `(${row.join(', ')})`;
    })
    .join(', ');

  await executeTimeSeriesSqlCommand(
    `INSERT INTO TABLE FUNCTION timeSeriesTags('${database}', '${table}') ${columns} VALUES ${values}`,
  );
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

// ScopeAttributes and Attributes are optional so existing call sites that
// only populate ResourceAttributes keep compiling unchanged. Omitting either
// field drops the key from the JSONEachRow payload, and ClickHouse falls back
// to the column default — an empty Map(LowCardinality(String), String) — so
// the on-disk row is byte-identical to today's behaviour. New tests that need
// to exercise the cross-scope attribute hashing (see HDX-4466) can opt in by
// passing one or both maps explicitly.
export const bulkInsertMetricsGauge = async (
  metrics: {
    MetricName: string;
    ResourceAttributes: Record<string, string>;
    ScopeAttributes?: Record<string, string>;
    Attributes?: Record<string, string>;
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
    ScopeAttributes?: Record<string, string>;
    Attributes?: Record<string, string>;
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
    ScopeAttributes?: Record<string, string>;
    Attributes?: Record<string, string>;
    ServiceName?: string;
    TimeUnix: Date;
    Count?: number;
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

export const bulkInsertMetricsSummary = async (
  metrics: {
    MetricName: string;
    ResourceAttributes: Record<string, string>;
    ScopeAttributes?: Record<string, string>;
    Attributes?: Record<string, string>;
    ServiceName?: string;
    TimeUnix: Date;
    Count?: number;
    Sum?: number;
  }[],
) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.SUMMARY}`,
    metrics,
  );
};

type ExponentialHistogramMetricPoint = {
  TimeUnix: Date;
  ServiceName?: string;
  Scale?: number;
  Count?: number;
  Sum?: number;
  ZeroCount?: number;
  PositiveOffset?: number;
  PositiveBucketCounts?: number[];
  NegativeOffset?: number;
  NegativeBucketCounts?: number[];
  StartTimeUnix?: Date;
  ResourceAttributes?: Record<string, string>;
  ScopeAttributes?: Record<string, string>;
  Attributes?: Record<string, string>;
};

type DenseExponentialHistogramBuckets = {
  offset: number;
  counts: number[];
};

const toDenseExponentialHistogramBuckets = (
  buckets: Map<number, number>,
): DenseExponentialHistogramBuckets => {
  if (buckets.size === 0) {
    return { offset: 0, counts: [] };
  }

  const indexes = [...buckets.keys()];
  const offset = Math.min(...indexes);
  const counts = Array(Math.max(...indexes) - offset + 1).fill(0);
  for (const [index, count] of buckets) {
    counts[index - offset] = count;
  }
  return { offset, counts };
};

export const bucketExponentialHistogramObservations = (
  observations: number[],
  scale = 0,
) => {
  if (!Number.isInteger(scale)) {
    throw new Error('exponential histogram scale must be an integer');
  }

  const positiveBuckets = new Map<number, number>();
  const negativeBuckets = new Map<number, number>();
  let zeroCount = 0;

  for (const observation of observations) {
    if (!Number.isFinite(observation)) {
      throw new Error('exponential histogram observations must be finite');
    }
    if (observation === 0) {
      zeroCount += 1;
      continue;
    }

    const buckets = observation > 0 ? positiveBuckets : negativeBuckets;
    const index = Math.ceil(Math.log2(Math.abs(observation)) * 2 ** scale) - 1;
    buckets.set(index, (buckets.get(index) ?? 0) + 1);
  }

  const positive = toDenseExponentialHistogramBuckets(positiveBuckets);
  const negative = toDenseExponentialHistogramBuckets(negativeBuckets);
  return {
    Scale: scale,
    Count: observations.length,
    Sum: observations.reduce((sum, observation) => sum + observation, 0),
    ZeroCount: zeroCount,
    PositiveOffset: positive.offset,
    PositiveBucketCounts: positive.counts,
    NegativeOffset: negative.offset,
    NegativeBucketCounts: negative.counts,
  };
};

export const seedExponentialHistogramMetric = async ({
  metricName,
  points,
  aggregationTemporality = 2,
}: {
  metricName: string;
  points: ExponentialHistogramMetricPoint[];
  aggregationTemporality?: number;
}) => {
  if (!config.IS_CI) {
    throw new Error('ONLY execute this in CI env 😈 !!!');
  }

  const startTimeUnix = points[0]?.StartTimeUnix ?? points[0]?.TimeUnix;
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM}`,
    points.map(point => ({
      MetricName: metricName,
      ServiceName: 'test-service',
      ResourceAttributes: {},
      ScopeAttributes: {},
      Attributes: {},
      StartTimeUnix: startTimeUnix,
      AggregationTemporality: aggregationTemporality,
      Scale: 0,
      ZeroCount: 0,
      PositiveOffset: 0,
      PositiveBucketCounts: [],
      NegativeOffset: 0,
      NegativeBucketCounts: [],
      ...point,
    })),
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
  // @ts-expect-error TODO: Fix Timestamp types
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

export const makeAlertChartConfig = (opts: {
  sourceId: string;
  name?: string;
  displayType?: DisplayType;
  aggCondition?: string;
  groupBy?: string;
}): AlertChartConfig => ({
  name: opts.name ?? 'Chart Alert Query',
  source: opts.sourceId,
  displayType: opts.displayType ?? DisplayType.Line,
  select: [
    {
      aggFn: 'count',
      aggCondition: opts.aggCondition ?? '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'lucene',
  ...(opts.groupBy != null && { groupBy: opts.groupBy }),
});

export const makeInlineAlertInput = ({
  chartConfig,
  interval = '15m',
  threshold = 8,
  webhookId = 'test-webhook-id',
}: {
  chartConfig: AlertChartConfig;
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
  source: AlertSource.INLINE,
  chartConfig,
});
