import { memo, useMemo } from 'react';
import {
  ChartPaletteToken,
  Filter,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Group, Text, UnstyledButton } from '@mantine/core';
import { useInViewport } from '@mantine/hooks';

import { Sparkline } from '@/components/Sparkline';
import { getColorFromCSSToken } from '@/utils';
import { METRIC_KIND_LABELS } from '@/utils/metricKinds';

import { METRIC_QUANTITY_LABELS, MetricQuantity } from './classifyMetric';
import {
  buildTileConfig,
  defaultTileAgg,
  MetricFilterClause,
} from './tileDefaults';
import { formatMetricValue, useMetricSeries } from './useMetricSeries';
import { WallItem } from './wallGrouping';

import styles from './MetricWall.module.scss';

export const QUANTITY_COLORS: Record<MetricQuantity, ChartPaletteToken> = {
  latency: 'chart-blue',
  errors: 'chart-red',
  throughput: 'chart-green',
  saturation: 'chart-light-blue',
  queue: 'chart-orange',
  unclassified: 'chart-gray',
};

function MetricTileComponent({
  item,
  source,
  dateRange,
  filters,
  searchFilters,
  onOpen,
}: {
  item: WallItem;
  source: TMetricSource;
  dateRange: [Date, Date];
  /** Attribute filters from the wall's own search. */
  filters: MetricFilterClause[];
  searchFilters: Filter[];
  onOpen: (item: WallItem) => void;
}) {
  const { metric, entity } = item;
  const agg = defaultTileAgg(metric.type);
  // A wall of forty tiles would fire forty queries on load; only the ones on
  // screen ask for data.
  const { ref, inViewport } = useInViewport();

  const config = useMemo(
    () =>
      buildTileConfig({
        source,
        metricName: metric.name,
        metricType: metric.type,
        agg,
        filters: entity ? [entity, ...filters] : filters,
        searchFilters,
        dateRange,
      }),
    [source, metric, agg, entity, filters, searchFilters, dateRange],
  );
  const { series } = useMetricSeries(config, { enabled: inViewport });
  const first = series[0];
  const quantity = metric.classification.quantity;
  const guessed = metric.classification.reason === 'fallback';

  return (
    <UnstyledButton
      ref={ref}
      className={styles.tile}
      onClick={() => onOpen(item)}
      data-testid="metric-tile"
      aria-label={`Open ${metric.name}`}
    >
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text fz={10} tt="uppercase" c="dimmed" truncate>
          {METRIC_QUANTITY_LABELS[quantity]}
        </Text>
        <Text fz={10} c="dimmed" truncate>
          {metric.unit ?? METRIC_KIND_LABELS[metric.type]}
        </Text>
      </Group>
      <Text className={styles.tileName}>{metric.name}</Text>
      <div className={styles.spark}>
        {first && (
          <Sparkline
            points={first.points}
            type="area"
            color={getColorFromCSSToken(QUANTITY_COLORS[quantity])}
          />
        )}
      </div>
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text fz={10} c="dimmed">
          {agg.label}
          {guessed ? ' (guessed)' : ''}
        </Text>
        <Text fz="xs" fw={500}>
          {formatMetricValue(first?.latest, metric.unit)}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

export const MetricTile = memo(MetricTileComponent);
