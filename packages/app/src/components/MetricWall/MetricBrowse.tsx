import { useCallback } from 'react';
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
import { useMetricBrowse } from './useMetricBrowse';
import { WallItem, wallItemKey } from './wallGrouping';

import styles from './MetricWall.module.scss';

/** The facet rail, rendered in the page's filter sidebar slot. */
export function MetricBrowseRail({
  source,
  dateRange,
  onCollapse,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
  onCollapse: () => void;
}) {
  const { matching, query, state, update } = useMetricBrowse({
    source,
    dateRange,
  });
  return (
    <MetricWallRail
      metrics={matching}
      source={source}
      dateRange={dateRange}
      query={query}
      onQueryChange={q => update({ query: q })}
      railKey={state.railKey}
      onRailKeyChange={key => update({ railKey: key })}
      onCollapse={onCollapse}
    />
  );
}

/**
 * The browse-first landing for metric sources: every metric already charted
 * with a sensible default, grouped by who reports it and banded by what it
 * measures, to narrow and open rather than assemble from an empty chart.
 */
export function MetricBrowse({
  source,
  dateRange,
  searchFilters,
  onEditAsChart,
}: {
  source: TMetricSource;
  dateRange: [Date, Date];
  searchFilters: Filter[];
  onEditAsChart: (request: EditAsChartRequest) => void;
}) {
  const {
    metrics,
    failedKinds,
    isLoading,
    error,
    state,
    update,
    query,
    grouping,
    sections,
    matching,
    filters,
  } = useMetricBrowse({ source, dateRange });

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
    <div className={styles.main} data-testid="metric-browse">
      <MetricWallSearch
        query={query}
        onQueryChange={q => update({ query: q })}
        grouping={grouping}
        onGroupingChange={g =>
          update({ grouping: g === 'entity' ? undefined : g })
        }
        matchCount={matching.length}
        totalCount={metrics.length}
      />
      {failedKinds.length > 0 && (
        <Text size="xs" c="dimmed" mb="xs">
          Could not read{' '}
          {failedKinds.map(k => METRIC_KIND_LABELS[k]).join(', ')} metrics.
        </Text>
      )}
      {body}
    </div>
  );
}
