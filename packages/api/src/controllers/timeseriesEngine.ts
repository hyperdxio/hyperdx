import {
  ChSql,
  chSql,
  concatChSql,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Metadata,
  MetadataCache,
} from '@hyperdx/common-utils/dist/core/metadata';

import { ClickhouseClient } from '@/clickhouse';
import logger from '@/utils/logger';

export const PROMETHEUS_MAX_EXECUTION_SEC = 30;
export const PROMETHEUS_MAX_RESULT_ROWS = 100000;
export const PROMETHEUS_CH_TIMEOUT_MS = 30_000;

/**
 * Join a Connection host with an absolute Prometheus API path.
 *
 * `new URL('/api/v1/query_range', 'http://host:8481/select/0/prometheus')`
 * discards `/select/0/prometheus` because an absolute path replaces the base
 * pathname. VictoriaMetrics cluster (and any Prometheus-compatible server
 * mounted under a prefix) needs that prefix kept. Host userinfo, query, and
 * hash are left untouched.
 *
 * `path` must be an absolute path (every call site passes a literal starting
 * with `/`) -- this is not a general-purpose URL joiner.
 *
 * @see https://github.com/hyperdxio/hyperdx/issues/3046
 */
export function joinPrometheusUpstreamUrl(
  upstreamHost: string,
  path: string,
): URL {
  const url = new URL(upstreamHost);
  // `new URL('prometheus:9090')` succeeds with an opaque path (`prometheus:`
  // scheme). The pathname setter is a no-op there, so without this guard the
  // helper would return the host unchanged, `fetch` would fail, and the proxy
  // would 502 / increment query_errors for a user misconfiguration. Same check
  // as clickhouseProxy.ts.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Connection host must be http(s)');
  }
  // Strip ALL trailing slashes, not just one -- a host saved with a doubled
  // trailing slash (e.g. `http://prom:9090//`) would otherwise leave a `//`
  // in the joined path, which most servers treat as a distinct (404) path.
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${path}`;
  return url;
}

export type TimeSeriesTagsQueryArgs = {
  client: ClickhouseClient;
  connectionId: string;
  databaseName: string;
  tableName: string;
  startMs?: number;
  endMs?: number;
  limit?: number;
  match?: string[];
};

/**
 * Indicates whether the tags inner table associated with the given TimeSeries table
 * includes the optional `min_time` and `max_time` columns.
 */
async function timeSeriesTagsTableHasTimeBounds({
  metadata,
  connectionId,
  database,
  table,
}: {
  metadata: Metadata;
  connectionId: string;
  database: string;
  table: string;
}): Promise<boolean> {
  try {
    const columns = await metadata.getTimeSeriesTableColumns({
      connectionId,
      databaseName: database,
      tableName: table,
      innerTableType: 'Tags',
    });

    const columnNames = new Set(columns.map(column => column.name));
    return columnNames.has('min_time') && columnNames.has('max_time');
  } catch (e) {
    logger.warn(
      { err: e, database, table },
      'Failed to check if TimeSeries tags table has time bounds columns',
    );
    return false;
  }
}

// `timeSeriesSelector()` requires both bounds, so we define the minimum and maximum possible times
// as default bounds when explicit bounds are not provided.
const TIMESERIES_MIN_TIME_MS = -2208988800000; // 1900-01-01T00:00:00Z
const TIMESERIES_MAX_TIME_MS = 10413791999999; // 2299-12-31T23:59:59.999Z

/**
 * Returns a predicate keeping only the series matched by at least one of
 * the given `match` selectors.
 */
function getSeriesSelectorCondition({
  databaseName,
  tableName,
  match,
  startMs,
  endMs,
}: {
  databaseName: string;
  tableName: string;
  match: string[];
  startMs?: number;
  endMs?: number;
}): ChSql {
  const minTime = { Int64: startMs ?? TIMESERIES_MIN_TIME_MS };
  const maxTime = { Int64: endMs ?? TIMESERIES_MAX_TIME_MS };
  const idsPerSelector = match.map(
    selector => chSql`
      SELECT id
      FROM timeSeriesSelector(
        ${{ String: databaseName }},
        ${{ String: tableName }},
        ${{ String: selector }},
        fromUnixTimestamp64Milli(${minTime}),
        fromUnixTimestamp64Milli(${maxTime})
      )`,
  );

  return chSql`id IN (${concatChSql(' UNION DISTINCT ', idsPerSelector)})`;
}

/**
 * Returns SQL predicates restricting tags rows to the series a label lookup
 * should consider: those overlapping [startMs, endMs], and those matched by
 * `match`. Empty when neither is given.
 */
async function getSeriesFilterConditions({
  client,
  connectionId,
  databaseName,
  tableName,
  startMs,
  endMs,
  match,
}: Omit<TimeSeriesTagsQueryArgs, 'limit'>): Promise<ChSql[]> {
  const selectors = match?.length ? match : undefined;
  if (startMs == null && endMs == null && selectors == null) return [];

  // Both filters lean on min_time/max_time, which the tags inner table carries
  // only when the table was created with store_min_time_and_max_time on.
  const metadata = new Metadata(client, new MetadataCache());
  const tableHasTimeBounds = await timeSeriesTagsTableHasTimeBounds({
    metadata,
    connectionId,
    database: databaseName,
    table: tableName,
  });

  const conditions: ChSql[] = [];

  if (selectors != null) {
    // timeSeriesSelector() prunes on min_time/max_time unconditionally, so
    // without those columns it cannot run. Unlike the bounds it also cannot
    // degrade to "no filter" — that would answer a different question.
    if (!tableHasTimeBounds) {
      throw new Error(
        'match[] requires a TimeSeries table created with store_min_time_and_max_time = 1',
      );
    }
    conditions.push(
      getSeriesSelectorCondition({
        databaseName,
        tableName,
        match: selectors,
        startMs,
        endMs,
      }),
    );
  }

  if (tableHasTimeBounds) {
    if (endMs != null)
      conditions.push(
        chSql`(min_time IS NULL OR min_time <= fromUnixTimestamp64Milli(${{ Int64: endMs }}))`,
      );
    if (startMs != null)
      conditions.push(
        chSql`(max_time IS NULL OR max_time >= fromUnixTimestamp64Milli(${{ Int64: startMs }}))`,
      );
  }

  return conditions;
}

/**
 * Runs `SELECT DISTINCT <value> AS val FROM timeSeriesTags(...)` with the given
 * conditions, sorted, and returns the distinct values.
 */
async function queryDistinctTagsValues({
  client,
  databaseName,
  tableName,
  value,
  conditions,
  limit,
}: {
  client: ClickhouseClient;
  databaseName: string;
  tableName: string;
  value: ChSql;
  conditions: ChSql[];
  limit?: number;
}): Promise<string[]> {
  const where = conditions.length
    ? chSql`WHERE ${concatChSql(' AND ', ...conditions)}`
    : chSql``;
  const limitSql = limit
    ? chSql`LIMIT ${{ Int32: Math.min(limit, PROMETHEUS_MAX_RESULT_ROWS) }}`
    : chSql``;
  const query = chSql`
    SELECT DISTINCT ${value} AS val
    FROM timeSeriesTags(${{ Identifier: databaseName }}, ${{ Identifier: tableName }})
    ${where}
    ORDER BY val
    ${limitSql}
  `;

  const resp = await client.query({
    query: query.sql,
    query_params: query.params,
    format: 'JSON',
    clickhouse_settings: {
      allow_experimental_time_series_table: 1,
      max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
      max_result_rows: String(PROMETHEUS_MAX_RESULT_ROWS),
    },
  });

  const json = await resp.json<{ val: string }>();
  return json.data.map(r => r.val);
}

/**
 * Queries distinct values for the given label name from the given TimeSeries
 * table, optionally narrowed to a time range and to `match`'s series selectors.
 */
export async function queryLabelValues({
  labelName,
  limit,
  ...args
}: TimeSeriesTagsQueryArgs & { labelName: string }): Promise<string[]> {
  const isMetricName = labelName === '__name__';
  const value = isMetricName
    ? chSql`${{ Identifier: 'metric_name' }} `
    : chSql`${{ Identifier: 'tags' }}[${{ String: labelName }}]`;

  const conditions: ChSql[] = [];
  if (!isMetricName)
    conditions.push(
      chSql`mapContains(${{ Identifier: 'tags' }}, ${{ String: labelName }})`,
    );
  conditions.push(...(await getSeriesFilterConditions(args)));

  return queryDistinctTagsValues({ ...args, value, conditions, limit });
}

/**
 * Queries the distinct label names carried by any series in the given TimeSeries
 * table, optionally narrowed to a time range and to `match`'s series selectors.
 */
export async function queryLabelNames({
  limit,
  ...args
}: TimeSeriesTagsQueryArgs): Promise<string[]> {
  // `all_tags` is EPHEMERAL by default, so the label names come from `tags`,
  // which the engine strips `__name__` out of. It is folded back in explicitly.
  const value = chSql`arrayJoin(arrayConcat([${{ String: '__name__' }}], mapKeys(${{ Identifier: 'tags' }})))`;
  const conditions = await getSeriesFilterConditions(args);

  return queryDistinctTagsValues({ ...args, value, conditions, limit });
}

/**
 * Runs the prometheusQueryRange table function for a given ClickHouse connection.
 */
export async function queryPrometheusRangeFromClickHouse({
  client,
  databaseName,
  tableName,
  expr,
  startMs,
  endMs,
  stepSec,
}: {
  client: ClickhouseClient;
  databaseName: string;
  tableName: string;
  expr: string;
  startMs: number;
  endMs: number;
  stepSec: number;
}) {
  return client.query({
    query: `SELECT tags, time_series FROM prometheusQueryRange({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({startMs:Int64}), fromUnixTimestamp64Milli({endMs:Int64}), toIntervalSecond({stepSec:UInt32})) SETTINGS allow_experimental_time_series_table = 1`,
    query_params: {
      db: databaseName,
      table: tableName,
      expr,
      startMs,
      endMs,
      stepSec,
    },
    format: 'JSON',
    clickhouse_settings: {
      allow_experimental_time_series_table: 1,
      max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
      max_result_rows: String(PROMETHEUS_MAX_RESULT_ROWS),
    },
  });
}

// Prometheus-compatible response types
type PrometheusMetric = Record<string, string>;
export type PrometheusMatrixResult = {
  metric: PrometheusMetric;
  values: [number, string][];
};
export type PrometheusVectorResult = {
  metric: PrometheusMetric;
  value: [number, string];
};

// ClickHouse → Prometheus response formatters
export function formatMatrixResponse(
  rows: { tags: [string, string][]; time_series: [string, number][] }[],
): PrometheusMatrixResult[] {
  return rows.map(row => {
    const metric: PrometheusMetric = {};
    for (const [key, value] of row.tags) {
      metric[key] = value;
    }
    const values: [number, string][] = row.time_series.map(
      ([timestamp, value]) => {
        const ts =
          typeof timestamp === 'string'
            ? new Date(timestamp + 'Z').getTime() / 1000
            : Number(timestamp);
        return [ts, String(value)];
      },
    );
    return { metric, values };
  });
}

export function formatVectorResponse(
  rows: { tags: [string, string][]; timestamp: string; value: number }[],
): PrometheusVectorResult[] {
  return rows.map(row => {
    const metric: PrometheusMetric = {};
    for (const [key, value] of row.tags) {
      metric[key] = value;
    }
    const ts =
      typeof row.timestamp === 'string'
        ? new Date(row.timestamp + 'Z').getTime() / 1000
        : Number(row.timestamp);
    return { metric, value: [ts, String(row.value)] };
  });
}
