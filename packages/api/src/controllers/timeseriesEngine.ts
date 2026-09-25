import {
  ChSql,
  chSql,
  concatChSql,
} from '@hyperdx/common-utils/dist/clickhouse';
import { supportsPrometheusHttpApi } from '@hyperdx/common-utils/dist/core/clickhouseVersion';
import {
  Metadata,
  MetadataCache,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  PrometheusMatrixResult,
  PrometheusVectorResult,
} from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import logger from '@/utils/logger';

const PROMETHEUS_MAX_EXECUTION_SEC = 30;
const PROMETHEUS_MAX_RESULT_ROWS = 100000;

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
  // The engine keeps `__name__` in `metric_name`, not `tags`, so it is folded
  // back in explicitly.
  const value = chSql`arrayJoin(arrayConcat([${{ String: '__name__' }}], mapKeys(${{ Identifier: 'tags' }})))`;
  const conditions = await getSeriesFilterConditions(args);

  return queryDistinctTagsValues({ ...args, value, conditions, limit });
}

// --------------------------
// PromQL via table functions (ClickHouse < 26.6)
// --------------------------
//
// Servers without the `prometheus_api_v1` HTTP handler can still evaluate
// PromQL through `prometheusQuery`/`prometheusQueryRange`. ClickHouse only
// holds the HTTP API forward-compatible while TimeSeries is in preview, so
// this path is a fallback for old servers, not the primary route.

const toUnixSeconds = (timestamp: string | number) =>
  typeof timestamp === 'string'
    ? new Date(timestamp).getTime() / 1000
    : Number(timestamp);

export function formatMatrixResponse(
  rows: { tags: [string, string][]; samples: [string, number][] }[],
): PrometheusMatrixResult[] {
  return rows.map(row => ({
    metric: Object.fromEntries(row.tags),
    values: row.samples.map(([ts, value]) => [
      toUnixSeconds(ts),
      String(value),
    ]),
  }));
}

/**
 * The name of the per-series samples column, which the engine renamed from
 * `time_series` to `samples` in TimeSeries schema version 3. The rename
 * follows the table's pinned version, not the server's, so a v2 table on a new
 * server still reads `time_series`. `prometheusQueryRange` returns whichever
 * the table uses. Looked up fresh each call: a throwaway cache, so a table
 * dropped and recreated at a new version is seen at once.
 */
async function timeSeriesSamplesColumn({
  client,
  connectionId,
  databaseName,
  tableName,
}: {
  client: ClickhouseClient;
  connectionId: string;
  databaseName: string;
  tableName: string;
}): Promise<'samples' | 'time_series'> {
  const metadata = new Metadata(client, new MetadataCache());
  const version = await metadata.getTimeSeriesTableVersion({
    connectionId,
    databaseName,
    tableName,
  });
  return version >= 3 ? 'samples' : 'time_series';
}

export function formatVectorResponse(
  rows: { tags: [string, string][]; timestamp: string; value: number }[],
): PrometheusVectorResult[] {
  return rows.map(row => ({
    metric: Object.fromEntries(row.tags),
    value: [toUnixSeconds(row.timestamp), String(row.value)],
  }));
}

const PROMQL_TABLE_FUNCTION_SETTINGS = {
  allow_experimental_time_series_table: 1,
  max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
  max_result_rows: String(PROMETHEUS_MAX_RESULT_ROWS),
} as const;

export async function queryRangeViaTableFunction({
  client,
  connectionId,
  databaseName,
  tableName,
  expr,
  startMs,
  endMs,
  stepSec,
}: {
  client: ClickhouseClient;
  connectionId: string;
  databaseName: string;
  tableName: string;
  expr: string;
  startMs: number;
  endMs: number;
  stepSec: number;
}): Promise<PrometheusMatrixResult[]> {
  const samplesColumn = await timeSeriesSamplesColumn({
    client,
    connectionId,
    databaseName,
    tableName,
  });
  const resp = await client.query({
    query: `SELECT tags, ${samplesColumn} AS samples FROM prometheusQueryRange({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({startMs:Int64}), fromUnixTimestamp64Milli({endMs:Int64}), toIntervalSecond({stepSec:UInt32})) SETTINGS allow_experimental_time_series_table = 1`,
    query_params: {
      db: databaseName,
      table: tableName,
      expr,
      startMs,
      endMs,
      stepSec,
    },
    format: 'JSON',
    clickhouse_settings: PROMQL_TABLE_FUNCTION_SETTINGS,
  });
  const json = await resp.json<any>();
  return formatMatrixResponse(json.data);
}

