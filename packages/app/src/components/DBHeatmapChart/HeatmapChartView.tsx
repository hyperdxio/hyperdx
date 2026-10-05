import { useMemo } from 'react';
import cx from 'classnames';
import { Text, useMantineColorScheme } from '@mantine/core';

import ChartContainer from '@/components/charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from '@/components/charts/ChartErrorState';
import { NumberFormat } from '@/types';

import { ColorLegend } from './ColorLegend';
import { HeatmapPlot } from './HeatmapPlot';
import { darkPalette, lightPalette } from './palette';
import type { SelectionBounds } from './selection';
import type { HeatmapData } from './useHeatmapView';

export type HeatmapChartViewProps = {
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showLegend?: boolean;
  errorVariant?: ChartErrorStateVariant;
};

/** Renders a heatmap's data: toolbar, loading/error/empty states and the plot. */
export function HeatmapChartView({
  data: { view, isLoading, isRefreshing, error },
  plotKey,
  numberFormat,
  onFilter,
  onClearFilter,
  selectionBounds,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showLegend = false,
  errorVariant,
}: HeatmapChartViewProps & {
  data: HeatmapData;
  /** Remounts the plot when the query changes. */
  plotKey: string;
  numberFormat?: NumberFormat;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  selectionBounds?: SelectionBounds | null;
}) {
  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

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
          key={plotKey}
          className={cx({ 'effect-pulse': isRefreshing })}
          grid={view.grid}
          numberFormat={numberFormat}
          onFilter={onFilter}
          onClearFilter={onClearFilter}
          scaleType={view.scaleType}
          palette={palette}
          selectionBounds={selectionBounds}
        />
      )}
    </ChartContainer>
  );
}
