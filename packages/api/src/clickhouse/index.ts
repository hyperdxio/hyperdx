import {
  BaseResultSet,
  createClient,
  ErrorLogParams as _CHErrorLogParams,
  Logger as _CHLogger,
  LogParams as _CHLogParams,
  ResponseJSON,
  SettingsMap,
} from '@clickhouse/client';
import opentelemetry from '@opentelemetry/api';
import * as fns from 'date-fns';
import _ from 'lodash';
import ms from 'ms';
import { serializeError } from 'serialize-error';
import SqlString from 'sqlstring';
import { Readable } from 'stream';
import { z } from 'zod';

import * as config from '@/config';
import { sleep } from '@/utils/common';
import logger from '@/utils/logger';
import type {
  LogStreamModel,
  MetricModel,
  RrwebEventModel,
} from '@/utils/logParser';
import { chartSeriesSchema } from '@/utils/zod';

import { redisClient } from '../utils/redis';
import {
  LogsPropertyTypeMappingsModel,
  MetricsPropertyTypeMappingsModel,
} from './propertyTypeMappingsModel';
import {
  buildSearchColumnName,
  buildSearchColumnName_OLD,
  buildSearchQueryWhereCondition,
  isCustomColumn,
  msToBigIntNs,
  SearchQueryBuilder,
  SQLSerializer,
} from './searchQueryParser';

const tracer = opentelemetry.trace.getTracer(__filename);

export type SortOrder = 'asc' | 'desc' | null;

export enum SeriesReturnType {
  Ratio = 'ratio',
  Column = 'column',
}

export enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
}

