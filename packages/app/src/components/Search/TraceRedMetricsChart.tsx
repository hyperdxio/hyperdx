import { useMemo, useState } from 'react';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Flex, SegmentedControl } from '@mantine/core';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { ChartContainerCardHeaderProvider } from '@/components/charts/ChartContainer';
import DBHeatmapChart, {
  toHeatmapChartConfig,
} from '@/components/DBHeatmapChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import {
  getDurationMsExpression,
  getTraceDurationNumberFormat,
} from '@/source';
import type { NumberFormat } from '@/types';

import {
  durationConfig,
  ERROR_RATE_HELPER_SERIES,
  errorConditionSql,
  errorsConfig,
  ErrorsMode,
  redBaseConfig,
  throughputConfig,
} from './traceRedMetrics';

export type TraceChartMode = 'red' | 'heatmap';

// Fixed card-header row height. Pinning both the titles and the Errors
// rate/volume control to the same height keeps all three headers identical, so
// the plots align top and bottom regardless of which header carries a control.
const HEADER_ROW_HEIGHT = 22;

const titleNode = (label: string) => (
  <Box h={HEADER_ROW_HEIGHT} style={{ display: 'flex', alignItems: 'center' }}>
    {label}
  </Box>
);

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
}) {
  const [errorsMode, setErrorsMode] = useState<ErrorsMode>('rate');

  const errorCondition = errorConditionSql(source.statusCodeExpression);
  // Aggregate the raw Duration column (MV-friendly) and let the display format,
  // derived from the source's durationPrecision, convert the unit. Falls back
  // to getDurationMsExpression only for the heatmap tile below.
  const durationExpression = source.durationExpression ?? '';
  const durationFormat = getTraceDurationNumberFormat(source, {
    valueExpression: durationExpression,
    aggFn: 'avg',
  });
  const durationMsExpression = getDurationMsExpression(source);

  const base = useMemo(
    () => redBaseConfig(histogramTimeChartConfig),
    [histogramTimeChartConfig],
  );
  const throughput = useMemo(() => throughputConfig(base), [base]);
  const errors = useMemo(
    () => errorsConfig(base, errorCondition, errorsMode),
    [base, errorCondition, errorsMode],
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
        numberFormat: {
          output: 'duration',
          factor: 0.001,
        } satisfies NumberFormat,
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
      // Pin the control to the title/actions-icon height so the Errors card
      // header is exactly as tall as Throughput/Duration and the three plots
      // share a top and bottom to the pixel.
      styles={{
        root: { height: HEADER_ROW_HEIGHT, minHeight: 0, padding: 2 },
        label: {
          paddingTop: 0,
          paddingBottom: 0,
          paddingInline: 8,
          minHeight: 0,
          fontSize: 11,
          lineHeight: '18px',
        },
        indicator: { minHeight: 0 },
      }}
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

  return (
    <ChartContainerCardHeaderProvider>
      {mode === 'red' ? (
        <IsolatedChartSyncProvider>
          <Flex direction="row" h="100%" gap="sm" mih="0" miw="0">
            <Box flex="1" miw={0} mih={0}>
              <DBTimeChart
                title={titleNode('Throughput')}
                config={throughput}
                showLegend
                {...commonProps}
              />
            </Box>
            {errors != null && (
              <Box flex="1" miw={0} mih={0}>
                {/* Remount on mode change: DBTimeChart seeds its display type
                    from the initial config when uncontrolled, so a key swap
                    re-seeds bars (volume) vs line (rate). */}
                <DBTimeChart
                  key={errorsMode}
                  title={titleNode('Errors')}
                  toolbarSuffix={[errorsModeControl]}
                  config={errors}
                  showLegend
                  hiddenSeries={
                    errorsMode === 'rate' ? ERROR_RATE_HELPER_SERIES : undefined
                  }
                  {...commonProps}
                />
              </Box>
            )}
            <Box flex="1" miw={0} mih={0}>
              <DBTimeChart
                title={titleNode('Duration')}
                config={duration}
                showLegend
                {...commonProps}
              />
            </Box>
          </Flex>
        </IsolatedChartSyncProvider>
      ) : (
        <Box h="100%" mih={0}>
          <DBHeatmapChart
            title="Duration"
            config={heatmapConfig}
            scaleType={scaleType}
            enabled={isReady}
            showLegend
          />
        </Box>
      )}
    </ChartContainerCardHeaderProvider>
  );
}
