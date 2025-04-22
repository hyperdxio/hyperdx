import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { add } from 'date-fns';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  BarProps,
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Popover } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import type { NumberFormat } from '@/types';
import { COLORS, formatNumber, getColorProps, truncateMiddle } from '@/utils';

import { FormatTime, useFormatTime } from './useFormatTime';

import styles from '../styles/HDXLineChart.module.scss';

const MAX_LEGEND_ITEMS = 4;

type TooltipPayload = {
  dataKey: string;
  name: string;
  value: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity?: number;
};

export const TooltipItem = memo(
  ({ p, numberFormat }: { p: TooltipPayload; numberFormat?: NumberFormat }) => {
    return (
      <div className="d-flex gap-2 items-center justify-center">
        <div>
          <svg width="12" height="4">
            <line
              x1="0"
              y1="2"
              x2="12"
              y2="2"
              stroke={p.color}
              opacity={p.opacity}
              strokeDasharray={p.strokeDasharray}
            />
          </svg>
        </div>
        <div>
          <span style={{ color: p.color }}>
            {truncateMiddle(p.name ?? p.dataKey, 50)}
          </span>
          : {numberFormat ? formatNumber(p.value, numberFormat) : p.value}
        </div>
      </div>
    );
  },
);

const HDXLineChartTooltip = withErrorBoundary(
  memo((props: any) => {
    const { active, payload, label, numberFormat } = props;
    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <div className={styles.chartTooltipHeader}>
            <FormatTime value={label * 1000} />
          </div>
          <div className={styles.chartTooltipContent}>
            {payload
              .sort((a: any, b: any) => b.value - a.value)
              .map((p: any) => (
                <TooltipItem
                  key={p.dataKey}
                  p={p}
                  numberFormat={numberFormat}
                />
              ))}
          </div>
        </div>
      );
    }
    return null;
  }),
  {
    onError: console.error,
    fallback: (
      <div className="text-danger px-2 py-1 m-2 fs-8 font-monospace bg-danger-transparent">
        An error occurred while rendering the tooltip.
      </div>
    ),
  },
);

function CopyableLegendItem({ entry }: any) {
  return (
    <span
      className={styles.legendItem}
      style={{ color: entry.color }}
      role="button"
      onClick={() => {
        window.navigator.clipboard.writeText(entry.value);
        notifications.show({ color: 'green', message: `Copied to clipboard` });
      }}
      title="Click to expand"
    >
      <div className="d-flex gap-1 items-center justify-center">
        <div>
          <svg width="12" height="4">
            <line
              x1="0"
              y1="2"
              x2="12"
              y2="2"
              stroke={entry.color}
              opacity={entry.opacity}
              strokeDasharray={entry.payload?.strokeDasharray}
            />
          </svg>
        </div>
        {entry.value}
      </div>
    </span>
  );
}

function ExpandableLegendItem({ entry, expanded }: any) {
  const [_expanded, setExpanded] = useState(false);
  const isExpanded = _expanded || expanded;

  return (
    <span
      className={`d-flex gap-1 items-center justify-center ${styles.legendItem}`}
      style={{ color: entry.color }}
      role="button"
      onClick={() => setExpanded(v => !v)}
      title="Click to expand"
    >
      <div>
        <svg width="12" height="4">
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke={entry.color}
            opacity={entry.opacity}
            strokeDasharray={entry.payload?.strokeDasharray}
          />
        </svg>
      </div>
      {isExpanded ? entry.value : truncateMiddle(`${entry.value}`, 35)}
    </span>
  );
}

export const LegendRenderer = memo<{
  payload?: {
    value: string;
    color: string;
  }[];
}>(props => {
  const payload = props.payload ?? [];

  const shownItems = payload.slice(0, MAX_LEGEND_ITEMS);
  const restItems = payload.slice(MAX_LEGEND_ITEMS);

  return (
    <div className={styles.legend}>
      {shownItems.map((entry, index) => (
        <ExpandableLegendItem
          key={`item-${index}`}
          value={entry.value}
          entry={entry}
        />
      ))}
      {restItems.length ? (
        <Popover withinPortal withArrow closeOnEscape closeOnClickOutside>
          <Popover.Target>
            <div className={cx(styles.legendItem, styles.legendMoreLink)}>
              +{restItems.length} more
            </div>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <div className={styles.legendTooltipContent}>
              {restItems.map((entry, index) => (
                <CopyableLegendItem
                  key={`item-${index}`}
                  value={entry.value}
                  entry={entry}
                />
              ))}
            </div>
          </Popover.Dropdown>
        </Popover>
      ) : null}
    </div>
  );
});