export enum AggFn {
  Avg = 'avg',
  AvgRate = 'avg_rate',
  Count = 'count',
  CountDistinct = 'count_distinct',
  CountPerHour = 'count_per_hour',
  CountPerMin = 'count_per_min',
  CountPerSec = 'count_per_sec',
  LastValue = 'last_value',
  Max = 'max',
  MaxRate = 'max_rate',
  Min = 'min',
  MinRate = 'min_rate',
  P50 = 'p50',
  P50Rate = 'p50_rate',
  P90 = 'p90',
  P90Rate = 'p90_rate',
  P95 = 'p95',
  P95Rate = 'p95_rate',
  P99 = 'p99',
  P99Rate = 'p99_rate',
  Sum = 'sum',
  SumRate = 'sum_rate',
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
    date_time_output_format: 'iso',
    max_download_buffer_size: (10 * 1024 * 1024).toString(), // default
    max_download_threads: 32,
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

export const buildMetricStreamAdditionalFilters = (
  version: number | undefined | null,
  teamId: string,
) => SettingsMap.from({});

export const healthCheck = async () => {
  const result = await client.ping();
  if (!result.success) {
    logger.error({
      message: 'ClickHouse health check failed',
      error: result.error,
    });
    throw result.error;
  }
};

export const connect = async () => {
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
        is_delta Boolean CODEC(Delta, ZSTD(1)),
        is_monotonic Boolean CODEC(Delta, ZSTD(1)),
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
) => new MetricsPropertyTypeMappingsModel(tableVersion, teamId);

// TODO: move this to PropertyTypeMappingsModel
export const doesLogsPropertyExist = (
  property: string | undefined,
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

export const getMetricsTags = async ({
  teamId,
  startTime,
  endTime,
}: {
  teamId: string;
  startTime: number; // unix in ms
  endTime: number; // unix in ms
}) => {
  const tableName = `default.${TableName.Metric}`;
  // TODO: remove 'data_type' in the name field
  const query = SqlString.format(
    `
        SELECT
          any(is_delta) as is_delta,
          any(is_monotonic) as is_monotonic,
          any(unit) as unit,
          data_type,
          format('{} - {}', name, data_type) as name,
          groupUniqArray(_string_attributes) AS tags
        FROM ??
        WHERE (?)
        GROUP BY name, data_type
        ORDER BY name
    `,
    [
      tableName,
      SqlString.raw(SearchQueryBuilder.timestampInBetween(startTime, endTime)),
    ],
  );
  const ts = Date.now();
  const rows = await client.query({
    query,
    format: 'JSON',
    clickhouse_settings: {
      additional_table_filters: buildMetricStreamAdditionalFilters(
        null,
        teamId,
      ),
    },
  });
  const result = await rows.json<
    ResponseJSON<{
      data_type: string;
      is_delta: boolean;
      is_monotonic: boolean;
      name: string;
      tags: Record<string, string>[];
      unit: string;
    }>
  >();
  logger.info({
    message: 'getMetricsTags',
    query,
    took: Date.now() - ts,
  });
  return result;
};

export const isRateAggFn = (aggFn: AggFn) => {
  return (
    aggFn === AggFn.SumRate ||
    aggFn === AggFn.AvgRate ||
    aggFn === AggFn.MaxRate ||
    aggFn === AggFn.MinRate ||
    aggFn === AggFn.P50Rate ||
    aggFn === AggFn.P90Rate ||
    aggFn === AggFn.P95Rate ||
    aggFn === AggFn.P99Rate
  );
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
  dataType: MetricsDataType;
  endTime: number; // unix in ms,
  granularity: Granularity | string;
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

  const isRate = isRateAggFn(aggFn);

  if (dataType === MetricsDataType.Gauge || dataType === MetricsDataType.Sum) {
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
        : aggFn === AggFn.SumRate
        ? `SUM(rate) as data`
        : aggFn === AggFn.AvgRate
        ? `AVG(rate) as data`
        : aggFn === AggFn.MaxRate
        ? `MAX(rate) as data`
        : aggFn === AggFn.MinRate
        ? `MIN(rate) as data`
        : `quantile(${
            aggFn === AggFn.P50 || aggFn === AggFn.P50Rate
              ? '0.5'
              : aggFn === AggFn.P90 || aggFn === AggFn.P90Rate
              ? '0.90'
              : aggFn === AggFn.P95 || aggFn === AggFn.P95Rate
              ? '0.95'
              : '0.99'
          })(${isRate ? 'rate' : 'value'}) as data`,
    );
  } else {
    logger.error(`Unsupported data type: ${dataType}`);
  }

  // used to sum/avg/percentile Sum metrics
  // max/min don't require pre-bucketing the Sum timeseries
  const sumMetricSource = SqlString.format(
    `
      SELECT
        toStartOfInterval(timestamp, INTERVAL ?) as timestamp,
        min(value) as value,
        _string_attributes,
        name
      FROM ??
      WHERE name = ?
      AND data_type = ?
      AND (?)
      GROUP BY
        name,
        _string_attributes,
        timestamp
      ORDER BY
        _string_attributes,
        timestamp ASC
    `.trim(),
    [granularity, tableName, name, dataType, SqlString.raw(whereClause)],
  );

  const rateMetricSource = SqlString.format(
    `
      SELECT
        if(
          runningDifference(value) < 0
          OR neighbor(_string_attributes, -1, _string_attributes) != _string_attributes,
          nan,
          runningDifference(value)
        ) AS rate,
        timestamp,
        _string_attributes,
        name
      FROM (?)
      WHERE isNaN(rate) = 0
    `.trim(),
    [SqlString.raw(sumMetricSource)],
  );

  const gaugeMetricSource = SqlString.format(
    `
      SELECT
        toStartOfInterval(timestamp, INTERVAL ?) as timestamp,
        name,
        last_value(value) as value,
        _string_attributes
      FROM ??
      WHERE name = ?
      AND data_type = ?
      AND (?)
      GROUP BY name, _string_attributes, timestamp
      ORDER BY timestamp ASC
    `.trim(),
    [granularity, tableName, name, dataType, SqlString.raw(whereClause)],
  );

  const query = SqlString.format(
    `
      WITH metrics AS (?)
      SELECT ?
      FROM metrics
      GROUP BY group, ts_bucket
      ORDER BY ts_bucket ASC
      WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?
    `,
    [
      SqlString.raw(
        isRate
          ? rateMetricSource
          : // Max/Min aggs are the same for both Sum and Gauge metrics
          dataType === 'Sum' && aggFn != AggFn.Max && aggFn != AggFn.Min
          ? sumMetricSource
          : gaugeMetricSource,
      ),
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
    clickhouse_settings: {
      additional_table_filters: buildMetricStreamAdditionalFilters(
        null,
        teamId,
      ),
    },
  });
  const result = await rows.json<
    ResponseJSON<{
      data: number;
      group: string;
      ts_bucket: number;
    }>
  >();
  logger.info({
    message: 'getMetricsChart',
    query,
    teamId,
    took: Date.now() - ts,
  });
  return result;
};

// TODO: support multiple groupBy
export const buildMetricSeriesQuery = async ({
  aggFn,
  dataType,
  endTime,
  granularity,
  groupBy,
  name,
  q,
  startTime,
  teamId,
  sortOrder,
  propertyTypeMappingsModel,
}: {
  aggFn: AggFn;
  dataType: MetricsDataType;
  endTime: number; // unix in ms,
  granularity?: Granularity | string;
  groupBy?: string;
  name: string;
  q: string;
  startTime: number; // unix in ms
  teamId: string;
  sortOrder?: 'asc' | 'desc';
  propertyTypeMappingsModel: MetricsPropertyTypeMappingsModel;
}) => {
  const tableName = `default.${TableName.Metric}`;

  const isRate = isRateAggFn(aggFn);

  const shouldModifyStartTime = isRate;

  // If it's a rate function, then we'll need to look 1 window back to calculate
  // the initial rate value.
  // We'll filter this extra bucket out later
  const modifiedStartTime = shouldModifyStartTime
    ? // If granularity is not defined (tables), we'll just look behind 5min
      startTime - ms(granularity ?? '5 minute')
    : startTime;

  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime: modifiedStartTime,
  });
  const selectClause = [
    granularity != null
      ? SqlString.format(
          'toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) AS ts_bucket',
          [granularity],
        )
      : "'0' as ts_bucket",
    groupBy
      ? SqlString.format(`[_string_attributes[?]] AS group`, [groupBy])
      : '[] AS group',
  ];

  const hasGroupBy = groupBy != '' && groupBy != null;

  if (dataType === MetricsDataType.Gauge || dataType === MetricsDataType.Sum) {
    selectClause.push(
      aggFn === AggFn.Count
        ? 'COUNT(value) as data'
        : aggFn === AggFn.LastValue
        ? 'LAST_VALUE(value) as data'
        : aggFn === AggFn.Sum
        ? `SUM(value) as data`
        : aggFn === AggFn.Avg
        ? `AVG(value) as data`
        : aggFn === AggFn.Max
        ? `MAX(value) as data`
        : aggFn === AggFn.Min
        ? `MIN(value) as data`
        : aggFn === AggFn.SumRate
        ? `SUM(rate) as data`
        : aggFn === AggFn.AvgRate
        ? `AVG(rate) as data`
        : aggFn === AggFn.MaxRate
        ? `MAX(rate) as data`
        : aggFn === AggFn.MinRate
        ? `MIN(rate) as data`
        : `quantile(${
            aggFn === AggFn.P50 || aggFn === AggFn.P50Rate
              ? '0.5'
              : aggFn === AggFn.P90 || aggFn === AggFn.P90Rate
              ? '0.90'
              : aggFn === AggFn.P95 || aggFn === AggFn.P95Rate
              ? '0.95'
              : '0.99'
          })(${isRate ? 'rate' : 'value'}) as data`,
    );
  } else {
    logger.error(`Unsupported data type: ${dataType}`);
  }

  const startTimeUnixTs = Math.floor(startTime / 1000);

  // TODO: Can remove the ORDER BY _string_attributes for Gauge metrics
  // since they don't get subjected to runningDifference afterwards
  const gaugeMetricSource = SqlString.format(
    `
      SELECT
        ?,
        name,
        last_value(value) as value,
        _string_attributes
      FROM ??
      WHERE name = ?
      AND data_type = ?
      AND (?)
      GROUP BY name, _string_attributes, timestamp
      ORDER BY _string_attributes, timestamp ASC
    `.trim(),
    [
      SqlString.raw(
        granularity != null
          ? `toStartOfInterval(timestamp, INTERVAL ${SqlString.format(
              granularity,
            )}) as timestamp`
          : modifiedStartTime
          ? // Manually create the time buckets if we're including the prev time range
            `if(timestamp < fromUnixTimestamp(${startTimeUnixTs}), 0, ${startTimeUnixTs}) as timestamp`
          : // Otherwise lump everything into one bucket
            '0 as timestamp',
      ),
      tableName,
      name,
      dataType,
      SqlString.raw(whereClause),
    ],
  );

  const rateMetricSource = SqlString.format(
    `
      SELECT
        if(
          runningDifference(value) < 0
          OR neighbor(_string_attributes, -1, _string_attributes) != _string_attributes,
          nan,
          runningDifference(value)
        ) AS rate,
        timestamp,
        _string_attributes,
        name
      FROM (?)
      WHERE isNaN(rate) = 0
      ${shouldModifyStartTime ? 'AND timestamp >= fromUnixTimestamp(?)' : ''}
    `.trim(),
    [
      SqlString.raw(gaugeMetricSource),
      ...(shouldModifyStartTime ? [Math.floor(startTime / 1000)] : []),
    ],
  );

  const query = SqlString.format(
    `
      WITH metrics AS (?)
      SELECT ?
      FROM metrics
      GROUP BY group, ts_bucket
      ORDER BY ts_bucket ASC
      ${
        granularity != null
          ? `WITH FILL
        FROM toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        TO toUnixTimestamp(toStartOfInterval(toDateTime(?), INTERVAL ?))
        STEP ?`
          : ''
      }
    `,
    [
      SqlString.raw(isRate ? rateMetricSource : gaugeMetricSource),
      SqlString.raw(selectClause.join(',')),
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

  return {
    query,
    hasGroupBy,
    sortOrder,
  };
};

const buildEventSeriesQuery = async ({
  aggFn,
  endTime,
  field,
  granularity,
  groupBy,
  propertyTypeMappingsModel,
  q,
  sortOrder,
  startTime,
  tableVersion,
  teamId,
}: {
  aggFn: AggFn;
  endTime: number; // unix in ms,
  field?: string;
  granularity: string | undefined; // can be undefined in the number chart
  groupBy: string[];
  propertyTypeMappingsModel: LogsPropertyTypeMappingsModel;
  q: string;
  sortOrder?: 'asc' | 'desc';
  startTime: number; // unix in ms
  tableVersion: number | undefined;
  teamId: string;
}) => {
  if (isRateAggFn(aggFn)) {
    throw new Error('Rate is not supported in logs chart');
  }

  const isCountFn =
    aggFn === AggFn.Count ||
    aggFn === AggFn.CountPerSec ||
    aggFn === AggFn.CountPerMin ||
    aggFn === AggFn.CountPerHour;

  if (field == null && !isCountFn) {
    throw new Error(
      'Field is required for all aggregation functions except Count',
    );
  }

  const tableName = getLogStreamTableName(tableVersion, teamId);
  const whereClause = await buildSearchQueryWhereCondition({
    endTime,
    propertyTypeMappingsModel,
    query: q,
    startTime,
  });

  const selectField =
    field != null
      ? buildSearchColumnName(propertyTypeMappingsModel.get(field), field)
      : '';

  const groupByColumnNames = groupBy.map(g => {
    const columnName = buildSearchColumnName(
      propertyTypeMappingsModel.get(g),
      g,
    );
    if (columnName != null) {
      return columnName;
    }
    throw new Error(`Group by field ${g} does not exist`);
  });

  const hasGroupBy = groupByColumnNames.length > 0;

  const serializer = new SQLSerializer(propertyTypeMappingsModel);

  // compute additional where clause for group-by fields + select field
  let additionalSelectFieldCheck = '';
  let additionalGroupByFieldCheck = '';
  if (!isCountFn && field != null) {
    const _condition = await serializer.isNotNull(field, false);
    additionalSelectFieldCheck = ` AND (${_condition})`;
  }
  if (hasGroupBy) {
    const _conditions = await Promise.all(
      groupBy.map(g => serializer.isNotNull(g, false)),
    );
    additionalGroupByFieldCheck = ` AND (${_conditions.join(' AND ')})`;
  }

  const label = SqlString.escape(`${aggFn}(${field})`);

  const selectClause = [
    aggFn === AggFn.Count
      ? 'toFloat64(count()) as data'
      : aggFn === AggFn.CountPerSec
      ? granularity
        ? SqlString.format('divide(count(), ?) as data', [
            ms(granularity) / ms('1 second'),
          ])
        : SqlString.format(
            "divide(count(), age('ss', toDateTime(?), toDateTime(?))) as data",
            [startTime / 1000, endTime / 1000],
          )
      : aggFn === AggFn.CountPerMin
      ? granularity
        ? SqlString.format('divide(count(), ?) as data', [
            ms(granularity) / ms('1 minute'),
          ])
        : SqlString.format(
            "divide(count(), age('mi', toDateTime(?), toDateTime(?))) as data",
            [startTime / 1000, endTime / 1000],
          )
      : aggFn === AggFn.CountPerHour
      ? granularity
        ? SqlString.format('divide(count(), ?) as data', [
            ms(granularity) / ms('1 hour'),
          ])
        : SqlString.format(
            "divide(count(), age('hh', toDateTime(?), toDateTime(?))) as data",
            [startTime / 1000, endTime / 1000],
          )
      : aggFn === AggFn.LastValue
      ? `toFloat64(last_value(${selectField})) as data`
      : aggFn === AggFn.Sum
      ? `toFloat64(sum(${selectField})) as data`
      : aggFn === AggFn.Avg
      ? `toFloat64(avg(${selectField})) as data`
      : aggFn === AggFn.Max
      ? `toFloat64(max(${selectField})) as data`
      : aggFn === AggFn.Min
      ? `toFloat64(min(${selectField})) as data`
      : aggFn === AggFn.CountDistinct
      ? `toFloat64(count(distinct ${selectField})) as data`
      : `toFloat64(quantile(${
          aggFn === AggFn.P50
            ? '0.5'
            : aggFn === AggFn.P90
            ? '0.90'
            : aggFn === AggFn.P95
            ? '0.95'
            : '0.99'
        })(${selectField})) as data`,
    granularity != null
      ? `toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ${granularity})) as ts_bucket`
      : "'0' as ts_bucket",
    hasGroupBy ? `[${groupByColumnNames.join(',')}] as group` : `[] as group`, // FIXME: should we fallback to use aggFn as group
    `${label} as label`,
  ].join(',');

  const groupByClause = ['ts_bucket', ...groupByColumnNames].join(',');

  const query = SqlString.format(
    `
      SELECT ?
      FROM ??
      WHERE ? AND (?) ? ?
      GROUP BY ?
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
      SqlString.raw(additionalSelectFieldCheck),
      SqlString.raw(additionalGroupByFieldCheck),
      SqlString.raw(groupByClause),
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

  return {
    query,
    hasGroupBy,
    sortOrder,
  };
};

export const queryMultiSeriesChart = async ({
  maxNumGroups,
  tableVersion,
  teamId,
  seriesReturnType = SeriesReturnType.Column,
  queries,
}: {
  maxNumGroups: number;
  tableVersion: number | undefined;
  teamId: string;
  seriesReturnType?: SeriesReturnType;
  queries: { query: string; hasGroupBy: boolean; sortOrder?: 'desc' | 'asc' }[];
}) => {
  // For now only supports same-table series with the same groupBy

  const seriesCTEs = queries
    .map((q, i) => `series_${i} AS (${q.query})`)
    .join(',\n');

  // Only join on group bys if all queries have group bys
  // TODO: This will not work for an array of group by fields
  const allQueiesHaveGroupBy = queries.every(q => q.hasGroupBy);

  let seriesIndexWithSorting = -1;
  let sortOrder: 'asc' | 'desc' = 'desc';
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (q.sortOrder === 'asc' || q.sortOrder === 'desc') {
      seriesIndexWithSorting = i;
      sortOrder = q.sortOrder;
      break;
    }
  }

  let leftJoin = '';
  // Join every series after the first one
  for (let i = 1; i < queries.length; i++) {
    leftJoin += `LEFT JOIN series_${i} ON series_${i}.ts_bucket=series_0.ts_bucket${
      allQueiesHaveGroupBy ? ` AND series_${i}.group = series_0.group` : ''
    }\n`;
  }

  const select =
    seriesReturnType === 'column'
      ? queries
          .map((_, i) => {
            return `series_${i}.data as "series_${i}.data"`;
          })
          .join(',\n')
      : 'series_0.data / series_1.data as "series_0.data"';

  // Return each series data as a separate column
  const query = SqlString.format(
    `WITH ? 
      ,raw_groups AS (
        SELECT 
          ?,
          series_0.ts_bucket as ts_bucket, 
          series_0.group as group
        FROM series_0 AS series_0
        ?
      ), groups AS (
        SELECT *, ?(?) OVER (PARTITION BY group) as rank_order_by_value
        FROM raw_groups
      ), final AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY rank_order_by_value ?) as rank
        FROM groups
      )
      SELECT *
      FROM final
      WHERE rank <= ?
      ORDER BY ts_bucket ASC
      ?
    `,
    [
      SqlString.raw(seriesCTEs),
      SqlString.raw(select),
      SqlString.raw(leftJoin),
      // Setting rank_order_by_value
      SqlString.raw(sortOrder === 'asc' ? 'MIN' : 'MAX'),
      SqlString.raw(
        // If ratio, we judge on series_0
        seriesReturnType === 'ratio'
          ? 'series_0.data'
          : // If the user specified a sorting order, we use that
          seriesIndexWithSorting > -1
          ? `series_${seriesIndexWithSorting}.data`
          : // Otherwise we just grab the greatest value
            `greatest(${queries.map((_, i) => `series_${i}.data`).join(', ')})`,
      ),
      // ORDER BY rank_order_by_value ....
      SqlString.raw(sortOrder === 'asc' ? 'ASC' : 'DESC'),
      maxNumGroups,
      // Final row sort ordering
      SqlString.raw(
        sortOrder === 'asc' || sortOrder === 'desc'
          ? `, series_${
              seriesIndexWithSorting > -1 ? seriesIndexWithSorting : 0
            }.data ${sortOrder}`
          : '',
      ),
    ],
  );

  const rows = await client.query({
    query,
    format: 'JSON',
  });

  const result = await rows.json<
    ResponseJSON<{
      ts_bucket: number;
      group: string[];
      [series_data: `series_${number}.data`]: number;
    }>
  >();
  return result;
};

export const getMultiSeriesChart = async ({
  series,
  endTime,
  granularity,
  maxNumGroups,
  startTime,
  tableVersion,
  teamId,
  seriesReturnType = SeriesReturnType.Column,
}: {
  series: z.infer<typeof chartSeriesSchema>[];
  endTime: number; // unix in ms,
  startTime: number; // unix in ms
  granularity: string | undefined; // can be undefined in the number chart
  maxNumGroups: number;
  tableVersion: number | undefined;
  teamId: string;
  seriesReturnType?: SeriesReturnType;
}) => {
  let queries: {
    query: string;
    hasGroupBy: boolean;
    sortOrder?: 'desc' | 'asc';
  }[] = [];
  if (
    // Default table is logs
    ('table' in series[0] &&
      (series[0].table === 'logs' || series[0].table == null)) ||
    !('table' in series[0])
  ) {
    const propertyTypeMappingsModel = await buildLogsPropertyTypeMappingsModel(
      tableVersion,
      teamId.toString(),
      startTime,
      endTime,
    );

    const propertySet = new Set<string>();
    series.map(s => {
      if ('field' in s && s.field != null) {
        propertySet.add(s.field);
      }
      if ('groupBy' in s && s.groupBy.length > 0) {
        s.groupBy.map(g => propertySet.add(g));
      }
    });

    // Hack to refresh property cache if needed
    const properties = Array.from(propertySet);

    if (
      properties.some(p => {
        return !doesLogsPropertyExist(p, propertyTypeMappingsModel);
      })
    ) {
      logger.warn({
        message: `getChart: Property type mappings cache is out of date (${properties.join(
          ', ',
        )})`,
      });
      await propertyTypeMappingsModel.refresh();
    }

    queries = await Promise.all(
      series.map(s => {
        if (s.type != 'time' && s.type != 'table') {
          throw new Error(`Unsupported series type: ${s.type}`);
        }
        if (s.table != 'logs' && s.table != null) {
          throw new Error(`All series must have the same table`);
        }

        return buildEventSeriesQuery({
          aggFn: s.aggFn,
          endTime,
          field: s.field,
          granularity,
          groupBy: s.groupBy,
          propertyTypeMappingsModel,
          q: s.where,
          sortOrder: s.type === 'table' ? s.sortOrder : undefined,
          startTime,
          tableVersion,
          teamId,
        });
      }),
    );
  } else if ('table' in series[0] && series[0].table === 'metrics') {
    const propertyTypeMappingsModel =
      await buildMetricsPropertyTypeMappingsModel(
        undefined, // default version
        teamId,
      );

    queries = await Promise.all(
      series.map(s => {
        if (s.type != 'time' && s.type != 'table') {
          throw new Error(`Unsupported series type: ${s.type}`);
        }
        if (s.table != 'metrics') {
          throw new Error(`All series must have the same table`);
        }
        if (s.field == null) {
          throw new Error('Metric name is required');
        }
        if (s.metricDataType == null) {
          throw new Error('Metric data type is required');
        }

        return buildMetricSeriesQuery({
          aggFn: s.aggFn,
          endTime,
          name: s.field,
          granularity,
          groupBy: s.groupBy[0],
          sortOrder: s.type === 'table' ? s.sortOrder : undefined,
          q: s.where,
          startTime,
          teamId,
          dataType: s.metricDataType,
          propertyTypeMappingsModel,
        });
      }),
    );
  }

  return queryMultiSeriesChart({
    maxNumGroups,
    tableVersion,
    teamId,
    seriesReturnType,
    queries,
  });
};

export const getMultiSeriesChartLegacyFormat = async ({
  series,
  endTime,
  granularity,
  maxNumGroups,
  startTime,
  tableVersion,
  teamId,
  seriesReturnType,
}: {
  series: z.infer<typeof chartSeriesSchema>[];
  endTime: number; // unix in ms,
  startTime: number; // unix in ms
  granularity: string | undefined; // can be undefined in the number chart
  maxNumGroups: number;
  tableVersion: number | undefined;
  teamId: string;
  seriesReturnType?: SeriesReturnType;
}) => {
  const result = await getMultiSeriesChart({
    series,
    endTime,
    granularity,
    maxNumGroups,
    startTime,
    tableVersion,
    teamId,
    seriesReturnType,
  });

  const flatData = result.data.flatMap(row => {
    if (seriesReturnType === 'column') {
      return series.map((_, i) => {
        return {
          ts_bucket: row.ts_bucket,
          group: row.group,
          data: row[`series_${i}.data`],
        };
      });
    }

    // Ratio only has 1 series
    return [
      {
        ts_bucket: row.ts_bucket,
        group: row.group,
        data: row['series_0.data'],
      },
    ];
  });

  return {
    rows: flatData.length,
    data: flatData,
  };
};

// This query needs to be generalized and replaced once use-case matures
export const getSpanPerformanceChart = async ({
  parentSpanWhere,
  childrenSpanWhere,
  teamId,
  tableVersion,
  maxNumGroups,
  propertyTypeMappingsModel,
  startTime,
  endTime,
}: {
  parentSpanWhere: string;
  childrenSpanWhere: string;
  tableVersion: number | undefined;
  teamId: string;
  maxNumGroups: number;
  endTime: number; // unix in ms,
  startTime: number;
  propertyTypeMappingsModel: LogsPropertyTypeMappingsModel;
}) => {
  const tableName = getLogStreamTableName(tableVersion, teamId);

  const [parentSpanWhereCondition, childrenSpanWhereCondition] =
    await Promise.all([
      buildSearchQueryWhereCondition({
        endTime,
        propertyTypeMappingsModel,
        query: parentSpanWhere,
        startTime,
      }),
      buildSearchQueryWhereCondition({
        endTime,
        propertyTypeMappingsModel,
        query: childrenSpanWhere,
        startTime,
      }),
    ]);

  // This needs to return in a format that matches multi-series charts
  const query = SqlString.format(
    `WITH trace_ids AS (
SELECT 
  distinct trace_id
FROM ??
WHERE (?)
)
SELECT 
  [
    span_name, 
    if(
      span_name = 'HTTP DELETE'
      OR span_name = 'DELETE'
      OR span_name = 'HTTP GET'
      OR span_name = 'GET'
      OR span_name = 'HTTP HEAD'
      OR span_name = 'HEAD'
      OR span_name = 'HTTP OPTIONS'
      OR span_name = 'OPTIONS'
      OR span_name = 'HTTP PATCH'
      OR span_name = 'PATCH'
      OR span_name = 'HTTP POST'
      OR span_name = 'POST'
      OR span_name = 'HTTP PUT'
      OR span_name = 'PUT',
      COALESCE(
        NULLIF(_string_attributes['server.address'], ''), 
        NULLIF(_string_attributes['http.host'], '')
      ),
      '' 
    )
  ] as "group",
  sum(_duration) as "series_0.data",
  count(*) as "series_1.data", 
  avg(_duration) as "series_2.data", 
  min(_duration) as "series_3.data", 
  max(_duration) as "series_4.data",
  count(distinct trace_id) as "series_5.data",
  "series_1.data" / "series_5.data" as "series_6.data",
  '0' as "ts_bucket"
FROM ??
WHERE 
  (?)
  AND trace_id IN (SELECT trace_id FROM trace_ids)
  AND _duration >= 0
GROUP BY "group"
ORDER BY "series_0.data" DESC
LIMIT ?`,
    [
      tableName,
      SqlString.raw(parentSpanWhereCondition),
      tableName,
      SqlString.raw(childrenSpanWhereCondition),
      maxNumGroups,
    ],
  );

  return await tracer.startActiveSpan(
    'clickhouse.getSpanPerformanceChart',
    async span => {
      try {
        span.setAttribute('query', query);
        logger.info({ query });

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
          ResponseJSON<{
            data: string;
            ts_bucket: number;
            group: string[];
          }>
        >();
        return result;
      } catch (e) {
        span.recordException(e as any);
        span.end();
        throw e;
      } finally {
        span.end();
      }
    },
  );
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
  if (isRateAggFn(aggFn)) {
    throw new Error('Rate is not supported in logs chart');
  }

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
      const result = await rows.json<
        ResponseJSON<{
          data: string;
          ts_bucket: number;
          group: string;
          rank: string;
          rank_order_by_value: string;
        }>
      >();
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

  const componentField = buildSearchColumnName('string', 'component');
  const sessionIdField = buildSearchColumnName('string', 'rum_session_id');
  if (!componentField || !sessionIdField) {
    throw new Error('component or sessionId is null');
  }

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
      SqlString.raw(componentField),
      SqlString.raw(sessionIdField),
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

// TODO: support multiple group bys
// FIXME: return 'group' field should be array type
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
        count(*) as data,
        toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL ?)) as ts_bucket
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
    ResponseJSON<{ data: string; group?: string; ts_bucket: number }>
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

  // @ts-ignore
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

  // @ts-ignore
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

  let resultSet: BaseResultSet<Readable>;
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

  // @ts-ignore
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

  let resultSet: BaseResultSet<Readable>;
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

  // @ts-ignore
  return resultSet.stream();
};
