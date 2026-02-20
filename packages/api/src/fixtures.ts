import { createNativeClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import {
  DisplayType,
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
import { AlertInterval, AlertSource, AlertThresholdType } from '@/models/alert';
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

const connectClickhouse = async () => {
  // health check
  await healthCheck();

  const client = await getTestFixtureClickHouseClient();
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}
      (
        Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        TimestampTime DateTime DEFAULT toDateTime(Timestamp),
        TraceId String CODEC(ZSTD(1)),
        SpanId String CODEC(ZSTD(1)),
        TraceFlags UInt8,
        SeverityText LowCardinality(String) CODEC(ZSTD(1)),
        SeverityNumber UInt8,
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        Body String CODEC(ZSTD(1)),
        ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
        ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
        ScopeName String CODEC(ZSTD(1)),
        ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
        ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
        INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimestampTime)
      PRIMARY KEY (ServiceName, TimestampTime)
      ORDER BY (ServiceName, TimestampTime, Timestamp)
      TTL TimestampTime + toIntervalDay(3)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.GAUGE}
        (
          ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ResourceSchemaUrl String CODEC(ZSTD(1)),
          ScopeName String CODEC(ZSTD(1)),
          ScopeVersion String CODEC(ZSTD(1)),
          ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
          ScopeSchemaUrl String CODEC(ZSTD(1)),
          ServiceName LowCardinality(String) CODEC(ZSTD(1)),
          MetricName String CODEC(ZSTD(1)),
          MetricDescription String CODEC(ZSTD(1)),
          MetricUnit String CODEC(ZSTD(1)),
          Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          Value Float64 CODEC(ZSTD(1)),
          Flags UInt32 CODEC(ZSTD(1)),
          INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimeUnix)
      ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
      TTL toDateTime(TimeUnix) + toIntervalDay(3)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.SUM}
      (
          ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ResourceSchemaUrl String CODEC(ZSTD(1)),
          ScopeName String CODEC(ZSTD(1)),
          ScopeVersion String CODEC(ZSTD(1)),
          ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
          ScopeSchemaUrl String CODEC(ZSTD(1)),
          ServiceName LowCardinality(String) CODEC(ZSTD(1)),
          MetricName String CODEC(ZSTD(1)),
          MetricDescription String CODEC(ZSTD(1)),
          MetricUnit String CODEC(ZSTD(1)),
          Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          Value Float64 CODEC(ZSTD(1)),
          Flags UInt32 CODEC(ZSTD(1)),
          AggregationTemporality Int32 CODEC(ZSTD(1)),
          IsMonotonic Bool CODEC(Delta(1), ZSTD(1)),
          INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimeUnix)
      ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
      TTL toDateTime(TimeUnix) + toIntervalDay(15)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${DEFAULT_DATABASE}.${DEFAULT_METRICS_TABLE.HISTOGRAM}
      (
          ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ResourceSchemaUrl String CODEC(ZSTD(1)),
          ScopeName String CODEC(ZSTD(1)),
          ScopeVersion String CODEC(ZSTD(1)),
          ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
          ScopeSchemaUrl String CODEC(ZSTD(1)),
          ServiceName LowCardinality(String) CODEC(ZSTD(1)),
          MetricName String CODEC(ZSTD(1)),
          MetricDescription String CODEC(ZSTD(1)),
          MetricUnit String CODEC(ZSTD(1)),
          Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
          StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          Count UInt64 CODEC(Delta(8), ZSTD(1)),
          Sum Float64 CODEC(ZSTD(1)),
          BucketCounts Array(UInt64) CODEC(ZSTD(1)),
          ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
          Flags UInt32 CODEC(ZSTD(1)),
          Min Float64 CODEC(ZSTD(1)),
          Max Float64 CODEC(ZSTD(1)),
          AggregationTemporality Int32 CODEC(ZSTD(1)),
          INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
          INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimeUnix)
      ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
      TTL toDateTime(TimeUnix) + toIntervalDay(3)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });
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
  await connectClickhouse();
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

export const randomMongoId = () =>
  Math.floor(Math.random() * 1000000000000).toString();

export const makeTile = (opts?: {
  id?: string;
  alert?: SavedChartConfig['alert'];
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
  alert?: SavedChartConfig['alert'];
}): SavedChartConfig => ({
  name: 'Test Chart',
  source: 'test-source',
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

export const makeAlertInput = ({
  dashboardId,
  interval = '15m',
  threshold = 8,
  tileId,
}: {
  dashboardId: string;
  interval?: AlertInterval;
  threshold?: number;
  tileId: string;
}): Partial<AlertInput> => ({
  channel: {
    type: 'webhook',
    webhookId: 'test-webhook-id',
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
}: {
  savedSearchId: string;
  interval?: AlertInterval;
  threshold?: number;
}): Partial<AlertInput> => ({
  channel: {
    type: 'webhook',
    webhookId: 'test-webhook-id',
  },
  interval,
  threshold,
  thresholdType: AlertThresholdType.ABOVE,
  source: AlertSource.SAVED_SEARCH,
  savedSearchId,
});
