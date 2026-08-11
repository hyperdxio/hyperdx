import {
  chSql,
  concatChSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';

import logger from '@/utils/logger';

// Max MetricName values returned per metric kind by the starter sample.
// clickstack_list_metrics provides paginated discovery beyond this cap.
const MAX_METRIC_NAMES_PER_KIND = 20;

/**
 * Lookback windows tried in order when sampling metric names. The first
 * window that yields any names wins. Metrics reported sparsely (batch
 * jobs, low-traffic services) or backfilled historical data may have no
 * points in the last 24h — falling back to a wider window keeps the
 * sample useful instead of silently empty.
 */
const METRIC_NAME_LOOKBACK_WINDOWS_MS: readonly number[] = [
  24 * 60 * 60 * 1000, // 24 hours
  30 * 24 * 60 * 60 * 1000, // 30 days
];

export type MetricNameSample = {
  name: string;
  unit?: string;
  description?: string;
};

/**
 * Sample distinct MetricName values for a single metric kind. Optionally
 * enriches each name with MetricUnit / MetricDescription when those
 * columns are present on the table (the OTel Collector default schema
 * includes them; custom schemas may not).
 */
export async function sampleMetricNamesForKind({
  metadata,
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  dateRange,
  timestampValueExpression,
  signal,
  cachedColumns,
  maxNames = MAX_METRIC_NAMES_PER_KIND,
  enrich = true,
}: {
  metadata: ReturnType<typeof getMetadata>;
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  dateRange: [Date, Date];
  timestampValueExpression: string;
  signal: AbortSignal;
  cachedColumns?: { name: string }[];
  maxNames?: number;
  enrich?: boolean;
}): Promise<MetricNameSample[]> {
  // First fetch the distinct metric names; this is the only step that
  // strictly needs to succeed for the kind to appear in the response.
  // Pass timestampValueExpression so the no-rollup fallback path scopes
  // its scan to dateRange instead of going unbounded against the raw
  // metric table on cold cache.
  const nameResults = await metadata.getAllKeyValues({
    databaseName,
    tableName,
    keyExpressions: ['MetricName'],
    maxValuesPerKey: maxNames,
    connectionId,
    dateRange,
    timestampValueExpression,
    signal,
  });
  const names = nameResults[0]?.value.map(v => v.toString()) ?? [];
  if (names.length === 0) return [];

  if (!enrich) {
    return names.map(name => ({ name }));
  }

  // Defensive column presence check for MetricUnit / MetricDescription.
  const kindColumns =
    cachedColumns ??
    (await metadata.getColumns({ databaseName, tableName, connectionId }));
  const columnNames = new Set(kindColumns.map(c => c.name));
  const hasUnit = columnNames.has('MetricUnit');
  const hasDescription = columnNames.has('MetricDescription');

  // Best-effort enrichment with unit + description. One small query
  // returns one row per metric name with the most-recent unit / desc.
  let enrichments = new Map<string, { unit?: string; description?: string }>();
  if ((hasUnit || hasDescription) && !signal.aborted) {
    try {
      enrichments = await fetchMetricNameEnrichments({
        clickhouseClient,
        databaseName,
        tableName,
        connectionId,
        names,
        dateRange,
        hasUnit,
        hasDescription,
        signal,
      });
    } catch (e) {
      logger.warn(
        { databaseName, tableName, error: e },
        'Failed to enrich metric names with unit/description',
      );
    }
  }

  return names.map(name => {
    const enrichment = enrichments.get(name) ?? {};
    const sample: MetricNameSample = { name };
    if (enrichment.unit) sample.unit = enrichment.unit;
    if (enrichment.description) sample.description = enrichment.description;
    return sample;
  });
}

/**
 * Sample metric names for a kind, widening the lookback window until a
 * non-empty sample is found (see METRIC_NAME_LOOKBACK_WINDOWS_MS).
 * Returns the first non-empty sample, or [] when every window is empty.
 */
export async function sampleMetricNamesWithLookback({
  now = new Date(),
  windowsMs = METRIC_NAME_LOOKBACK_WINDOWS_MS,
  ...rest
}: Omit<Parameters<typeof sampleMetricNamesForKind>[0], 'dateRange'> & {
  now?: Date;
  windowsMs?: readonly number[];
}): Promise<MetricNameSample[]> {
  for (const windowMs of windowsMs) {
    if (rest.signal.aborted) break;
    const samples = await sampleMetricNamesForKind({
      ...rest,
      dateRange: [new Date(now.getTime() - windowMs), now],
    });
    if (samples.length > 0) return samples;
  }
  return [];
}

/**
 * Fetch MetricUnit and MetricDescription for a batch of metric names.
 * Uses `anyLast` so the most-recent value wins when a metric has changed
 * unit/description over time.
 */
async function fetchMetricNameEnrichments({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  names,
  dateRange,
  hasUnit,
  hasDescription,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  names: string[];
  dateRange: [Date, Date];
  hasUnit: boolean;
  hasDescription: boolean;
  signal: AbortSignal;
}): Promise<Map<string, { unit?: string; description?: string }>> {
  // Build the projection fragments via the parameterised chSql DSL so
  // identifiers are quoted and the unit/description columns only appear
  // when present on the source table.
  const projections = [
    chSql`MetricName`,
    ...(hasUnit
      ? [chSql`anyLast(${{ Identifier: 'MetricUnit' }}) AS MetricUnit`]
      : []),
    ...(hasDescription
      ? [
          chSql`anyLast(${{ Identifier: 'MetricDescription' }}) AS MetricDescription`,
        ]
      : []),
  ];
  const namePlaceholders = concatChSql(
    ',',
    names.map(name => chSql`${{ String: name }}`),
  );
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE MetricName IN (${namePlaceholders})
      AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: dateRange[0].getTime() }})
      AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: dateRange[1].getTime() }})
    GROUP BY MetricName
  `;

  type EnrichmentRow = {
    MetricName: string;
    MetricUnit?: string;
    MetricDescription?: string;
  };

  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    abort_signal: signal,
  });
  const result = (await response.json()) as { data: EnrichmentRow[] };

  const enrichments = new Map<
    string,
    { unit?: string; description?: string }
  >();
  for (const row of result.data) {
    enrichments.set(row.MetricName, {
      ...(row.MetricUnit ? { unit: row.MetricUnit } : {}),
      ...(row.MetricDescription ? { description: row.MetricDescription } : {}),
    });
  }
  return enrichments;
}
