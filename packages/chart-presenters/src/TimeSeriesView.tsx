/**
 * <TimeSeriesView />: pure presenter for time-series line and stacked-bar
 * charts. No data-fetching, no app context, no Mantine, no Jotai.
 *
 * Used by:
 *   - packages/app (DBTimeChart wraps this with its data hook + interactions)
 *   - packages/mcp-widget (widget renders MCP App tool results into this)
 *
 * The dashboard wraps additional interactivity (drag-to-zoom, +N legend
 * popover, reference areas, materialised-view indicators) around this
 * presenter; those features stay in the dashboard's wrapper because they
 * pull in environment-specific deps (Mantine portals, Next router).
 */
import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarProps,
  type LegendProps,
  type TooltipProps,
} from 'recharts';
import type { AxisDomain } from 'recharts/types/util/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SeriesDescriptor = {
  /** Column key in each data row that holds this series' value. */
  key: string;
  /** Human label shown in the legend / tooltip. Defaults to `key`. */
  displayName?: string;
  /** Stroke / fill color (CSS color string). Auto-assigned if omitted. */
  color?: string;
  /** Render as dashed (e.g. previous-period overlay). Default: solid. */
  isDashed?: boolean;
};

export type TimeSeriesDataRow = Record<string, number | string | null>;

export type TimeSeriesDisplayType = 'line' | 'stacked_bar';

export type FormatNumberFn = (value: number) => string;
export type FormatTimeFn = (epochMs: number) => string;

export interface TimeSeriesViewProps {
  /**
   * Bucketed data points. Each row has the bucket key (default
   * `'ts_bucket'`, in **seconds since epoch**) plus one numeric column per
   * series. Other columns are ignored.
   */
  data: TimeSeriesDataRow[];
  /** Series to plot. Order is preserved. */
  series: SeriesDescriptor[];
  /** Closed range used to set the X-axis domain. */
  dateRange: readonly [Date, Date];
  /** `'line'` (default) or `'stacked_bar'`. */
  displayType?: TimeSeriesDisplayType;
  /** Bucket key in `data` rows. Default `'ts_bucket'`. */
  timestampKey?: string;
  /**
   * Bucket size in seconds, used for x-axis tick spacing. If omitted, the
   * X-axis falls back to Recharts' auto-spacing.
   */
  granularitySeconds?: number;
  /** Height in pixels. Default 240. */
  height?: number;
  /** Show the inline legend below the chart. Default true. */
  showLegend?: boolean;
  /** Maximum legend entries shown inline. Overflow caller-handled. */
  maxLegendItems?: number;
  /**
   * Number formatter for tooltip + Y-axis. Receives a numeric value, returns
   * a display string. Default: `Intl.NumberFormat` with k/M/B suffixes.
   */
  formatNumber?: FormatNumberFn;
  /**
   * Time formatter for X-axis ticks. Receives epoch milliseconds, returns
   * a display string. Default: locale-formatted time.
   */
  formatTime?: FormatTimeFn;
  /** Optional class for the container. */
  className?: string;
  /**
   * Custom tooltip override. Receives standard Recharts `<Tooltip>` props.
   * If omitted, a built-in tooltip renders the formatted values.
   */
  tooltipContent?: TooltipProps<number, string>['content'];
  /**
   * Custom legend override. Receives standard Recharts `<Legend>` props.
   * To hide the legend entirely, set `showLegend={false}`.
   */
  legendContent?: LegendProps['content'];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  '#50e3c2',
  '#f5a623',
  '#bd10e0',
  '#7ed321',
  '#4a90e2',
  '#d0021b',
  '#9013fe',
  '#f8e71c',
];

/** Hard cap on rendered series. Beyond this Recharts gets unhappy. */
export const HARD_LINES_LIMIT = 60;

const defaultFormatNumber: FormatNumberFn = v => {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
};

