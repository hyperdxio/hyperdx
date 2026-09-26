import { useCallback, useMemo } from 'react';
import { Filter, TMetricSource } from '@hyperdx/common-utils/dist/types';
import { Alert, Center, Loader, Text } from '@mantine/core';
import { IconLayoutGrid } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { METRIC_KIND_LABELS } from '@/utils/metricKinds';

import type { EditAsChartRequest } from './editAsChart';
import { MetricDrillDown } from './MetricDrillDown';
import { MetricWall } from './MetricWall';
import { MetricWallRail } from './MetricWallRail';
import { MetricWallSearch } from './MetricWallSearch';
import { parseMetricQuery } from './parseMetricQuery';
import { MetricFilterClause } from './tileDefaults';
import { useMetricWallCatalog } from './useMetricWallCatalog';
import { useMetricWallState } from './useMetricWallState';
import { groupWallMetrics, WallItem, wallItemKey } from './wallGrouping';

import styles from './MetricWall.module.scss';

/**
 * The browse-first landing for metric sources: every metric already charted
 * with a sensible default, grouped by who reports it and banded by what it
 * measures, to narrow and open rather than assemble from an empty chart.
 */
export function MetricBrowse({
  source,
  dateRange,
  searchFilters,
  railCollapsed,
  onRailCollapsedChange,
  onEditAsChart,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
  searchFilters: Filter[];
  railCollapsed: boolean;
  onRailCollapsedChange: (collapsed: boolean) => void;
  onEditAsChart: (request: EditAsChartRequest) => void;
}) {
  const [state, update] = useMetricWallState();
  const query = state.query ?? '';
  const grouping = state.grouping ?? 'entity';
  const { metrics, failedKinds, isLoading, error } = useMetricWallCatalog({
    source,
    dateRange,
  });

  const parsed = useMemo(() => parseMetricQuery(query), [query]);
  const sections = useMemo(
    () => groupWallMetrics(metrics, parsed, grouping),
    [metrics, parsed, grouping],
  );
  const matching = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sections)
      for (const b of s.bands) for (const i of b.items) ids.add(i.metric.id);
    return metrics.filter(m => ids.has(m.id));
  }, [sections, metrics]);
  // Attribute values can only be checked by the query, so they ride along on
  // every tile rather than narrowing the catalog.
  const filters = useMemo<MetricFilterClause[]>(
    () =>
      parsed.tokens.flatMap(t =>
        t.type === 'attr' ? [{ key: t.key, value: t.value }] : [],
      ),
    [parsed],
  );

  const expandedKey = state.tile
    ? wallItemKey(state.tile.metricId, state.tile.entity)
    : undefined;

  const openTile = useCallback(
    (item: WallItem) =>
      update({
        tile:
          wallItemKey(item.metric.id, item.entity) === expandedKey
            ? undefined
            : { metricId: item.metric.id, entity: item.entity },
      }),
    [update, expandedKey],
  );

  const renderDrillDown = (item: WallItem) =>
    state.tile ? (
      <MetricDrillDown
        item={item}
        tile={state.tile}
        source={source}
        dateRange={dateRange}
        filters={filters}
        searchFilters={searchFilters}
        onChange={patch =>
          state.tile && update({ tile: { ...state.tile, ...patch } })
        }
        onClose={() => update({ tile: undefined })}
        onEditAsChart={(agg, splitBy) =>
          onEditAsChart({
            metric: item.metric,
            agg,
            filters: item.entity ? [item.entity, ...filters] : filters,
            splitBy,
          })
        }
      />
    ) : null;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <Center h={200}>
        <Loader size="sm" />
      </Center>
    );
  } else if (error) {
    body = (
      <Alert variant="danger" title="Could not load the metric catalog">
        {error.message}
      </Alert>
    );
  } else if (metrics.length === 0) {
    body = (
      <EmptyState
        icon={<IconLayoutGrid size={32} />}
        title="No metrics reported"
        description="This source has not reported any metrics in the selected time range."
      />
    );
  } else if (sections.length === 0) {
    body = (
      <EmptyState
        icon={<IconLayoutGrid size={32} />}
        title="No metrics match"
        description="Remove a filter or change the search to see more metrics."
      />
    );
  } else {
    body = (
      <MetricWall
        sections={sections}
        source={source}
        dateRange={dateRange}
        filters={filters}
        searchFilters={searchFilters}
        expandedKey={expandedKey}
        onOpen={openTile}
        renderDrillDown={renderDrillDown}
      />
    );
  }

  return (
    <div className={styles.layout} data-testid="metric-browse">
      {!railCollapsed && (
        <MetricWallRail
          metrics={matching}
          source={source}
          dateRange={dateRange}
          query={query}
          onQueryChange={q => update({ query: q })}
          railKey={state.railKey}
          onRailKeyChange={key => update({ railKey: key })}
          onCollapse={() => onRailCollapsedChange(true)}
        />
      )}
      <div className={styles.main}>
        <MetricWallSearch
          query={query}
          onQueryChange={q => update({ query: q })}
          grouping={grouping}
          onGroupingChange={g =>
            update({ grouping: g === 'entity' ? undefined : g })
          }
          matchCount={matching.length}
          totalCount={metrics.length}
          railCollapsed={railCollapsed}
          onExpandRail={() => onRailCollapsedChange(false)}
        />
        {failedKinds.length > 0 && (
          <Text size="xs" c="dimmed" mb="xs">
            Could not read{' '}
            {failedKinds.map(k => METRIC_KIND_LABELS[k]).join(', ')} metrics.
          </Text>
        )}
        {body}
      </div>
    </div>
  );
}
