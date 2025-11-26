import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  BarProps,
  CartesianGrid,
  Legend,
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
import { IconCaretDownFilled, IconCaretUpFilled } from '@tabler/icons-react';

import type { NumberFormat } from '@/types';
import { COLORS, formatNumber, truncateMiddle } from '@/utils';

import { LineData } from './ChartUtils';
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

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
});

const calculatePercentChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current === 0 ? 0 : undefined;
  }
  return (current - previous) / previous;
};

const PercentChange = ({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) => {
  const percentChange = calculatePercentChange(current, previous);
  if (percentChange == undefined) {
    return null;
  }

  const Icon = percentChange > 0 ? IconCaretUpFilled : IconCaretDownFilled;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
      (<Icon size={12} />
      {percentFormatter.format(Math.abs(percentChange))})
    </span>
  );
};

export const TooltipItem = memo(
  ({
    p,
    previous,
    numberFormat,
  }: {
    p: TooltipPayload;
    previous?: TooltipPayload;
    numberFormat?: NumberFormat;
  }) => {
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
          : {numberFormat ? formatNumber(p.value, numberFormat) : p.value}{' '}
          {previous && (
            <PercentChange current={p.value} previous={previous?.value} />
          )}
        </div>
      </div>
    );
  },
);

type HDXLineChartTooltipProps = {
  lineDataMap: { [keyName: string]: LineData };
  previousPeriodOffset?: number;
  numberFormat?: NumberFormat;
} & Record<string, any>;