const defaultFormatTime: FormatTimeFn = epochMs => {
  const d = new Date(epochMs);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

// ─── Stacked-bar helper ──────────────────────────────────────────────────────

/**
 * Stacked bar shape: draws each segment as a 1px-overlapped rect so that
 * adjacent buckets visually join into a continuous band (matches the
 * dashboard's existing styling).
 */
function StackedBarWithOverlap(props: BarProps) {
  const { x, y, width, height, fill } = props as BarProps & {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return (
    <rect
      x={x}
      y={y}
      width={width + 1}
      height={height}
      fill={fill}
      stroke="none"
    />
  );
}

// ─── Default tooltip ─────────────────────────────────────────────────────────

function DefaultTooltip({
  active,
  payload,
  label,
  formatNumber,
  formatTime,
}: TooltipProps<number, string> & {
  formatNumber: FormatNumberFn;
  formatTime: FormatTimeFn;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const ts = typeof label === 'number' ? label * 1000 : Number(label);
  return (
    <div
      style={{
        background: 'rgba(20, 23, 28, 0.96)',
        color: '#e8eaed',
        border: '1px solid #2a2d33',
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 11,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.4,
      }}
    >
      <div
        style={{ color: '#9aa0a6', marginBottom: 4, fontWeight: 600 }}
      >
        {Number.isFinite(ts) ? formatTime(ts) : ''}
      </div>
      {payload.map(p => (
        <div
          key={String(p.dataKey)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: p.color ?? '#888',
                marginRight: 6,
              }}
            />
            {p.name ?? p.dataKey}
          </span>
          <span style={{ fontFeatureSettings: '"tnum"' }}>
            {typeof p.value === 'number' ? formatNumber(p.value) : '-'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Default legend ──────────────────────────────────────────────────────────

function DefaultLegend({
  payload,
  maxLegendItems = 4,
}: LegendProps & { maxLegendItems?: number }) {
  if (!payload || payload.length === 0) return null;
  const visible = payload.slice(0, maxLegendItems);
  const overflow = payload.length - visible.length;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        fontSize: 11,
        color: '#9aa0a6',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {visible.map(entry => (
        <span key={String(entry.value)}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              background: entry.color ?? '#888',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {String(entry.value)}
        </span>
      ))}
      {overflow > 0 ? <span>+{overflow} more</span> : null}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Pure presenter; all behaviour is determined by props. No data fetching, no
 * Jotai, no Mantine, no router access. Safe to import from any environment
 * including sandboxed iframes.
 */
export function TimeSeriesView({
  data,
  series,
  dateRange,
  displayType = 'line',
  timestampKey = 'ts_bucket',
  granularitySeconds,
  height = 240,
  showLegend = true,
  maxLegendItems = 4,
  formatNumber = defaultFormatNumber,
  formatTime = defaultFormatTime,
  className,
  tooltipContent,
  legendContent,
}: TimeSeriesViewProps) {
  const _id = useId();
  const id = _id.replace(/:/g, '');

  const colorFor = useMemo(() => {
    const explicit = new Map<string, string>();
    for (const s of series) {
      if (s.color) explicit.set(s.key, s.color);
    }
    return (key: string, idx: number): string =>
      explicit.get(key) ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
  }, [series]);

  // Visible series, capped to HARD_LINES_LIMIT.
  const visibleSeries = useMemo(
    () => series.slice(0, HARD_LINES_LIMIT),
    [series],
  );

  const yDomain: AxisDomain = useMemo(() => [0, 'auto'] as const, []);

  const xDomain = useMemo<[number, number]>(() => {
    const start = Math.floor(dateRange[0].getTime() / 1000);
    const end = Math.floor(dateRange[1].getTime() / 1000);
    return [start, end];
  }, [dateRange]);

  const xTickFormatter = (v: number) => formatTime(v * 1000);

  const xTicks = useMemo<number[] | undefined>(() => {
    if (!granularitySeconds) return undefined;
    const ticks: number[] = [];
    // Aim for ~6 ticks across the range.
    const span = xDomain[1] - xDomain[0];
    const targetTickCount = 6;
    const stepSeconds = Math.max(
      granularitySeconds,
      Math.round(span / targetTickCount / granularitySeconds) * granularitySeconds,
    );
    for (let t = xDomain[0]; t <= xDomain[1]; t += stepSeconds) {
      ticks.push(t);
    }
    return ticks;
  }, [granularitySeconds, xDomain]);

  const ChartComponent = displayType === 'stacked_bar' ? BarChart : AreaChart;

  return (
    <div className={className} style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(154, 160, 166, 0.18)"
            vertical={false}
          />
          <XAxis
            dataKey={timestampKey}
            domain={xDomain}
            type="number"
            scale="time"
            ticks={xTicks}
            tickFormatter={xTickFormatter}
            tick={{ fill: '#9aa0a6', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(154, 160, 166, 0.25)' }}
            allowDataOverflow
          />
          <YAxis
            domain={yDomain}
            tickFormatter={formatNumber}
            tick={{ fill: '#9aa0a6', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(154, 160, 166, 0.35)' }}
            content={
              tooltipContent ?? (
                <DefaultTooltip
                  formatNumber={formatNumber}
                  formatTime={formatTime}
                />
              )
            }
          />
          {showLegend ? (
            <Legend
              verticalAlign="bottom"
              align="left"
              wrapperStyle={{ paddingTop: 8 }}
              content={
                legendContent ?? (
                  <DefaultLegend maxLegendItems={maxLegendItems} />
                )
              }
            />
          ) : null}
          {visibleSeries.map((s, i) => {
            const color = colorFor(s.key, i);
            const strokeDasharray = s.isDashed ? '4 3' : '0';
            const displayName = s.displayName ?? s.key;
            if (displayType === 'stacked_bar') {
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={displayName}
                  fill={color}
                  stackId="1"
                  isAnimationActive={false}
                  shape={<StackedBarWithOverlap dataKey={s.key} />}
                />
              );
            }
            return (
              <Area
                key={s.key}
                dataKey={s.key}
                name={displayName}
                type="monotone"
                stroke={color}
                fill={color}
                fillOpacity={0.12}
                strokeWidth={1.5}
                strokeDasharray={strokeDasharray}
                isAnimationActive={false}
                connectNulls
                // Defs for area gradient could be added per-series; keeping
                // it simple with flat fillOpacity for the presenter.
                {...{ id: `series-${id}-${i}` }}
              />
            );
          })}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
