import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import cx from 'classnames';
import { Text, useMantineColorScheme } from '@mantine/core';

import ChartContainer from '@/components/charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from '@/components/charts/ChartErrorState';

import { ColorLegend } from './ColorLegend';
import type { HeatmapScaleType } from './heatmapGrid';
import { HeatmapPlot } from './HeatmapPlot';
import type { HeatmapChartConfig } from './heatmapQueries';
import { darkPalette, lightPalette } from './palette';
import type { SelectionBounds } from './selection';
import { useHeatmapData } from './useHeatmapData';

type DBHeatmapChartProps = {
  config: HeatmapChartConfig;
  enabled?: boolean;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  /**
   * The currently-applied drag-select bounds. When provided, the heatmap
   * draws the dashed selection rectangle and reapplies it after any uPlot
   * recreation (theme switch, prop change, resize) so the user always sees
   * which slice they filtered. Caller owns the URL/query-state plumbing;
   * this is purely a visual mirror of that state.
   */
  selectionBounds?: SelectionBounds | null;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  scaleType?: HeatmapScaleType;
  showLegend?: boolean;
  errorVariant?: ChartErrorStateVariant;
};

function DBHeatmapChart({
  config,
  enabled = true,
  onFilter,
  onClearFilter,
  selectionBounds,
  title,
  toolbarPrefix,
  toolbarSuffix,
  scaleType = 'log',
  showLegend = false,
  errorVariant,
}: DBHeatmapChartProps) {
  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

  const { view, isLoading, isRefreshing, error } = useHeatmapData({
    config,
    scaleType,
    enabled,
  });

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems: React.ReactNode[] = [];

    if (showLegend) {
      allToolbarItems.push(
        <ColorLegend key="heatmap-legend" colors={palette} />,
      );
    }

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [showLegend, palette, toolbarPrefix, toolbarSuffix]);

  return (
    <ChartContainer
      title={title}
      toolbarItems={toolbarItemsMemo}
      disableReactiveContainer
    >
      {isLoading ? (
        <Text size="sm" ta="center" p="xl">
          Loading...
        </Text>
      ) : error ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : view.grid.cells.length < 2 || view.generatedTsBuckets.length < 2 ? (
        <Text
          size="sm"
          ta="center"
          p="xl"
          className={cx({ 'effect-pulse': isRefreshing })}
        >
          Not enough data points to render heatmap. Try expanding your search
          criteria.
        </Text>
      ) : (
        <HeatmapPlot
          key={JSON.stringify(config)}
          className={cx({ 'effect-pulse': isRefreshing })}
          grid={view.grid}
          numberFormat={config.numberFormat}
          onFilter={
            onFilter
              ? (xMin, xMax, yMin, yMax) => {
                  // In log mode, the bottom bucket collects all values
                  // clamped by greatest(value, effectiveMin).  If the
                  // selection touches that bucket, widen yMin to 0 so
                  // the downstream SQL filter captures all those spans.
                  // The 1.1x threshold adds 10% headroom to account for
                  // floating-point rounding in the bucket boundary.
                  const adjustedYMin =
                    view.scaleType === 'log' && yMin <= view.effectiveMin * 1.1
                      ? 0
                      : yMin;
                  onFilter(xMin, xMax, adjustedYMin, yMax);
                }
              : undefined
          }
          onClearFilter={onClearFilter}
          scaleType={view.scaleType}
          palette={palette}
          selectionBounds={selectionBounds}
        />
      )}
    </ChartContainer>
  );
}

export default dynamic(() => Promise.resolve(DBHeatmapChart), {
  ssr: false,
});
