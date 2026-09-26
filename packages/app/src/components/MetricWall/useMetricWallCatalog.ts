import { useMemo } from 'react';
import { subHours } from 'date-fns';
import {
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useMetricCatalog } from '@/hooks/useMetricCatalog';
import { QUERYABLE_KINDS } from '@/utils/metricKinds';

import { classifyMetric, MetricClassification } from './classifyMetric';
import { MetricFilterClause } from './tileDefaults';

/** Resource attributes that name who emitted a metric, in order of preference. */
export const ENTITY_KEYS = ['service.name', 'host.name'] as const;

const MAX_METRICS_PER_KIND = 3000;
const MAX_ENTITIES_PER_METRIC = 50;
const MAX_KEYS_PER_METRIC = 200;
const MAX_EXEC_SECONDS = 8;
// Entities and attribute keys come from recent data only: reading every map
// over the catalog's multi-day window would be the most expensive query on
// the page, and what is reporting now is what the wall is about.
const STATS_WINDOW_HOURS = 1;

export type WallMetric = {
  id: string;
  name: string;
  type: MetricsDataType;
  unit?: string;
  description?: string;
  classification: MetricClassification;
  keys: Set<string>;
  /** Who reports this metric; empty when the source carries no entity keys. */
  entities: MetricFilterClause[];
};

export function wallMetricId(type: MetricsDataType, name: string) {
  return `${type}:${name}`;
}

type StatsRow = { MetricName: string; entities: string[]; keys: string[] };
type MetricStats = { entities: MetricFilterClause[]; keys: string[] };

function parseEntity(encoded: string): MetricFilterClause | undefined {
  const eq = encoded.indexOf('=');
  if (eq <= 0) return undefined;
  return { key: encoded.slice(0, eq), value: encoded.slice(eq + 1) };
}

function useMetricWallStats({
  source,
  dateRange,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
}) {
  const metadata = useMetadataWithSettings();
  const databaseName = source.from.databaseName;
  const connectionId = source.connection;
  const timestampExpression = source.timestampValueExpression || 'TimeUnix';
  const tables = QUERYABLE_KINDS.flatMap(kind => {
    const tableName = source.metricTables?.[kind];
    return tableName ? [{ kind, tableName }] : [];
  });
  const end = dateRange[1];
  const start = new Date(
    Math.max(
      dateRange[0].getTime(),
      subHours(end, STATS_WINDOW_HOURS).getTime(),
    ),
  );

  return useQuery({
    queryKey: [
      'useMetricWallStats',
      connectionId,
      databaseName,
      tables,
      timestampExpression,
      start.getTime(),
      end.getTime(),
    ],
    queryFn: async ({ signal }) => {
      const client = getClickhouseClient();
      const stats = new Map<string, MetricStats>();
      await Promise.allSettled(
        tables.map(async ({ kind, tableName }) => {
          const columns = await metadata.getColumns({
            databaseName,
            tableName,
            connectionId,
          });
          const names = new Set(columns.map(c => c.name));
          if (!names.has('ResourceAttributes') || !names.has('Attributes')) {
            return;
          }
          // Aggregate parameters must be literals, so the limits are inlined.
          const sql = chSql`
            SELECT
              MetricName,
              groupUniqArray(${String(MAX_ENTITIES_PER_METRIC)})(multiIf(
                ResourceAttributes['service.name'] != '', concat('service.name=', ResourceAttributes['service.name']),
                ResourceAttributes['host.name'] != '', concat('host.name=', ResourceAttributes['host.name']),
                ''
              )) AS entities,
              groupUniqArrayArray(${String(MAX_KEYS_PER_METRIC)})(
                arrayConcat(mapKeys(ResourceAttributes), mapKeys(Attributes))
              ) AS keys
            FROM ${tableExpr({ database: databaseName, table: tableName })}
            WHERE ${{ Identifier: timestampExpression }} >= fromUnixTimestamp64Milli(${{ Int64: start.getTime() }})
              AND ${{ Identifier: timestampExpression }} <= fromUnixTimestamp64Milli(${{ Int64: end.getTime() }})
            GROUP BY MetricName
            LIMIT ${{ Int32: MAX_METRICS_PER_KIND }}
          `;
          const result = (await client
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
            .then(res => res.json())) as ResponseJSON<StatsRow>;
          for (const row of result?.data ?? []) {
            stats.set(wallMetricId(kind, row.MetricName), {
              entities: row.entities.flatMap(e => parseEntity(e) ?? []),
              keys: row.keys,
            });
          }
        }),
      );
      return stats;
    },
    enabled:
      source.kind === SourceKind.Metric && !!databaseName && tables.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Everything the wall is built from: each metric the source reports, how it
 * is classified, who reports it, and which attribute keys it carries.
 */
export function useMetricWallCatalog({
  source,
  dateRange,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
}) {
  const catalog = useMetricCatalog({ source, dateRange });
  const stats = useMetricWallStats({ source, dateRange });

  const metrics = useMemo<WallMetric[]>(
    () =>
      catalog.entries.map(entry => {
        const id = wallMetricId(entry.type, entry.name);
        const entryStats = stats.data?.get(id);
        return {
          id,
          name: entry.name,
          type: entry.type,
          unit: entry.unit,
          description: entry.description,
          classification: classifyMetric(entry),
          keys: new Set(entryStats?.keys ?? []),
          entities: entryStats?.entities ?? [],
        };
      }),
    [catalog.entries, stats.data],
  );

  return {
    metrics,
    failedKinds: catalog.failedKinds,
    isLoading: catalog.isLoading,
    isLoadingStats: stats.isLoading,
    error: catalog.error,
  };
}

/** How many metrics carry each attribute key, most first. */
export function rankAttributeKeys(
  metrics: WallMetric[],
): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const metric of metrics) {
    for (const key of metric.keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([key, count]) => ({ key, count })).sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key),
  );
}