const HDXLineChartTooltip = withErrorBoundary(
  memo((props: HDXLineChartTooltipProps) => {
    const {
      active,
      payload,
      label,
      numberFormat,
      lineDataMap,
      previousPeriodOffset,
    } = props;
    const typedPayload = payload as TooltipPayload[];

    const payloadByKey = useMemo(
      () => new Map(typedPayload.map(p => [p.dataKey, p])),
      [typedPayload],
    );

    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <div className={styles.chartTooltipHeader}>
            <FormatTime value={label * 1000} />
            {previousPeriodOffset != null && (
              <>
                {' (vs '}
                <FormatTime value={label * 1000 - previousPeriodOffset} />
                {')'}
              </>
            )}
          </div>
          <div className={styles.chartTooltipContent}>
            {payload
              .sort((a: TooltipPayload, b: TooltipPayload) => b.value - a.value)
              .map((p: TooltipPayload) => {
                const previousKey = lineDataMap[p.dataKey]?.previousPeriodKey;
                const isPreviousPeriod = previousKey === p.dataKey;
                const previousPayload =
                  !isPreviousPeriod && previousKey
                    ? payloadByKey.get(previousKey)
                    : undefined;

                return (
                  <TooltipItem
                    key={p.dataKey}
                    p={p}
                    numberFormat={numberFormat}
                    previous={previousPayload}
                  />
                );
              })}
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
    dataKey: string;
    value: string;
    color: string;
  }[];
  lineDataMap: { [key: string]: LineData };
}>(props => {
  const { payload = [], lineDataMap } = props;

  const sortedLegendItems = useMemo(() => {
    // Order items such that current and previous period lines are consecutive
    const currentPeriodKeyIndex = new Map<string, number>();
    payload.forEach((line, index) => {
      const currentPeriodKey =
        lineDataMap[line.dataKey]?.currentPeriodKey || '';
      if (!currentPeriodKeyIndex.has(currentPeriodKey)) {
        currentPeriodKeyIndex.set(currentPeriodKey, index);
      }
    });

    return payload.sort((a, b) => {
      const keyA = lineDataMap[a.dataKey]?.currentPeriodKey ?? '';
      const keyB = lineDataMap[b.dataKey]?.currentPeriodKey ?? '';

      const indexA = currentPeriodKeyIndex.get(keyA) ?? 0;
      const indexB = currentPeriodKeyIndex.get(keyB) ?? 0;

      return indexB - indexA || a.dataKey.localeCompare(b.dataKey);
    });
  }, [payload, lineDataMap]);

  const shownItems = sortedLegendItems.slice(0, MAX_LEGEND_ITEMS);
  const restItems = sortedLegendItems.slice(MAX_LEGEND_ITEMS);

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
  lineData,
  referenceLines,
  logReferenceTimestamp,
  displayType = DisplayType.Line,
  numberFormat,
  isLoading,
  timestampKey = 'ts_bucket',
  onTimeRangeSelect,
  showLegend = true,
  previousPeriodOffset,
}: {
  graphResults: any[];
  setIsClickActive: (v: any) => void;
  isClickActive: any;
  dateRange: [Date, Date] | Readonly<[Date, Date]>;
  lineData: LineData[];
  referenceLines?: React.ReactNode;
  displayType?: DisplayType;
  numberFormat?: NumberFormat;
  logReferenceTimestamp?: number;
  isLoading?: boolean;
  timestampKey?: string;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  showLegend?: boolean;
  previousPeriodOffset?: number;
}) {
  const _id = useId();
  const id = _id.replace(/:/g, '');

  const [isHovered, setIsHovered] = useState(false);

  const ChartComponent =
    displayType === DisplayType.StackedBar ? BarChart : AreaChart; // LineChart;

  const lines = useMemo(() => {
    const limitedGroupKeys = lineData
      .map(ld => ld.dataKey)
      .slice(0, HARD_LINES_LIMIT);

    return limitedGroupKeys.map((key, i) => {
      const color = lineData[i]?.color;
      const strokeDasharray = lineData[i]?.isDashed ? '4 3' : '0';

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
          name={lineData[i]?.displayName ?? key}
          fill={color}
          opacity={1}
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
            ? { fill: 'none', strokeDasharray }
            : {
                fill: `url(#time-chart-lin-grad-${id}-${color.replace('#', '').toLowerCase()})`,
                strokeDasharray,
              })}
          name={lineData[i]?.displayName ?? key}
          isAnimationActive={false}
        />
      );
    });
  }, [lineData, displayType, id, isHovered]);

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
  const mouseDownPosRef = useRef<number | null>(null);

  const lineDataMap = useMemo(() => {
    const map: { [key: string]: LineData } = {};
    lineData.forEach(ld => {
      map[ld.dataKey] = ld;
    });
    return map;
  }, [lineData]);

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
          mouseDownPosRef.current = null;
        }}
        onMouseDown={e => {
          if (e != null && e.chartX != null && e.chartY != null) {
            setHighlightStart(e.activeLabel);
            mouseDownPosRef.current = e.chartX;
          }
        }}
        onMouseMove={e => {
          setIsHovered(true);

          if (highlightStart != null) {
            setHighlightEnd(e.activeLabel);
            setIsClickActive(undefined); // Clear out any click state as we're highlighting
          }
        }}
        onMouseUp={e => {
          const MIN_DRAG_DISTANCE = 20; // Minimum horizontal drag distance in pixels
          let dragDistance = 0;

          if (mouseDownPosRef.current != null && e?.chartX != null) {
            dragDistance = Math.abs(e.chartX - mouseDownPosRef.current);
          }

          if (e?.activeLabel != null && highlightStart === e.activeLabel) {
            // If it's just a click, don't zoom
            setHighlightStart(undefined);
            setHighlightEnd(undefined);
            mouseDownPosRef.current = null;
          } else if (
            highlightStart != null &&
            highlightEnd != null &&
            dragDistance >= MIN_DRAG_DISTANCE
          ) {
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
            mouseDownPosRef.current = null;
          } else {
            // Drag was too short, clear the highlight
            setHighlightStart(undefined);
            setHighlightEnd(undefined);
            mouseDownPosRef.current = null;
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
              activePayload: state.activePayload,
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
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
        {isClickActive == null && (
          <Tooltip
            content={
              <HDXLineChartTooltip
                numberFormat={numberFormat}
                lineDataMap={lineDataMap}
                previousPeriodOffset={previousPeriodOffset}
              />
            }
            wrapperStyle={{
              zIndex: 400,
            }}
            allowEscapeViewBox={{ y: true }}
          />
        )}
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
            content={<LegendRenderer lineDataMap={lineDataMap} />}
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
