import { memo, useCallback, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Customized,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { buildChartSpine } from './chartSpine';
import { TimelineMarkers } from './TimelineMarkers';
import { TimelineTooltip } from './TimelineTooltip';
import type { TimelineLane } from './types';
import { useBrushZoom } from './useBrushZoom';

const X_AXIS_TICK_FONT_SIZE = 11;
const X_AXIS_MIN_TICK_GAP = 80;
const CHART_MARGIN = { top: 8, right: 40, bottom: 20, left: 8 };

type DashboardTimelineChartProps = {
  lanes: TimelineLane[];
  dateRange: [Date, Date];
  isLoading?: boolean;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  /**
   * Called when the user clicks on an event marker. Receives the event
   * timestamp (unix seconds) and lane key. Use to drill into search.
   */
  onMarkerClick?: (eventTs: number, laneKey: string) => void;
};

/**
 * Format an X-axis tick. The first tick on the visible axis prepends the
 * date so users have a calendar anchor without consuming horizontal space
 * on every label.
 */
function formatXAxisTick(value: number, index: number): string {
  const date = new Date(value * 1000);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    ...(index === 0 ? { month: 'short', day: 'numeric' } : {}),
  });
}

/**
 * Renders a Grafana-style annotation timeline: thin vertical lines + flag
 * markers for discrete events along a shared time axis.
 *
 * The component itself is intentionally a thin wiring layer. Logic lives in:
 *   - `chartSpine.ts`        (synthetic time-axis data points)
 *   - `TimelineMarkers.tsx`  (vertical lines + flag glyphs)
 *   - `TimelineTooltip.tsx`  (hover tooltip)
 *   - `useBrushZoom.ts`      (drag-to-select time range)
 */
export const MemoDashboardTimelineChart = memo(
  function MemoDashboardTimelineChart({
    lanes,
    dateRange,
    isLoading,
    onTimeRangeSelect,
    onMarkerClick,
  }: DashboardTimelineChartProps) {
    const { data, xAxisDomain } = useMemo(
      () => buildChartSpine(lanes, dateRange),
      [lanes, dateRange],
    );

    const {
      highlightStart,
      highlightEnd,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
    } = useBrushZoom(onTimeRangeSelect);

    const renderMarkers = useCallback(
      // Recharts passes an internal props object to Customized children.
      // We cast at the call site since Recharts' types are loose here.
      (props: object) => (
        <TimelineMarkers
          {...(props as Parameters<typeof TimelineMarkers>[0])}
          lanes={lanes}
          onMarkerClick={onMarkerClick}
        />
      ),
      [lanes, onMarkerClick],
    );

    const renderTooltip = useCallback(
      (props: object) => (
        <TimelineTooltip
          {...(props as Parameters<typeof TimelineTooltip>[0])}
          lanes={lanes}
        />
      ),
      [lanes],
    );

    return (
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        className={isLoading ? 'effect-pulse' : ''}
      >
        <AreaChart
          data={data}
          syncId="hdx"
          syncMethod="value"
          margin={CHART_MARGIN}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          <XAxis
            dataKey="ts_bucket"
            type="number"
            scale="time"
            domain={xAxisDomain}
            tickFormatter={formatXAxisTick}
            tick={{
              fontSize: X_AXIS_TICK_FONT_SIZE,
              fontFamily: 'IBM Plex Mono, monospace',
              fill: 'var(--mantine-color-dimmed)',
            }}
            stroke="var(--mantine-color-default-border)"
            minTickGap={X_AXIS_MIN_TICK_GAP}
          />
          <YAxis hide type="number" domain={[0, 1]} />
          {/*
            Invisible area series; gives Recharts a real series to bind the
            tooltip to. Without this, Customized markers alone are not enough
            for Recharts to register tooltip activations on the chart.
          */}
          <Area
            dataKey="_hover"
            type="monotone"
            stroke="transparent"
            fill="transparent"
            fillOpacity={0}
            strokeWidth={0}
            isAnimationActive={false}
            activeDot={false}
            dot={false}
          />
          <Customized component={renderMarkers} />
          <Tooltip
            content={renderTooltip}
            cursor={{
              fill: 'var(--mantine-color-default-border)',
              fillOpacity: 0.3,
            }}
            wrapperStyle={{ zIndex: 1 }}
          />
          {highlightStart != null && highlightEnd != null && (
            <ReferenceArea
              x1={Number.parseInt(highlightStart, 10)}
              x2={Number.parseInt(highlightEnd, 10)}
              strokeOpacity={0.3}
              fill="var(--mantine-color-gray-6)"
              fillOpacity={0.15}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    );
  },
);
