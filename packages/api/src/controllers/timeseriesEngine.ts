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

/**
 * Returns SQL predicates restricting tags rows to series that overlap [startMs, endMs].
 * Empty when no bound is given, or when the table stores no time bounds.
 */
async function getTimeFilterCondition({
  client,
  connectionId,
  databaseName,
  tableName,
  startMs,
  endMs,
}: Omit<TimeSeriesTagsQueryArgs, 'limit'>): Promise<ChSql[]> {
  if (startMs == null && endMs == null) return [];

  // min and max time columns are optional in the tags inner table,
  // so we check if they exist before adding time conditions
  const metadata = new Metadata(client, new MetadataCache());
  const tableHasTimeBounds = await timeSeriesTagsTableHasTimeBounds({
    metadata,
    connectionId,
    database: databaseName,
    table: tableName,
  });
  if (!tableHasTimeBounds) return [];

  const conditions: ChSql[] = [];
  if (endMs != null)
    conditions.push(
      chSql`(min_time IS NULL OR min_time <= fromUnixTimestamp64Milli(${{ Int64: endMs }}))`,
    );
  if (startMs != null)
    conditions.push(
      chSql`(max_time IS NULL OR max_time >= fromUnixTimestamp64Milli(${{ Int64: startMs }}))`,
    );
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
 * Queries distinct values for the given label name from the given TimeSeries table,
 * optionally filtering by a time range (if the table has the optional time range columns).
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
  conditions.push(...(await getTimeFilterCondition(args)));

  return queryDistinctTagsValues({ ...args, value, conditions, limit });
}

/**
 * Queries the distinct label names carried by any series in the given TimeSeries
 * table, optionally filtering by a time range (if the table has the optional time
 * range columns).
 */
export async function queryLabelNames({
  limit,
  ...args
}: TimeSeriesTagsQueryArgs): Promise<string[]> {
  // `all_tags` is EPHEMERAL by default, so the label names come from `tags`,
  // which the engine strips `__name__` out of. It is folded back in explicitly.
  const value = chSql`arrayJoin(arrayConcat([${{ String: '__name__' }}], mapKeys(${{ Identifier: 'tags' }})))`;
  const conditions = await getTimeFilterCondition(args);

  return queryDistinctTagsValues({ ...args, value, conditions, limit });
}
