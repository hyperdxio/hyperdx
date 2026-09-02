import type { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { getMetricTableName } from '@/utils';

/** The bit of a chart series this needs: which metric, of which type. */
export type MetricSeriesRef = {
  metricType?: string;
  metricName?: string;
};

/**
 * The tables backing a metric source's currently selected series.
 *
 * A metric source has no usable `from.tableName` — it fans out to one table per
 * metric type — so anything that reads schema from the source (field
 * autocomplete, the filter sidebar) has to ask the per-series tables instead.
 * Each connection carries its `metricName` as well, because one metric table
 * holds every metric of that type and the attributes differ per metric.
 *
 * Returns an empty array for non-metric sources, and for metric sources whose
 * series have no metric picked yet; callers fall back to `tcFromSource`.
 */
export function metricTableConnections(
  source: TSource | undefined,
  series: MetricSeriesRef[] | undefined,
): TableConnection[] {
  if (source?.kind !== SourceKind.Metric || !Array.isArray(series)) {
    return [];
  }

  const seen = new Set<string>();
  const connections: TableConnection[] = [];
  for (const s of series) {
    if (!s?.metricType || !s?.metricName) continue;
    const tableName = getMetricTableName(source, s.metricType);
    if (!tableName) continue;
    const key = `${tableName}::${s.metricName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connections.push({
      databaseName: source.from.databaseName,
      tableName,
      connectionId: source.connection,
      metricName: s.metricName,
    });
  }
  return connections;
}
