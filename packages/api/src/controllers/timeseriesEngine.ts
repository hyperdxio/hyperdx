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

export const PROMETHEUS_MAX_EXECUTION_SEC = 30;
export const PROMETHEUS_MAX_RESULT_ROWS = 100000;

export type TimeSeriesTagsQueryArgs = {
  client: ClickhouseClient;
  connectionId: string;
  databaseName: string;
  tableName: string;
  startMs?: number;
  endMs?: number;
  limit?: number;
  match?: string[];
  /** Cancels the DISTINCT query; the tags-table column lookup is not cancellable. */
  signal?: AbortSignal;
};

/**
 * Where the given TimeSeries table keeps each series' time range, if anywhere:
 * - `tags`: the `min_time`/`max_time` columns of the tags inner table (schema
 *   version 7 or earlier, with `store_min_time_and_max_time` on);
 * - `timeRanges`: the time ranges inner table (version 8 and later, with
 *   `store_time_ranges` on, the default from ClickHouse 26.10).
 */
async function timeSeriesTimeBounds({
  metadata,
  connectionId,
  database,
  table,
}: {
  metadata: Metadata;
  connectionId: string;
  database: string;
  table: string;
}): Promise<'tags' | 'timeRanges' | undefined> {
  for (const [innerTableType, bounds] of [
    ['Tags', 'tags'],
    ['TimeRanges', 'timeRanges'],
  ] as const) {
    try {
      const columns = await metadata.getTimeSeriesTableColumns({
        connectionId,
        databaseName: database,
        tableName: table,
        innerTableType,
      });
      const columnNames = new Set(columns.map(column => column.name));
      if (columnNames.has('min_time') && columnNames.has('max_time'))
        return bounds;
    } catch (e) {
      // A table without a time ranges target (version 7 or earlier, or
      // store_time_ranges off) rejects timeSeriesTimeRanges(): expected.
      if (innerTableType === 'Tags')
        logger.warn(
          { err: e, database, table },
          'Failed to check if TimeSeries tags table has time bounds columns',
        );
    }
  }
  return undefined;
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

  // Both filters lean on each series' time range: min_time/max_time in the
  // tags inner table up to schema version 7, a separate time ranges inner
  // table from version 8.
  const metadata = new Metadata(client, new MetadataCache());
  const timeBounds = await timeSeriesTimeBounds({
    metadata,
    connectionId,
    database: databaseName,
    table: tableName,
  });

  const conditions: ChSql[] = [];

  if (selectors != null) {
    // timeSeriesSelector() prunes on the series' time range, so without one it
    // cannot run. Unlike the bounds it also cannot degrade to "no filter" —
    // that would answer a different question.
    if (timeBounds == null) {
      throw new Error(
        'match[] requires a TimeSeries table that stores time ranges (store_time_ranges = 1, or store_min_time_and_max_time = 1 before version 8)',
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

  if (timeBounds === 'tags') {
    if (endMs != null)
      conditions.push(
        chSql`(min_time IS NULL OR min_time <= fromUnixTimestamp64Milli(${{ Int64: endMs }}))`,
      );
    if (startMs != null)
      conditions.push(
        chSql`(max_time IS NULL OR max_time >= fromUnixTimestamp64Milli(${{ Int64: startMs }}))`,
      );
  } else if (timeBounds === 'timeRanges' && selectors == null) {
    // The selector above already keeps only series with samples in the
    // window. Without one, the time ranges table answers the window; its rows
    // are partial aggregates until merged, hence the GROUP BY.
    const having: ChSql[] = [];
    if (endMs != null)
      having.push(
        chSql`min(min_time) <= fromUnixTimestamp64Milli(${{ Int64: endMs }})`,
      );
    if (startMs != null)
      having.push(
        chSql`max(max_time) >= fromUnixTimestamp64Milli(${{ Int64: startMs }})`,
      );
    conditions.push(
      chSql`id IN (
        SELECT id
        FROM timeSeriesTimeRanges(${{ Identifier: databaseName }}, ${{ Identifier: tableName }})
        GROUP BY id
        HAVING ${concatChSql(' AND ', ...having)}
      )`,
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
  signal,
}: {
  client: ClickhouseClient;
  databaseName: string;
  tableName: string;
  value: ChSql;
  conditions: ChSql[];
  limit?: number;
  signal?: AbortSignal;
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
    abort_signal: signal,
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
export async function connectionSupportsPrometheusHttpApi({
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