export async function queryInstantViaTableFunction({
  client,
  databaseName,
  tableName,
  expr,
  evalMs,
}: {
  client: ClickhouseClient;
  databaseName: string;
  tableName: string;
  expr: string;
  evalMs: number;
}): Promise<PrometheusVectorResult[]> {
  const resp = await client.query({
    query: `SELECT tags, timestamp, value FROM prometheusQuery({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({evalMs:Int64})) SETTINGS allow_experimental_time_series_table = 1`,
    query_params: { db: databaseName, table: tableName, expr, evalMs },
    format: 'JSON',
    clickhouse_settings: PROMQL_TABLE_FUNCTION_SETTINGS,
  });
  const json = await resp.json<any>();
  return formatVectorResponse(json.data);
}

/**
 * Whether the connection's ClickHouse is new enough for the Prometheus HTTP
 * API. `SELECT version()` runs each call (throwaway cache) so an upgraded
 * server is picked up without a restart; an unknown version is treated as
 * old, matching the other version-gated features.
 */
async function connectionSupportsPrometheusHttpApi({
  client,
  connectionId,
}: {
  client: ClickhouseClient;
  connectionId: string;
}): Promise<boolean> {
  const metadata = new Metadata(client, new MetadataCache());
  return supportsPrometheusHttpApi(
    await metadata.getServerVersion({ connectionId }),
  );
}

// --------------------------
// Shared Prometheus connection helpers
// --------------------------
//
// Used by both the HTTP proxy (routers/api/prometheus.ts) and the alerting
// task (tasks/checkAlerts) so backend-selection logic stays in one place.

/** ClickHouse prefix for the prometheus_api_v1 HTTP handler (26.6+). */
export const CLICKHOUSE_PROMETHEUS_API_PREFIX = '/prometheus/api/v1';

/**
 * Timeout for PromQL evaluation via ClickhouseClient.
 * Shared with checkAlerts so both callers use the same limit.
 */
export const PROMETHEUS_CH_TIMEOUT_MS = 30_000;

const PROM_PROBE_TIMEOUT_MS = 5_000;

/**
 * Join a Connection host with an absolute Prometheus API path, preserving any
 * prefix already baked into the host (e.g. VictoriaMetrics cluster prefix).
 */
export function joinPrometheusUpstreamUrl(
  upstreamHost: string,
  path: string,
): URL {
  const url = new URL(upstreamHost);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Connection host must be http(s)');
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${path}`;
  return url;
}

/** Basic-auth headers for ClickHouse's native HTTP API. */
export function clickhouseAuthHeaders(connection: {
  username: string;
  password?: string;
}): Record<string, string> {
  return {
    'X-ClickHouse-User': connection.username,
    'X-ClickHouse-Key': connection.password ?? '',
  };
}

/**
 * ClickHouse host URL with PromQL query-limits pinned as HTTP settings so
 * the prometheus_api_v1 handler enforces them.
 */
export function clickhousePrometheusUpstream(
  host: string,
  {
    maxExecutionSec = PROMETHEUS_MAX_EXECUTION_SEC,
    maxResultRows = PROMETHEUS_MAX_RESULT_ROWS,
  } = {},
): string {
  const url = new URL(host);
  url.searchParams.set('max_execution_time', String(maxExecutionSec));
  url.searchParams.set('max_result_rows', String(maxResultRows));
  return url.toString();
}

/**
 * Whether this ClickHouse instance serves the Prometheus HTTP API.
 * Probed on each call so a config change is reflected immediately.
 */
export async function clickhouseServesPrometheusHttpApi(
  client: ClickhouseClient,
  connection: { id: string; host: string; username: string; password?: string },
): Promise<boolean> {
  if (
    !(await connectionSupportsPrometheusHttpApi({
      client,
      connectionId: connection.id,
    }))
  ) {
    return false;
  }
  try {
    const url = joinPrometheusUpstreamUrl(
      connection.host,
      `${CLICKHOUSE_PROMETHEUS_API_PREFIX}/format_query`,
    );
    url.searchParams.set('query', 'up');
    const resp = await fetch(url, {
      headers: clickhouseAuthHeaders(connection),
      signal: AbortSignal.timeout(PROM_PROBE_TIMEOUT_MS),
    });
    return typeof JSON.parse(await resp.text())?.status === 'string';
  } catch {
    return false;
  }
}
