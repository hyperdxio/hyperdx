import { useMemo } from 'react';
import { TMetricSource } from '@hyperdx/common-utils/dist/types';

import { parseMetricQuery } from './parseMetricQuery';
import { MetricFilterClause } from './tileDefaults';
import { useMetricWallCatalog } from './useMetricWallCatalog';
import { useMetricWallState } from './useMetricWallState';
import { groupWallMetrics } from './wallGrouping';

/**
 * The wall and the rail render in different page slots but read the same
 * catalog and URL state; the catalog fetch is shared through the query cache.
 */
export function useMetricBrowse({
  source,
  dateRange,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
}) {
  const [state, update] = useMetricWallState();
  const query = state.query ?? '';
  const grouping = state.grouping ?? 'entity';
  const catalog = useMetricWallCatalog({ source, dateRange });

  const parsed = useMemo(() => parseMetricQuery(query), [query]);
  const sections = useMemo(
    () => groupWallMetrics(catalog.metrics, parsed, grouping),
    [catalog.metrics, parsed, grouping],
  );
  const matching = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sections)
      for (const b of s.bands) for (const i of b.items) ids.add(i.metric.id);
    return catalog.metrics.filter(m => ids.has(m.id));
  }, [sections, catalog.metrics]);
  // Attribute values can only be checked by the query, so they ride along on
  // every tile rather than narrowing the catalog.
  const filters = useMemo<MetricFilterClause[]>(
    () =>
      parsed.tokens.flatMap(t =>
        t.type === 'attr' ? [{ key: t.key, value: t.value }] : [],
      ),
    [parsed],
  );

  return {
    ...catalog,
    state,
    update,
    query,
    grouping,
    sections,
    matching,
    filters,
  };
}
