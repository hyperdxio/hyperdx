import { type CSSProperties, useMemo, useState } from 'react';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, SegmentedControl } from '@mantine/core';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { ChartCard } from '@/components/charts/ChartCard';
import DBHeatmapChart, {
  toHeatmapChartConfig,
} from '@/components/DBHeatmapChart';
import { DBTimeChart, type SeriesGroupFilter } from '@/components/DBTimeChart';
import {
  DURATION_HEATMAP_NUMBER_FORMAT,
  getDurationMsExpression,
  getTraceDurationNumberFormat,
} from '@/source';

import {
  DURATION_SERIES_COLORS,
  durationConfig,
  ERROR_RATE_HELPER_SERIES,
  errorsConfig,
  ErrorsMode,
  redBaseConfig,
  throughputConfig,
} from './traceRedMetrics';

export type TraceChartMode = 'red' | 'heatmap';

// Each RED tile is a ChartCard flex child that fills its column; ChartCard
// supplies the dashboard-tile chrome (border, background, full-bleed header
// divider) and the card-header context, so the three headers line up on their
// own without any manual height pinning.
const RED_TILE_STYLE = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  height: '100%',
} satisfies CSSProperties;

/**
 * RED metrics (Throughput, Errors, Duration) for the trace search results view,
 * replacing the single count histogram. The three charts render side by side as
 * sibling DBTimeCharts under a shared sync scope, so hovering one shows a
 * cross-chart cursor on all three at the same timestamp. The RED/Heatmap switch
 * lives in the search stats row (passed in as `mode`); the Heatmap view is the
 * same bare heatmap tile the dashboard renders.
 *
 * The per-chart aggregations are built by ./traceRedMetrics from the same base
 * config the histogram uses, so all three honor the active WHERE filter and
 * selected time range.
 */
export function TraceRedMetricsChart({
  mode,
  histogramTimeChartConfig,
  heatmapChartConfig,
  source,
  isReady,
  queryKeyPrefix,
  onTimeRangeSelect,
  onFocusSeries,
}: {
  /** RED vs heatmap; owned by the search stats row so the switch sits inline. */
  mode: TraceChartMode;
  /** The count-histogram config; RED charts spread this and swap only select. */
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  /** Base config for the heatmap tile, mirroring the delta-mode callsite. */
  heatmapChartConfig: BuilderChartConfigWithDateRange;
  source: TTraceSource;
  isReady: boolean;
  queryKeyPrefix?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  /** Filter the results by a clicked status series, matching the histogram's
   * per-status drill-down. Only the volume Errors chart is grouped by status,
   * so only it surfaces this. */
  onFocusSeries?: (filters: SeriesGroupFilter[]) => void;
}) {
  const [errorsMode, setErrorsMode] = useState<ErrorsMode>('rate');

  // Aggregate the raw Duration column (MV-friendly) and let the display format,
  // derived from the source's durationPrecision, convert the unit. Falls back
  // to getDurationMsExpression only for the heatmap tile below.
  const durationExpression = source.durationExpression ?? '';
  // Memoized: getTraceDurationNumberFormat returns a fresh object, so an
  // unmemoized value would change identity every render and defeat the
  // `duration` memo below (re-rendering DBTimeChart on every keystroke/tick).
  const durationFormat = useMemo(
    () =>
      getTraceDurationNumberFormat(source, {
        valueExpression: durationExpression,
        aggFn: 'avg',
      }),
    [source, durationExpression],
  );
  const durationMsExpression = getDurationMsExpression(source);

  const base = useMemo(
    () => redBaseConfig(histogramTimeChartConfig),
    [histogramTimeChartConfig],
  );
  const throughput = useMemo(() => throughputConfig(base), [base]);
  const errors = useMemo(
    () => errorsConfig(base, source.statusCodeExpression, errorsMode),
    [base, source.statusCodeExpression, errorsMode],
  );
  const duration = useMemo(
    () => durationConfig(base, durationExpression, durationFormat),
    [base, durationExpression, durationFormat],
  );
  // Heatmap tile config (duration distribution over time), matching the
  // dashboard heatmap tile: DBHeatmapChart + toHeatmapChartConfig, no
  // significant-fields comparison panel.
  const { heatmapConfig, scaleType } = useMemo(
    () =>
      toHeatmapChartConfig({
        ...heatmapChartConfig,
        select: [
          {
            valueExpression: durationMsExpression,
            countExpression: 'count()',
            heatmapScaleType: 'log',
          },
        ],
        numberFormat: DURATION_HEATMAP_NUMBER_FORMAT,
      }),
    [heatmapChartConfig, durationMsExpression],
  );

  const errorsModeControl = (
    <SegmentedControl
      key="errors-mode"
      size="xs"
      value={errorsMode}
      onChange={v => setErrorsMode(v === 'volume' ? 'volume' : 'rate')}
      data={[
        { label: 'Rate', value: 'rate' },
        { label: 'Vol', value: 'volume' },
      ]}
    />
  );

  const commonProps = {
    sourceId: source.id,
    enabled: isReady,
    showDisplaySwitcher: false,
    showMVOptimizationIndicator: false,
    showDateRangeIndicator: false,
    queryKeyPrefix,
    onTimeRangeSelect,
    enableParallelQueries: true,
    // narrow tiles: keep the edge time labels from clipping
    compactXAxisLabels: true,
  } as const;

  return mode === 'red' ? (
    <IsolatedChartSyncProvider>
      <Flex direction="row" h="100%" gap="sm" mih="0" miw="0">
        <ChartCard style={RED_TILE_STYLE}>
          <DBTimeChart
            title="Throughput"
            config={throughput}
            showLegend
            {...commonProps}
          />
        </ChartCard>
        {errors != null && (
          <ChartCard style={RED_TILE_STYLE}>
            {/* Remount on mode change: DBTimeChart seeds its display type
                  from the initial config when uncontrolled, so a key swap
                  re-seeds bars (volume) vs line (rate). */}
            <DBTimeChart
              key={errorsMode}
              title="Errors"
              toolbarSuffix={[errorsModeControl]}
              config={errors}
              showLegend
              hiddenSeries={
                errorsMode === 'rate' ? ERROR_RATE_HELPER_SERIES : undefined
              }
              // Rate is 0-100%: cap the axis so a flat/near-zero series
              // can't render a nonsense 0-400% scale, while still
              // auto-scaling to small values.
              yAxisMaxDomain={errorsMode === 'rate' ? 1 : undefined}
              // Volume is grouped by status, so clicking the bar filters the
              // results to that status (the histogram's drill-down). Rate is
              // a single ungrouped line, so it has nothing to drill into.
              onFocusSeries={
                errorsMode === 'volume' ? onFocusSeries : undefined
              }
              {...commonProps}
            />
          </ChartCard>
        )}
        <ChartCard style={RED_TILE_STYLE}>
          <DBTimeChart
            title="Duration"
            config={duration}
            seriesColors={DURATION_SERIES_COLORS}
            showLegend
            {...commonProps}
          />
        </ChartCard>
      </Flex>
    </IsolatedChartSyncProvider>
  ) : (
    <ChartCard style={{ height: '100%', minHeight: 0 }}>
      <DBHeatmapChart
        title="Duration"
        config={heatmapConfig}
        scaleType={scaleType}
        enabled={isReady}
        showLegend
      />
    </ChartCard>
  );
}
