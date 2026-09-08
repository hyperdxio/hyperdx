import { addDays, differenceInDays, subDays } from 'date-fns';
import dayjs from 'dayjs';
import {
  chSql,
  concatChSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  DateRange,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { QUERYABLE_KINDS } from '@/utils/metricKinds';
import {
  mergeMetricCatalog,
  type MetricCatalogEntry,
} from '@/utils/metricNameTree';

const MAX_METRICS_PER_KIND = 3000;

/**
 * Server-side execution cap per kind, matching the bounds the MCP
 * `clickstack_list_metrics` tool uses for this same query shape. With
 * `break`, a slow table yields whatever it collected instead of erroring.
 */
const MAX_EXEC_SECONDS = 8;

/**
 * Widen a sub-day range to a full day and clamp anything longer to the most
 * recent 3 days. Mirrors the window `MetricNameSelect` already applies: the
 * catalog is "what is this source reporting lately", and an unbounded range
 * would scan every partition.
 */
export function clampCatalogDateRange(
  dateRange: DateRange['dateRange'] | undefined,
  now: Date,
): DateRange['dateRange'] {
  const range: DateRange['dateRange'] = dateRange ?? [subDays(now, 1), now];
  const days = differenceInDays(range[1], range[0]);

  if (days < 1) {
    const nextDay = addDays(range[0], 1);
    return nextDay > now
      ? [subDays(range[1], 1), range[1]]
      : [range[0], nextDay];
  }
  if (days > 3) {
    return [subDays(range[1], 3), range[1]];
  }
  return range;
}

type CatalogRow = {
  MetricName: string;
  MetricUnit?: string;
  MetricDescription?: string;
};

/**
 * Every metric a source is reporting, with its unit and description.
 *
 * Heavier than the name-only lookup behind `MetricNameSelect` — it groups over
 * the kind tables rather than reading a single column — so it is meant to run
 * only while the explorer is open, not for every mounted chart editor.
 */
export function useMetricCatalog({
  source,
  dateRange,
  enabled = true,
}: {
  source: TMetricSource;
  dateRange?: DateRange['dateRange'];
  enabled?: boolean;
}) {
  const metadata = useMetadataWithSettings();
  const databaseName = source.from.databaseName;
  const connectionId = source.connection;
  const timestampExpression = source.timestampValueExpression || 'TimeUnix';

  const tables = QUERYABLE_KINDS.flatMap(kind => {
    const tableName = source.metricTables?.[kind];
    return tableName ? [{ kind, tableName }] : [];
  });

  const query = useQuery({
    queryKey: [
      'useMetricCatalog',
      connectionId,
      databaseName,
      tables,
      timestampExpression,
      dateRange,
    ],
    queryFn: async ({ signal }) => {
      // dayjs() rather than `new Date()`: the lint rule bans the latter to stop
      // unstable time references leaking into render. This runs inside the
      // queryFn, not during render, but the rule is syntactic.
      const [start, end] = clampCatalogDateRange(dateRange, dayjs().toDate());
      const clickhouseClient = getClickhouseClient();

      // Settled, not all: a source can legitimately have one misconfigured or
      // ungranted kind table, and failing the whole catalog would hide every
      // kind that loaded fine. Mirrors the MCP clickstack_list_metrics tool,
      // which reports per-kind `partialFailure` for this same query shape.
      const settled = await Promise.allSettled(
        tables.map(async ({ kind, tableName }) => {
          // Non-OTel schemas may not carry the metadata columns; referencing
          // them unconditionally would fail the whole catalog.
          const columns = await metadata.getColumns({
            databaseName,
            tableName,
            connectionId,
          });
          const columnNames = new Set(columns.map(c => c.name));

          const projections = [
            chSql`MetricName`,
            ...(columnNames.has('MetricUnit')
              ? [chSql`anyLast(MetricUnit) AS MetricUnit`]
              : []),
            ...(columnNames.has('MetricDescription')
              ? [chSql`anyLast(MetricDescription) AS MetricDescription`]
              : []),
          ];

          const sql = chSql`
            SELECT ${concatChSql(', ', projections)}
            FROM ${tableExpr({ database: databaseName, table: tableName })}
            WHERE ${{ Identifier: timestampExpression }} >= fromUnixTimestamp64Milli(${{ Int64: start.getTime() }})
              AND ${{ Identifier: timestampExpression }} <= fromUnixTimestamp64Milli(${{ Int64: end.getTime() }})
            GROUP BY MetricName
            ORDER BY MetricName ASC
            LIMIT ${{ Int32: MAX_METRICS_PER_KIND }}
          `;

          const result = (await clickhouseClient
            .query<'JSON'>({
              query: sql.sql,
              query_params: sql.params,
              format: 'JSON',
              abort_signal: signal,
              connectionId,
              clickhouse_settings: {
                max_execution_time: MAX_EXEC_SECONDS,
                timeout_overflow_mode: 'break',
              },
            })
            .then(res => res.json())) as ResponseJSON<CatalogRow>;

          return (result?.data ?? []).map(
            (row): MetricCatalogEntry => ({
              name: row.MetricName,
              type: kind,
              unit: row.MetricUnit || undefined,
              description: row.MetricDescription || undefined,
            }),
          );
        }),
      );

      const failedKinds = tables
        .filter((_, i) => settled[i]?.status === 'rejected')
        .map(({ kind }) => kind);

      // Every kind failing is a real error, not partial data — surface it
      // rather than rendering an empty catalog that looks like "no metrics".
      if (failedKinds.length === tables.length) {
        const [first] = settled;
        throw first?.status === 'rejected'
          ? first.reason
          : new Error('Failed to load the metric catalog');
      }

      const entries = mergeMetricCatalog(
        settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : [])),
      );

      return { entries, failedKinds };
    },
    enabled:
      enabled &&
      source.kind === SourceKind.Metric &&
      !!databaseName &&
      tables.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  return {
    entries: query.data?.entries ?? [],
    /**
     * Kinds whose table could not be read. The catalog is still usable without
     * them, but the gap has to be visible — silently showing a subset reads as
     * "this source has no histograms".
     */
    failedKinds: query.data?.failedKinds ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
