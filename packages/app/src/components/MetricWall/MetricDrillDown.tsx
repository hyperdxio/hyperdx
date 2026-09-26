import { useMemo } from 'react';
import { Filter, TMetricSource } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Chip,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChartLine, IconX } from '@tabler/icons-react';

import { DBTimeChart } from '@/components/DBTimeChart';
import { Sparkline } from '@/components/Sparkline';
import { getColorFromCSSToken } from '@/utils';
import { METRIC_KIND_LABELS } from '@/utils/metricKinds';

import { METRIC_QUANTITY_LABELS } from './classifyMetric';
import { QUANTITY_COLORS } from './MetricTile';
import {
  buildTileConfig,
  defaultTileAgg,
  MetricFilterClause,
  resolveTileAgg,
  TileAgg,
  tileAggOptions,
} from './tileDefaults';
import { useSplitCardinality } from './useMetricAttributeStats';
import { formatMetricValue, useMetricSeries } from './useMetricSeries';
import { ExpandedTile } from './useMetricWallState';
import { WallItem } from './wallGrouping';

import styles from './MetricWall.module.scss';

const MAX_MULTIPLES = 12;
// Past this many values a split draws more lines than anyone can read.
const HIGH_CARDINALITY = 50;

function SmallMultiples({
  config,
  unit,
  color,
}: {
  config: ReturnType<typeof buildTileConfig>;
  unit?: string;
  color: string;
}) {
  const { series, isLoading } = useMetricSeries({
    ...config,
    seriesLimit: MAX_MULTIPLES,
  });
  // One scale for every panel, or twelve flat-looking charts hide the one
  // series that is actually on fire.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const ys = series.flatMap(s => s.points.map(p => p.y));
    return ys.length ? [Math.min(0, ...ys), Math.max(...ys)] : undefined;
  }, [series]);

  if (isLoading) {
    return (
      <Text size="xs" c="dimmed">
        Loading…
      </Text>
    );
  }
  return (
    <>
      <Text fz={10} tt="uppercase" c="dimmed" mb={4}>
        Same split, broken out · {series.length} series · shared y scale
      </Text>
      <div className={styles.grid}>
        {series.slice(0, MAX_MULTIPLES).map(s => (
          <div key={s.key} className={styles.multiple}>
            <Text fz="xs" ff="monospace" truncate title={s.label}>
              {s.label}
            </Text>
            <div className={styles.spark}>
              <Sparkline
                points={s.points}
                type="area"
                color={color}
                yDomain={yDomain}
              />
            </div>
            <Text fz="xs" ta="right">
              {formatMetricValue(s.latest, unit)}
            </Text>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * A tile opened where it sits. The tile already carried a valid query, so
 * nothing has to be rebuilt: this only offers the other readings of it.
 */
export function MetricDrillDown({
  item,
  tile,
  source,
  dateRange,
  filters,
  searchFilters,
  onChange,
  onClose,
  onEditAsChart,
}: {
  item: WallItem;
  tile: ExpandedTile;
  source: TMetricSource;
  dateRange: [Date, Date];
  filters: MetricFilterClause[];
  searchFilters: Filter[];
  onChange: (patch: Partial<ExpandedTile>) => void;
  onClose: () => void;
  onEditAsChart: (agg: TileAgg, splitBy?: string) => void;
}) {
  const { metric, entity } = item;
  const agg = resolveTileAgg(metric.type, tile.agg);
  const defaultAgg = defaultTileAgg(metric.type);
  const quantity = metric.classification.quantity;
  const splits = useSplitCardinality({
    source,
    metricName: metric.name,
    metricType: metric.type,
    dateRange,
  });

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
        groupBy: tile.splitBy,
      }),
    [
      source,
      metric,
      agg,
      entity,
      filters,
      searchFilters,
      dateRange,
      tile.splitBy,
    ],
  );

  return (
    <div className={styles.drill} data-testid="metric-drill-down">
      <Group justify="space-between" align="flex-start" mb="xs">
        <div>
          <Text ff="monospace" fw={600} size="sm">
            {metric.name}
          </Text>
          <Text size="xs" c="dimmed">
            {METRIC_KIND_LABELS[metric.type]}
            {metric.unit ? ` · unit ${metric.unit}` : ''} · classified as{' '}
            {METRIC_QUANTITY_LABELS[quantity]}
            {entity ? ` · ${entity.key} ${entity.value}` : ''}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={agg.id}
            onChange={id =>
              onChange({ agg: id === defaultAgg.id ? undefined : id })
            }
            data={tileAggOptions(metric.type).map(a => ({
              value: a.id,
              label: a.id === defaultAgg.id ? `${a.label} (default)` : a.label,
            }))}
            aria-label="Aggregation"
          />
          <Button
            variant="secondary"
            size="compact-xs"
            leftSection={<IconChartLine size={14} />}
            onClick={() => onEditAsChart(agg, tile.splitBy)}
          >
            Edit as chart
          </Button>
          <Tooltip label="Back to the wall" fz="xs">
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={onClose}
              aria-label="Close"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {tile.multiples && tile.splitBy ? (
        <SmallMultiples
          config={config}
          unit={metric.unit}
          color={getColorFromCSSToken(QUANTITY_COLORS[quantity])}
        />
      ) : (
        <div style={{ height: 240 }}>
          <DBTimeChart
            sourceId={source.id}
            config={config}
            showDisplaySwitcher={false}
            showMVOptimizationIndicator={false}
            showDateRangeIndicator={false}
            queryKeyPrefix="metric-wall-drill-down"
          />
        </div>
      )}

      <Group gap="xs" mt="xs" wrap="wrap">
        <Text fz={10} tt="uppercase" c="dimmed">
          Split by
        </Text>
        {splits.isLoading && (
          <Text size="xs" c="dimmed">
            Loading attributes…
          </Text>
        )}
        {splits.data?.map(({ key, values }) => (
          <Chip
            key={key}
            size="xs"
            checked={tile.splitBy === key}
            onChange={checked =>
              onChange({ splitBy: checked ? key : undefined })
            }
            styles={{
              label: { opacity: values > HIGH_CARDINALITY ? 0.55 : 1 },
            }}
          >
            {key} {values}
          </Chip>
        ))}
        {splits.data?.length === 0 && (
          <Text size="xs" c="dimmed">
            Nothing to split by
          </Text>
        )}
        <SegmentedControl
          size="xs"
          ml="auto"
          disabled={!tile.splitBy}
          value={tile.multiples ? 'multiples' : 'one'}
          onChange={v =>
            onChange({ multiples: v === 'multiples' || undefined })
          }
          data={[
            { value: 'one', label: 'One chart' },
            { value: 'multiples', label: 'Small multiples' },
          ]}
          aria-label="Show the split as"
        />
      </Group>
    </div>
  );
}
