import * as fns from 'date-fns';
import SqlString from 'sqlstring';
import _ from 'lodash';
import ms from 'ms';
import opentelemetry from '@opentelemetry/api';
import {
  Logger as _CHLogger,
  SettingsMap,
  createClient,
} from '@clickhouse/client';
import {
  LogParams as _CHLogParams,
  ErrorLogParams as _CHErrorLogParams,
} from '@clickhouse/client/dist/logger';
import { serializeError } from 'serialize-error';

import * as config from '../config';
import logger from '../utils/logger';
import { sleep } from '../utils/common';
import {
  LogsPropertyTypeMappingsModel,
  MetricsPropertyTypeMappingsModel,
} from './propertyTypeMappingsModel';
import {
  SQLSerializer,
  SearchQueryBuilder,
  buildSearchColumnName,
  buildSearchColumnName_OLD,
  buildSearchQueryWhereCondition,
  isCustomColumn,
  msToBigIntNs,
} from './searchQueryParser';

import type { ResponseJSON, ResultSet } from '@clickhouse/client';
import type {
  LogStreamModel,
  MetricModel,
  RrwebEventModel,
} from '../utils/logParser';

const tracer = opentelemetry.trace.getTracer(__filename);

export type SortOrder = 'asc' | 'desc' | null;

export enum AggFn {
  Avg = 'avg',
  Count = 'count',
  CountDistinct = 'count_distinct',
  Max = 'max',
  Min = 'min',
  P50 = 'p50',
  P90 = 'p90',
  P95 = 'p95',
  P99 = 'p99',
  Sum = 'sum',
}

export enum Granularity {
  ThirtySecond = '30 second',
  OneMinute = '1 minute',
  FiveMinute = '5 minute',
  TenMinute = '10 minute',
  FifteenMinute = '15 minute',
  ThirtyMinute = '30 minute',
  OneHour = '1 hour',
  TwoHour = '2 hour',
  SixHour = '6 hour',
  TwelveHour = '12 hour',
  OneDay = '1 day',
  TwoDay = '2 day',
  SevenDay = '7 day',
  ThirtyDay = '30 day',
}

export enum TableName {
  LogStream = 'log_stream',
  Metric = 'metric_stream',
  Rrweb = 'rrweb',
}