const HARD_LINES_LIMIT = 60;
export const MemoChart = memo(function MemoChart({
  graphResults,
  setIsClickActive,
  isClickActive,
  dateRange,
  groupKeys,
  lineNames,
  lineColors,
  referenceLines,
  logReferenceTimestamp,
  displayType = DisplayType.Line,
  numberFormat,
  isLoading,
  timestampKey = 'ts_bucket',
  onTimeRangeSelect,
  showLegend = true,
}: {
  graphResults: any[];
  setIsClickActive: (v: any) => void;
  isClickActive: any;
  dateRange: [Date, Date] | Readonly<[Date, Date]>;
  groupKeys: string[];
  lineNames: string[];
  lineColors: Array<string | undefined>;
  referenceLines?: React.ReactNode;
  displayType?: DisplayType;
  numberFormat?: NumberFormat;
  logReferenceTimestamp?: number;
  isLoading?: boolean;
  timestampKey?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  showLegend?: boolean;
}) {
  const _id = useId();
  const id = _id.replace(/:/g, '');

  const [isHovered, setIsHovered] = useState(false);

  const ChartComponent =
    displayType === DisplayType.StackedBar ? BarChart : AreaChart; // LineChart;

  const lines = useMemo(() => {
    const limitedGroupKeys = groupKeys.slice(0, HARD_LINES_LIMIT);

    // Check if any group is missing from any row
    const isContinuousGroup = graphResults.reduce((acc, row) => {
      limitedGroupKeys.forEach(key => {
        acc[key] = row[key] != null ? acc[key] : false;
      });
      return acc;
    }, {});

    return limitedGroupKeys.map((key, i) => {
      const {
        color: _color,
        opacity,
        strokeDasharray,
        strokeWidth,
      } = getColorProps(i, lineNames[i] ?? key);

      const color = lineColors[i] ?? _color;

      const StackedBarWithOverlap = (props: BarProps) => {
        const { x, y, width, height, fill } = props;
        // Add a tiny bit to the height to create overlap. Otherwise there's a gap
        return (
          <rect
            x={x}
            y={y}
            width={width}
            height={height && height > 0 ? height + 0.5 : 0}
            fill={fill}
          />
        );
      };

      return displayType === 'stacked_bar' ? (
        <Bar
          key={key}
          type="monotone"
          dataKey={key}
          name={lineNames[i] ?? key}
          fill={color}
          opacity={opacity}
          stackId="1"
          isAnimationActive={false}
          shape={<StackedBarWithOverlap dataKey={key} />}
        />
      ) : (
        <Area
          key={key}
          dataKey={key}
          type="monotone"
          stroke={color}
          fillOpacity={1}
          {...(isHovered
            ? { fill: 'none' }
            : {
                fill: `url(#time-chart-lin-grad-${id}-${color.replace('#', '').toLowerCase()})`,
              })}
          name={lineNames[i] ?? key}
          isAnimationActive={false}
        />
      );
    });
  }, [
    groupKeys,
    graphResults,
    displayType,
    lineNames,
    lineColors,
    id,
    isHovered,
  ]);

  const sizeRef = useRef<[number, number]>([0, 0]);

  const formatTime = useFormatTime();
  const xTickFormatter = useCallback(
    (value: number, index: number) => {
      return formatTime(value * 1000, {
        format: index === 0 ? 'normal' : 'time',
      });
    },
    [formatTime],
  );

  const tickFormatter = useCallback(
    (value: number, index: number) => {
      return numberFormat
        ? formatNumber(value, {
            ...numberFormat,
            average: true,
            mantissa: 0,
            unit: undefined,
          })
        : new Intl.NumberFormat('en-US', {
            notation: 'compact',
            compactDisplay: 'short',
          }).format(value);
    },
    [numberFormat],
  );

  const [highlightStart, setHighlightStart] = useState<string | undefined>();
  const [highlightEnd, setHighlightEnd] = useState<string | undefined>();

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      onResize={(width, height) => {
        sizeRef.current = [width ?? 1, height ?? 1];
      }}
      className={isLoading ? 'effect-pulse' : ''}
    >
      <ChartComponent
        width={500}
        height={300}
        data={graphResults}
        syncId="hdx"
        syncMethod="value"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={e => {
          setIsHovered(false);

          setHighlightStart(undefined);
          setHighlightEnd(undefined);
        }}
        onMouseDown={e => e != null && setHighlightStart(e.activeLabel)}
        onMouseMove={e => {
          setIsHovered(true);

          if (highlightStart != null) {
            setHighlightEnd(e.activeLabel);
            setIsClickActive(undefined); // Clear out any click state as we're highlighting
          }
        }}
        onMouseUp={e => {
          if (e?.activeLabel != null && highlightStart === e.activeLabel) {
            // If it's just a click, don't zoom
            setHighlightStart(undefined);
            setHighlightEnd(undefined);
          }
          if (highlightStart != null && highlightEnd != null) {
            try {
              onTimeRangeSelect?.(
                new Date(
                  Number.parseInt(
                    highlightStart <= highlightEnd
                      ? highlightStart
                      : highlightEnd,
                  ) * 1000,
                ),
                new Date(
                  Number.parseInt(
                    highlightEnd >= highlightStart
                      ? highlightEnd
                      : highlightStart,
                  ) * 1000,
                ),
              );
            } catch (e) {
              console.error('failed to highlight range', e);
            }
            setHighlightStart(undefined);
            setHighlightEnd(undefined);
          }
        }}
        onClick={(state, e) => {
          if (
            state != null &&
            state.chartX != null &&
            state.chartY != null &&
            state.activeLabel != null &&
            // If we didn't drag and highlight yet
            highlightStart == null
          ) {
            setIsClickActive({
              x: state.chartX,
              y: state.chartY,
              activeLabel: state.activeLabel,
              xPerc: state.chartX / sizeRef.current[0],
              yPerc: state.chartY / sizeRef.current[1],
            });
          } else {
            // We clicked on the chart but outside of a line
            setIsClickActive(undefined);
          }

          // TODO: Properly detect clicks outside of the fake tooltip
          e.stopPropagation();
        }}
      >
        <defs>
          {COLORS.map(c => {
            return (
              <linearGradient
                key={c}
                id={`time-chart-lin-grad-${id}-${c.replace('#', '').toLowerCase()}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={c} stopOpacity={0.15} />
                <stop offset="10%" stopColor={c} stopOpacity={0.003} />
              </linearGradient>
            );
          })}
        </defs>
        {isHovered && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--mantine-color-dark-6)"
          />
        )}
        <XAxis
          dataKey={timestampKey ?? 'ts_bucket'}
          domain={[
            dateRange[0].getTime() / 1000,
            dateRange[1].getTime() / 1000,
          ]}
          interval="preserveStartEnd"
          scale="time"
          type="number"
          tickFormatter={xTickFormatter}
          minTickGap={100}
          tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <YAxis
          width={40}
          minTickGap={25}
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        {lines}
        <Tooltip
          content={<HDXLineChartTooltip numberFormat={numberFormat} />}
          wrapperStyle={{
            zIndex: 1,
          }}
          allowEscapeViewBox={{ y: true }}
        />
        {referenceLines}
        {highlightStart && highlightEnd ? (
          <ReferenceArea
            // yAxisId="1"
            x1={highlightStart}
            x2={highlightEnd}
            strokeOpacity={0.3}
          />
        ) : null}
        {showLegend && (
          <Legend
            iconSize={10}
            verticalAlign="bottom"
            content={<LegendRenderer />}
            offset={-100}
          />
        )}
        {/** Needs to be at the bottom to prevent re-rendering */}
        {isClickActive != null ? (
          <ReferenceLine x={isClickActive.activeLabel} stroke="#ccc" />
        ) : null}
        {logReferenceTimestamp != null ? (
          <ReferenceLine
            x={logReferenceTimestamp}
            stroke="#ff5d5b"
            strokeDasharray="3 3"
            label="Event"
          />
        ) : null}
      </ChartComponent>
    </ResponsiveContainer>
  );
});
