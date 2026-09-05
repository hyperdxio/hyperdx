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