export class CHLogger implements _CHLogger {
  debug({ module, message, args }: _CHLogParams): void {
    logger.debug({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  trace({ module, message, args }: _CHLogParams) {
    // TODO: trace level ??
    logger.info({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  info({ module, message, args }: _CHLogParams): void {
    logger.info({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  warn({ module, message, args }: _CHLogParams): void {
    logger.warn({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  error({ module, message, args, err }: _CHErrorLogParams): void {
    logger.error({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
      err,
    });
  }
}

// TODO: move this to somewhere else
export const client = createClient({
  host: config.CLICKHOUSE_HOST,
  username: config.CLICKHOUSE_USER,
  password: config.CLICKHOUSE_PASSWORD,
  request_timeout: ms('1m'),
  compression: {
    request: false,
    response: false, // has to be off to enable streaming
  },
  keep_alive: {
    enabled: true,
    // should be slightly less than the `keep_alive_timeout` setting in server's `config.xml`
    // default is 3s there, so 2500 milliseconds seems to be a safe client value in this scenario
    // another example: if your configuration has `keep_alive_timeout` set to 60s, you could put 59_000 here
    socket_ttl: 60000,
    retry_on_expired_socket: true,
  },
  clickhouse_settings: {
    connect_timeout: ms('1m') / 1000,
    max_download_threads: 32,
    max_download_buffer_size: (10 * 1024 * 1024).toString(), // default
    max_execution_time: ms('2m') / 1000,
  },
  log: {
    LoggerClass: CHLogger,
  },
});

export const getLogStreamTableName = (
  version: number | undefined | null,
  teamId: string,
) => `default.${TableName.LogStream}`;

export const buildTeamLogStreamWhereCondition = (
  version: number | undefined | null,
  teamId: string,
) => SqlString.raw('(1 = 1)');

export const buildLogStreamAdditionalFilters = (
  version: number | undefined | null,
  teamId: string,
) => SettingsMap.from({});

export const healthCheck = () => client.ping();

export const connect = async () => {
  if (config.IS_CI) {
    return;
  }
  // FIXME: this is a hack to avoid CI failure
  logger.info('Checking connections to ClickHouse...');
  // health check
  await healthCheck();

  logger.info('Initializing ClickHouse...');

  // *************************************
  // Create Tables
  // *************************************
  // Log model (v1)
  // 1. https://opentelemetry.io/docs/reference/specification/logs/data-model/
  // 2. https://www.uber.com/blog/logging/
  // 3. https://clickhouse.com/blog/storing-log-data-in-clickhouse-fluent-bit-vector-open-telemetry#architectures
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS default.${TableName.LogStream} (
        id UUID DEFAULT generateUUIDv4(),
        type Enum8('log' = 1, 'span' = 2) DEFAULT 'log',
        timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        observed_timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        end_timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        trace_id String CODEC(ZSTD(1)),
        span_name String CODEC(ZSTD(1)),
        span_id String CODEC(ZSTD(1)),
        parent_span_id String CODEC(ZSTD(1)),
        severity_number UInt8 CODEC(ZSTD(1)),
        severity_text String CODEC(ZSTD(1)),
        "string.names" Array(String),
        "string.values" Array(String),
        "number.names" Array(String),
        "number.values" Array(Float64),
        "bool.names" Array(String),
        "bool.values" Array(UInt8),
        _string_attributes Map(LowCardinality(String), String) MATERIALIZED CAST((string.names, string.values), 'Map(String, String)'),
        _number_attributes Map(LowCardinality(String), Float64) MATERIALIZED CAST((number.names, number.values), 'Map(String, Float64)'),
        _bool_attributes Map(LowCardinality(String), UInt8) MATERIALIZED CAST((bool.names, bool.values), 'Map(String, UInt8)'),
        _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
        _namespace LowCardinality(String) CODEC(ZSTD(1)),
        _platform LowCardinality(String) CODEC(ZSTD(1)),
        _host String CODEC(ZSTD(1)),
        _service LowCardinality(String) CODEC(ZSTD(1)),
        _source String CODEC(ZSTD(1)),
        _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, observed_timestamp, _created_at)),
        _hdx_body String MATERIALIZED "string.values"[indexOf("string.names", '_hdx_body')],
        _duration Float64 MATERIALIZED (toUnixTimestamp64Nano(end_timestamp) - toUnixTimestamp64Nano(timestamp)) / 1000000,
        _user_id String MATERIALIZED "string.values"[indexOf("string.names", 'userId')],
        _user_email String MATERIALIZED "string.values"[indexOf("string.names", 'userEmail')],
        _user_name String MATERIALIZED "string.values"[indexOf("string.names", 'userName')],
        _rum_session_id String MATERIALIZED "string.values"[indexOf("string.names", 'process.tag.rum.sessionId')],
        _hyperdx_event_size UInt32 MATERIALIZED length(_source),
            INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
            INDEX idx_rum_session_id _rum_session_id TYPE bloom_filter(0.001) GRANULARITY 1,
            INDEX idx_lower_source (lower(_source)) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
            INDEX idx_duration _duration TYPE minmax GRANULARITY 1,
            INDEX idx_string_attr_key mapKeys(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_string_attr_val mapValues(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_number_attr_key mapKeys(_number_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_number_attr_val mapValues(_number_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_bool_attr_key mapKeys(_bool_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_bool_attr_val mapValues(_bool_attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
      ORDER BY (_timestamp_sort_key)
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

  // RRWeb table: storing rrweb metadata for the player
  await client.command({
    query: `
        CREATE TABLE IF NOT EXISTS default.${TableName.Rrweb} (
          id UUID DEFAULT generateUUIDv4(),
          timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
          "string.names" Array(String),
          "string.values" Array(String),
          "number.names" Array(String),
          "number.values" Array(Float64),
          "bool.names" Array(String),
          "bool.values" Array(UInt8),
          body MATERIALIZED "string.values"[indexOf("string.names", '_hdx_body')],
          session_id MATERIALIZED "string.values"[indexOf("string.names", 'rum.sessionId')],
          type MATERIALIZED "number.values"[indexOf("number.names", 'type')],
          _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
          _service LowCardinality(String) CODEC(ZSTD(1)),
          _source String CODEC(ZSTD(1)),
          _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, _created_at)),
          _hyperdx_event_size UInt32 MATERIALIZED length(_source)
        )
        ENGINE = MergeTree
        TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
        ORDER BY (session_id, type, _timestamp_sort_key)
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

  // Metric model
  // 1. https://opentelemetry.io/docs/specs/otel/metrics/data-model/#timeseries-model
  // 2. https://github.com/mindis/prom2click
  // 3. https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/internal/gauge_metrics.go
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS default.${TableName.Metric} (
        timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        name LowCardinality(String) CODEC(ZSTD(1)),
        data_type LowCardinality(String) CODEC(ZSTD(1)),
        value Float64 CODEC(ZSTD(1)),
        flags UInt32  CODEC(ZSTD(1)),
        unit String CODEC(ZSTD(1)),
        _string_attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
        _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, _created_at)),
            INDEX idx_string_attr_key mapKeys(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_string_attr_val mapValues(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      PARTITION BY toDate(_created_at)
      TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
      ORDER BY (name, data_type, _string_attributes, _timestamp_sort_key)
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

export const clientInsertWithRetries = async <T>({
  table,
  values,
  retries = 10,
  timeout = 10000,
}: {
  table: string;
  values: T[];
  retries?: number;
  timeout?: number;
}) => {
  let maxRetries = retries;
  const ts = Date.now();
  while (maxRetries > 0) {
    try {
      await client.insert({
        table,
        values,
        format: 'JSONEachRow',
      });
      break;
    } catch (err) {
      logger.error({
        message: `Failed to bulk insert. Sleeping for ${timeout} ms...`,
        table,
        n: values.length,
        error: serializeError(err),
        maxRetries,
      });
      await sleep(timeout);
      maxRetries--;
      if (maxRetries === 0) {
        // TODO: requeue the failed events
        throw err;
      }
      logger.warn({
        message: 'Retrying bulk insert...',
        table,
        n: values.length,
        maxRetries,
      });
    }
  }
  logger.info({
    message: `Bulk inserted table: ${table}`,
    table,
    n: values.length,
    took: Date.now() - ts,
  });
};

export const bulkInsertRrwebEvents = async (events: RrwebEventModel[]) => {
  const tableName = `default.${TableName.Rrweb}`;
  await clientInsertWithRetries<RrwebEventModel>({
    table: tableName,
    values: events,
  });
};

export const bulkInsertTeamLogStream = async (
  version: number | undefined | null,
  teamId: string,
  logs: LogStreamModel[],
) => {
  const tableName = getLogStreamTableName(version, teamId);
  await clientInsertWithRetries<LogStreamModel>({
    table: tableName,
    values: logs,
  });
};

export const bulkInsertTeamMetricStream = async (metrics: MetricModel[]) => {
  const tableName = `default.${TableName.Metric}`;
  await clientInsertWithRetries<MetricModel>({
    table: tableName,
    values: metrics,
  });
};

// TODO: support since, until
export const fetchMetricsPropertyTypeMappings =
  (intervalSecs: number) =>
  async (tableVersion: number | undefined, teamId: string) => {
    const tableName = `default.${TableName.Metric}`;
    const query = SqlString.format(
      `
    SELECT groupUniqArrayArray(mapKeys(_string_attributes)) as strings
    FROM ??
    WHERE fromUnixTimestamp64Nano(_timestamp_sort_key) > now() - toIntervalSecond(?)
  `,
      [tableName, intervalSecs], // TODO: declare as constant
    );
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
    });
    const result = await rows.json<ResponseJSON<Record<string, any[]>>>();
    logger.info({
      message: 'fetchMetricsPropertyTypeMappings',
      query,
      took: Date.now() - ts,
    });
    return result;
  };

// since, until -> unix in ms
// TODO: what if since is like 0 or the difference is too big?
export const fetchLogsPropertyTypeMappings =
  (since: number, until: number) =>
  async (tableVersion: number | undefined, teamId: string) => {
    const tableName = getLogStreamTableName(tableVersion, teamId);
    const query = SqlString.format(
      `
    SELECT 
      groupUniqArrayArray(mapKeys(_string_attributes)) as strings,
      groupUniqArrayArray(mapKeys(_number_attributes)) as numbers,
      groupUniqArrayArray(mapKeys(_bool_attributes)) as bools
    FROM ??
    WHERE ?
    AND _timestamp_sort_key >= ?
    AND _timestamp_sort_key <= ?
  `,
      [
        tableName,
        buildTeamLogStreamWhereCondition(tableVersion, teamId),
        msToBigIntNs(since),
        msToBigIntNs(until),
      ],
    );
    const ts = Date.now();
    const rows = await client.query({
      query,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    const result = await rows.json<ResponseJSON<Record<string, any[]>>>();
    logger.info({
      message: 'fetchLogsPropertyTypeMappings',
      query,
      took: Date.now() - ts,
    });
    return result;
  };

// ******************************************************
// ****************** Helpers ***************************
// ******************************************************
export const msRangeToHistogramInterval = (msRange: number, total: number) => {
  const diffSeconds = Math.floor(msRange / 1000);
  const granularitySeconds = Math.ceil(diffSeconds / total);

  if (granularitySeconds <= 1) {
    return '1 second';
  } else if (granularitySeconds <= 2) {
    return '2 second';
  } else if (granularitySeconds <= 5) {
    return '5 second';
  } else if (granularitySeconds <= 10) {
    return '10 second';
  } else if (granularitySeconds <= 20) {
    return '20 second';
  } else if (granularitySeconds <= 30) {
    return '30 second';
  } else if (granularitySeconds <= 60) {
    return '1 minute';
  } else if (granularitySeconds <= 5 * 60) {
    return '5 minute';
  } else if (granularitySeconds <= 10 * 60) {
    return '10 minute';
  } else if (granularitySeconds <= 15 * 60) {
    return '15 minute';
  } else if (granularitySeconds <= 30 * 60) {
    return '30 minute';
  } else if (granularitySeconds <= 3600) {
    return '1 hour';
  } else if (granularitySeconds <= 2 * 3600) {
    return '2 hour';
  } else if (granularitySeconds <= 6 * 3600) {
    return '6 hour';
  } else if (granularitySeconds <= 12 * 3600) {
    return '12 hour';
  } else if (granularitySeconds <= 24 * 3600) {
    return '1 day';
  } else if (granularitySeconds <= 2 * 24 * 3600) {
    return '2 day';
  } else if (granularitySeconds <= 7 * 24 * 3600) {
    return '7 day';
  } else if (granularitySeconds <= 30 * 24 * 3600) {
    return '30 day';
  }

  return '30 day';
};

export const buildLogsPropertyTypeMappingsModel = async (
  tableVersion: number | undefined,
  teamId: string,
  since: number, // unix in ms
  until: number, // unix in ms
) => {
  const model = new LogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    fetchLogsPropertyTypeMappings(since, until),
  );
  await model.init();
  return model;
};

// TODO: separate by data_type ??
export const buildMetricsPropertyTypeMappingsModel = async (
  tableVersion: number | undefined,
  teamId: string,
) => {
  const model = new MetricsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    fetchMetricsPropertyTypeMappings(ms('28d') / 1000),
  );
  await model.init();
  return model;
};

// TODO: move this to PropertyTypeMappingsModel
export const doesLogsPropertyExist = (
  property: string,
  model: LogsPropertyTypeMappingsModel,
) => {
  if (!property) {
    return true; // in this case, we don't refresh the property type mappings
  }
  return isCustomColumn(property) || model.get(property);
};

// ******************************************************
export const getCHServerMetrics = async () => {
  const query = `
      SELECT metric, value
      FROM system.metrics
    `;
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
  });
  const result = await rows.json<
    ResponseJSON<{ metric: string; value: string }>
  >();
  logger.info({
    message: 'getCHServerMetrics',
    query,
    took: Date.now() - ts,
  });
  return result.data
    .map(row => ({
      [`${row.metric}`]: parseInt(row.value),
    }))
    .reduce((result, obj) => {
      return { ...result, ...obj };
    }, {});
};

export const getMetricsTags = async (teamId: string) => {
  const tableName = `default.${TableName.Metric}`;
  // TODO: remove 'data_type' in the name field
  const query = SqlString.format(
    `
        SELECT 
          format('{} - {}', name, data_type) as name,
          data_type,
          groupUniqArray(_string_attributes) AS tags
        FROM ??
        GROUP BY name, data_type
        ORDER BY name
    `,
    [tableName],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
  });
  const result = await rows.json<ResponseJSON<{ names: string[] }>>();
  logger.info({
    message: 'getMetricsProps',
    query,
    took: Date.now() - ts,
  });
  return result;
};

export const getMetricsChart = async ({
  aggFn,
  dataType,
  endTime,
  granularity,
  groupBy,
  name,
  q,
  startTime,
  teamId,
}: {
  aggFn: AggFn;
  dataType: string;
  endTime: number; // unix in ms,
  granularity: Granularity;
  groupBy?: string;
  name: string;
  q: string;
  startTime: number; // unix in ms
  teamId: string;
}) => {
  const tableName = `default.${TableName.Metric}`;
  const propertyTypeMappingsModel = await buildMetricsPropertyTypeMappingsModel(
    undefined, // default version
    teamId,
  );
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });
  const selectClause = [
    SqlString.format(
      'toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) AS ts_bucket',
      [granularity],
    ),
    groupBy
      ? SqlString.format(`_string_attributes[?] AS group`, [groupBy])
      : 'name AS group',
  ];

  switch (dataType) {
    case 'Gauge':
      selectClause.push(
        aggFn === AggFn.Count
          ? 'COUNT(value) as data'
          : aggFn === AggFn.Sum
          ? `SUM(value) as data`
          : aggFn === AggFn.Avg
          ? `AVG(value) as data`
          : aggFn === AggFn.Max
          ? `MAX(value) as data`
          : aggFn === AggFn.Min
          ? `MIN(value) as data`
          : `quantile(${
              aggFn === AggFn.P50
                ? '0.5'
                : aggFn === AggFn.P90
                ? '0.90'
                : aggFn === AggFn.P95
                ? '0.95'
                : '0.99'
            })(value) as data`,
      );
      break;
    case 'Sum':
      selectClause.push(
        aggFn === AggFn.Count
          ? 'COUNT(delta) as data'
          : aggFn === AggFn.Sum
          ? `SUM(delta) as data`
          : aggFn === AggFn.Avg
          ? `AVG(delta) as data`
          : aggFn === AggFn.Max
          ? `MAX(delta) as data`
          : aggFn === AggFn.Min
          ? `MIN(delta) as data`
          : `quantile(${
              aggFn === AggFn.P50
                ? '0.5'
                : aggFn === AggFn.P90
                ? '0.90'
                : aggFn === AggFn.P95
                ? '0.95'
                : '0.99'
            })(delta) as data`,
      );
      break;
    default:
      logger.error(`Unsupported data type: ${dataType}`);
      break;
  }

  // TODO: support other data types like Sum, Histogram, etc.
  const query = SqlString.format(
    `
      WITH metrcis AS (
        SELECT *, runningDifference(value) AS delta
        FROM (
          SELECT 
            timestamp,
            name,
            value,
            _string_attributes
          FROM ??
          WHERE name = ?
          AND data_type = ?
          AND (?)
          ORDER BY _timestamp_sort_key ASC
        )
      )
      SELECT ?
      FROM metrcis
      GROUP BY group, ts_bucket
      ORDER BY ts_bucket ASC
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
    `,
    [
      tableName,
      name,
      dataType,
      SqlString.raw(whereClause),
      SqlString.raw(selectClause.join(',')),
      startTime / 1000,
      granularity,
      endTime / 1000,
      granularity,
      ms(granularity) / 1000,
    ],
  );

  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getMetricsChart',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getLogsChart = async ({
  aggFn,
  endTime,
  field,
  granularity,
  groupBy,
  maxNumGroups,
  propertyTypeMappingsModel,
  q,
  sortOrder,
  startTime,
  tableVersion,
  teamId,
}: {
  aggFn: AggFn;
  endTime: number; // unix in ms,
  field: string;
  granularity: string | undefined; // can be undefined in the number chart
  groupBy: string;
  maxNumGroups: number;
  propertyTypeMappingsModel: LogsPropertyTypeMappingsModel;
  q: string;
  sortOrder?: 'asc' | 'desc';
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });

  // WARNING: selectField can be null
  const selectField = buildSearchColumnName(
    propertyTypeMappingsModel.get(field),
    field,
  );

  const hasGroupBy = groupBy != '' && groupBy != null;
  const isCountFn = aggFn === AggFn.Count;
  const groupByField =
    hasGroupBy &&
    buildSearchColumnName(propertyTypeMappingsModel.get(groupBy), groupBy);

  const serializer = new SQLSerializer(propertyTypeMappingsModel);

  const selectClause = [
    isCountFn
      ? 'count() as data'
      : aggFn === AggFn.Sum
      ? `sum(${selectField}) as data`
      : aggFn === AggFn.Avg
      ? `avg(${selectField}) as data`
      : aggFn === AggFn.Max
      ? `max(${selectField}) as data`
      : aggFn === AggFn.Min
      ? `min(${selectField}) as data`
      : aggFn === AggFn.CountDistinct
      ? `count(distinct ${selectField}) as data`
      : `quantile(${
          aggFn === AggFn.P50
            ? '0.5'
            : aggFn === AggFn.P90
            ? '0.90'
            : aggFn === AggFn.P95
            ? '0.95'
            : '0.99'
        })(${selectField}) as data`,
    granularity != null
      ? `toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ${granularity})) as ts_bucket`
      : "'0' as ts_bucket",
    groupByField ? `${groupByField} as group` : `'${aggFn}' as group`, // FIXME: should we fallback to use aggFn as group
  ].join(',');

  const groupByClause = `ts_bucket ${groupByField ? `, ${groupByField}` : ''}`;

  const query = SqlString.format(
    `
      WITH raw_groups AS (
        SELECT ?
        FROM ??
        WHERE ? AND (?) ? ?
        GROUP BY ?
      ), groups AS (
        SELECT *, MAX(data) OVER (PARTITION BY group) as rank_order_by_value
        FROM raw_groups
      ), final AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY rank_order_by_value DESC) as rank
        FROM groups
      )
      SELECT *
      FROM final
      WHERE rank <= ?
      ORDER BY ts_bucket ASC
      ${
        granularity != null
          ? `WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?`
          : ''
      }${
      sortOrder === 'asc' || sortOrder === 'desc' ? `, data ${sortOrder}` : ''
    }
    `,
    [
      SqlString.raw(selectClause),
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereClause),
      SqlString.raw(
        !isCountFn ? ` AND (${await serializer.isNotNull(field, false)})` : '',
      ),
      SqlString.raw(
        hasGroupBy
          ? ` AND (${await serializer.isNotNull(groupBy, false)})`
          : '',
      ),
      SqlString.raw(groupByClause),
      maxNumGroups,
      ...(granularity != null
        ? [
            startTime / 1000,
            granularity,
            endTime / 1000,
            granularity,
            ms(granularity) / 1000,
          ]
        : []),
    ],
  );

  return await tracer.startActiveSpan('clickhouse.getLogsChart', async span => {
    span.setAttribute('query', query);
    try {
      const ts = Date.now();
      const rows = await client.query({
        query,
        format: 'JSON',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
        },
      });
      const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
      logger.info({
        message: 'getChart',
        query,
        teamId,
        took: Date.now() - ts,
      });
      return result;
    } catch (e) {
      span.recordException(e as any);
      throw e;
    } finally {
      span.end();
    }
  });
};

export const getChartHistogram = async ({
  bins,
  endTime,
  field,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  bins: number;
  endTime: number; // unix in ms,
  field: string;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
    teamId,
  });

  // TODO: hacky way to make sure the cache is update to date
  if (!doesLogsPropertyExist(field, propertyTypeMappingsModel)) {
    logger.warn({
      message: `getChart: Property type mappings cache is out of date (${field})`,
    });
    await propertyTypeMappingsModel.refresh();
  }

  // WARNING: selectField can be null
  const selectField = buildSearchColumnName(
    propertyTypeMappingsModel.get(field),
    field,
  );

  const serializer = new SQLSerializer(propertyTypeMappingsModel);

  const selectClause = `histogram(${bins})(${selectField}) as data`;

  const query = SqlString.format(`SELECT ? FROM ?? WHERE ? AND (?) AND (?)`, [
    SqlString.raw(selectClause),
    tableName,
    buildTeamLogStreamWhereCondition(tableVersion, teamId),
    SqlString.raw(whereClause),
    SqlString.raw(`${await serializer.isNotNull(field, false)}`),
  ]);

  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getChartHistogram',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getSessions = async ({
  endTime,
  limit,
  offset,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  endTime: number; // unix in ms,
  limit: number;
  offset: number;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );
  const sessionsWhereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: `rum_session_id:* AND ${q}`,
    startTime,
  });

  const buildCustomColumn = (propName: string, alias: string) =>
    `MAX(${buildSearchColumnName('string', propName)}) as "${alias}"`;

  const columns = [
    ['userEmail', 'userEmail'],
    ['userName', 'userName'],
    ['teamName', 'teamName'],
    ['teamId', 'teamId'],
  ]
    .map(props => buildCustomColumn(props[0], props[1]))
    .map(column => SqlString.raw(column));

  const sessionsWithSearchQuery = SqlString.format(
    `SELECT
      MAX(timestamp) AS maxTimestamp,
      MIN(timestamp) AS minTimestamp,
      count() AS sessionCount,
      countIf(?='user-interaction') AS interactionCount,
      countIf(severity_text = 'error') AS errorCount,
      ? AS sessionId,
      ?
    FROM ??
    WHERE ? AND (?)
    GROUP BY sessionId
    ${
      // If the user is giving us an explicit query, we don't need to filter out sessions with no interactions
      // this is because the events that match the query might not be user interactions, and we'll just show 0 results otherwise.
      q.length === 0 ? 'HAVING interactionCount > 0' : ''
    }
    ORDER BY maxTimestamp DESC
    LIMIT ?, ?`,
    [
      SqlString.raw(buildSearchColumnName('string', 'component')),
      SqlString.raw(buildSearchColumnName('string', 'rum_session_id')),
      columns,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(sessionsWhereClause),
      offset,
      limit,
    ],
  );

  const sessionsWithRecordingsQuery = SqlString.format(
    `WITH sessions AS (${sessionsWithSearchQuery}),
sessionIdsWithRecordings AS (
  SELECT DISTINCT _rum_session_id as sessionId
  FROM ??
  WHERE span_name='record init' 
    AND (_rum_session_id IN (SELECT sessions.sessionId FROM sessions))
    AND (?)
)
SELECT * 
FROM sessions 
WHERE sessions.sessionId IN (
    SELECT sessionIdsWithRecordings.sessionId FROM sessionIdsWithRecordings
  )`,
    [
      tableName,
      SqlString.raw(SearchQueryBuilder.timestampInBetween(startTime, endTime)),
    ],
  );

  // If the user specifes a query, we need to filter out returned sessions
  // by the 'record init' event being included so we don't return "blank"
  // sessions, this can be optimized once we record background status
  // of all events in the RUM package
  const executedQuery =
    q.length === 0 ? sessionsWithSearchQuery : sessionsWithRecordingsQuery;

  const ts = Date.now();
  const rows = await client.query({
    query: executedQuery,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getSessions',
    query: executedQuery,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getHistogram = async (
  tableVersion: number | undefined,
  teamId: string,
  q: string,
  startTime: number, // unix in ms
  endTime: number, // unix in ms,
) => {
  const msRange = endTime - startTime;
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );
  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });
  const interval = msRangeToHistogramInterval(msRange, 120);
  const query = SqlString.format(
    `
      SELECT
        toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) as ts_bucket,
        if(multiSearchAny(severity_text, ['err', 'emerg', 'alert', 'crit', 'fatal']), 'error', 'info') as severity_group,
        count(*) as count
      FROM ??
      WHERE ? AND (?)
      GROUP BY ts_bucket, severity_group
      ORDER BY ts_bucket
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
      LIMIT 1000
    `,
    [
      interval,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      startTime / 1000,
      interval,
      endTime / 1000,
      interval,
      ms(interval) / 1000,
    ],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getHistogram',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const getLogById = async (
  tableVersion: number | undefined,
  teamId: string,
  sortKey: string,
  logId: string,
) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const query = SqlString.format(
    `
      SELECT
        id,
        _timestamp_sort_key AS sort_key,
        timestamp,
        observed_timestamp,
        end_timestamp,
        parent_span_id,
        trace_id,
        span_id,
        span_name,
        severity_number,
        severity_text,
        type,
        "string.names",
        "string.values",
        "number.names",
        "number.values",
        "bool.names",
        "bool.values",
        _source,
        _service,
        _host,
        _platform,
        _duration as duration,
        _hdx_body as body
      FROM ??
      WHERE ? AND _timestamp_sort_key = ? AND id = toUUID(?)
    `,
    [
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      sortKey,
      logId,
    ],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<ResponseJSON<Record<string, unknown>>>();
  logger.info({
    message: 'getLogById',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export const checkAlert = async ({
  endTime,
  groupBy,
  q,
  startTime,
  tableVersion,
  teamId,
  windowSizeInMins,
}: {
  endTime: Date;
  groupBy?: string;
  q: string;
  startTime: Date;
  tableVersion: number | undefined;
  teamId: string;
  windowSizeInMins: number;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const startTimeMs = fns.getTime(startTime);
  const endTimeMs = fns.getTime(endTime);

  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTimeMs,
    endTimeMs,
  );
  const whereCondition = await buildSearchQueryWhereCondition({
    endTime: endTimeMs,
    propertyTypeMappingsModel,
    query: groupBy ? `${q} ${groupBy}:*` : q,
    startTime: startTimeMs,
  });

  const interval = `${windowSizeInMins} minute`;

  // extract group-by prop type
  // FIXME: what if groupBy prop does not exist?
  let groupByPropType;
  if (groupBy) {
    const serializer = new SQLSerializer(propertyTypeMappingsModel);
    const { found, propertyType } = await serializer.getColumnForField(groupBy);
    if (!found) {
      throw new Error(`groupBy prop ${groupBy} does not exist`);
    }
    groupByPropType = propertyType;
  }

  const query = SqlString.format(
    `
      SELECT 
        ?
        count(*) as count,
        toStartOfInterval(timestamp, INTERVAL ?) as ts_bucket
      FROM ??
      WHERE ? AND (?)
      GROUP BY ?
      ORDER BY ts_bucket
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
    `,
    [
      SqlString.raw(
        groupBy
          ? `${buildSearchColumnName(groupByPropType, groupBy)} as group,`
          : '',
      ),
      interval,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      SqlString.raw(
        groupBy
          ? `${buildSearchColumnName(groupByPropType, groupBy)}, ts_bucket`
          : 'ts_bucket',
      ),
      startTimeMs / 1000,
      interval,
      endTimeMs / 1000,
      interval,
      ms(interval) / 1000,
    ],
  );

  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildLogStreamAdditionalFilters(
        tableVersion,
        teamId,
      ),
    },
  });
  const result = await rows.json<
    ResponseJSON<{ count: string; group?: string; ts_bucket: string }>
  >();
  logger.info({
    message: 'checkAlert',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

export type LogSearchRow = {
  timestamp: string;
  severity_text: string;
  body: string;
  _host: string;
  _source: string;
};

const buildLogQuery = async ({
  defaultFields = [
    'id',
    'timestamp',
    'severity_text',
    '_timestamp_sort_key AS sort_key',
    'type',
    '_hdx_body as body',
    '_duration as duration',
    '_service',
    '_host',
    '_platform',
  ],
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  defaultFields?: string[];
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  // Validate order
  if (!['asc', 'desc', null].includes(order)) {
    throw new Error(`Invalid order: ${order}`);
  }

  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );

  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
    teamId,
  });

  const extraColumns = extraFields
    .map(field => {
      const fieldType = propertyTypeMappingsModel.get(field);
      const column = buildSearchColumnName(fieldType, field);
      // FIXME: sql injection ??
      return column ? `${column} as "${field}"` : null;
    })
    .filter(f => f);

  const columns = _.map([...defaultFields, ...extraColumns], SqlString.raw);
  const query = SqlString.format(
    `
      SELECT ?
      FROM ??
      WHERE ? AND (?)
      ?
      LIMIT ?, ?
    `,
    [
      columns,
      tableName,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      SqlString.raw(
        order !== null ? `ORDER BY _timestamp_sort_key ${order}` : '',
      ),
      offset,
      limit,
    ],
  );

  return query;
};

export const getLogBatchGroupedByBody = async ({
  bodyMaxLength,
  endTime,
  interval,
  limit,
  q,
  sampleRate,
  startTime,
  tableVersion,
  teamId,
}: {
  bodyMaxLength: number;
  endTime: number; // unix in ms
  interval: ReturnType<typeof msRangeToHistogramInterval>;
  limit: number;
  q: string;
  sampleRate?: number;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);
  const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
    tableVersion,
    teamId,
    startTime,
    endTime,
  );

  const whereCondition = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });

  const query = SqlString.format(
    `
      SELECT
        COUNT(*) as lines_count,
        groupArray(toStartOfInterval(timestamp, INTERVAL ?)) as buckets,
        groupArray(fromUnixTimestamp64Nano(_timestamp_sort_key)) as timestamps,
        groupArray(id) as ids,
        groupArray(_timestamp_sort_key) AS sort_keys,
        severity_text as level,
        _service as service,
        substring(_hdx_body, 1, ?) as body
      FROM ??
      WHERE randUniform(0, 1) <= ?
      AND (?)
      AND (?)
      GROUP BY level, service, body
      ORDER BY lines_count DESC
      LIMIT ?
    `,
    [
      interval,
      bodyMaxLength,
      tableName,
      sampleRate ?? 1,
      buildTeamLogStreamWhereCondition(tableVersion, teamId),
      SqlString.raw(whereCondition),
      limit,
    ],
  );

  type Response = ResponseJSON<{
    body: string;
    buckets: string[];
    ids: string[];
    sort_keys: string[];
    level: string;
    lines_count: string;
    service: string;
    timestamps: string[];
  }>;

  let result: Response;

  await tracer.startActiveSpan(
    'clickhouse.getLogBatchGroupedByBody',
    async span => {
      span.setAttribute('query', query);

      const rows = await client.query({
        query,
        format: 'JSON',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
        },
      });
      result = await rows.json<Response>();
      span.setAttribute('results', result.data.length);
      span.end();
    },
  );

  return result;
};

export const getLogBatch = async ({
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const query = await buildLogQuery({
    endTime,
    extraFields,
    limit,
    offset,
    order,
    q,
    startTime,
    tableVersion,
    teamId,
  });

  let result: ResponseJSON<{
    id: string;
    timestamp: string;
    severity_text: string;
    body: string;
    _host: string;
    _source: string;
  }>;
  await tracer.startActiveSpan('clickhouse.getLogBatch', async span => {
    span.setAttribute('query', query);

    const rows = await client.query({
      query,
      format: 'JSON',
      clickhouse_settings: {
        additional_table_filters: buildLogStreamAdditionalFilters(
          tableVersion,
          teamId,
        ),
      },
    });
    result = await rows.json<
      ResponseJSON<{
        id: string;
        timestamp: string;
        severity_text: string;
        body: string;
        _host: string;
        _source: string;
      }>
    >();
    span.setAttribute('results', result.data.length);
    span.end();
  });

  return result;
};

export const getRrwebEvents = async ({
  sessionId,
  startTime,
  endTime,
  limit,
  offset,
}: {
  sessionId: string;
  startTime: number; // unix in ms
  endTime: number; // unix in ms
  limit: number;
  offset: number;
}) => {
  const columns = [
    'body AS b',
    'type AS t',
    `${buildSearchColumnName_OLD('number', 'rr-web.chunk')} as ck`,
    `${buildSearchColumnName_OLD('number', 'rr-web.total-chunks')} as tcks`,
  ].map(SqlString.raw);

  const query = SqlString.format(
    `
      SELECT ?
      FROM default.rrweb
      WHERE session_id = ?
      AND _timestamp_sort_key >= ?
      AND _timestamp_sort_key < ?
      ORDER BY _timestamp_sort_key, ck ASC
      LIMIT ?, ?
    `,
    [
      columns,
      sessionId,
      msToBigIntNs(startTime),
      msToBigIntNs(endTime),
      offset,
      limit,
    ],
  );

  let resultSet: ResultSet;
  await tracer.startActiveSpan('clickhouse.getRrwebEvents', async span => {
    span.setAttribute('query', query);

    resultSet = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        wait_end_of_query: 0,
        send_progress_in_http_headers: 0,
      } as any,
    });
    span.end();
  });

  return resultSet.stream();
};

export const getLogStream = async ({
  endTime,
  extraFields = [],
  limit,
  offset,
  order,
  q,
  startTime,
  tableVersion,
  teamId,
}: {
  endTime: number; // unix in ms
  extraFields?: string[];
  limit: number;
  offset: number;
  order: SortOrder;
  q: string;
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  const query = await buildLogQuery({
    endTime,
    extraFields,
    limit,
    offset,
    order,
    q,
    startTime,
    tableVersion,
    teamId,
  });

  logger.info({
    message: 'generated getLogStream Query',
    teamId,
    query,
    limit,
  });

  let resultSet: ResultSet;
  await tracer.startActiveSpan('clickhouse.getLogStream', async span => {
    span.setAttribute('query', query);
    span.setAttribute('search', q);
    span.setAttribute('teamId', teamId);
    try {
      resultSet = await client.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: {
          additional_table_filters: buildLogStreamAdditionalFilters(
            tableVersion,
            teamId,
          ),
          send_progress_in_http_headers: 0,
          wait_end_of_query: 0,
        },
      });
    } catch (e: any) {
      span.recordException(e);

      throw e;
    } finally {
      span.end();
    }
  });

  return resultSet.stream();
};
