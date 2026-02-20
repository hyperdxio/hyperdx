import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { add, isSameSecond, sub } from 'date-fns';
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
import { AxisDomain } from 'recharts/types/util/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Popover } from '@mantine/core';

import type { NumberFormat } from '@/types';
import { COLORS, formatNumber, truncateMiddle } from '@/utils';

import {
  ChartTooltipContainer,
  ChartTooltipItem,
} from './components/charts/ChartTooltip';
import {
  convertGranularityToSeconds,
  LineData,
  toStartOfInterval,
} from './ChartUtils';
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
      <ChartTooltipItem
        color={p.color ?? ''}
        name={p.name ?? p.dataKey}
        value={p.value}
        numberFormat={numberFormat}
        indicator="line"
        strokeDasharray={p.strokeDasharray}
        opacity={p.opacity}
        previous={previous?.value}
      />
    );
  },
);

type HDXLineChartTooltipProps = {
  lineDataMap: { [keyName: string]: LineData };
  previousPeriodOffsetSeconds?: number;
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
      previousPeriodOffsetSeconds,
    } = props;
    const typedPayload = payload as TooltipPayload[];

    const payloadByKey = useMemo(
      () => new Map(typedPayload.map(p => [p.dataKey, p])),
      [typedPayload],
    );

    if (active && payload && payload.length) {
      const header = (
        <>
          <FormatTime value={label * 1000} />
          {previousPeriodOffsetSeconds != null && (
            <>
              {' (vs '}
              <FormatTime
                value={(label - previousPeriodOffsetSeconds) * 1000}
              />
              {')'}
            </>
          )}
        </>
      );
      return (
        <ChartTooltipContainer header={header}>
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
        </ChartTooltipContainer>
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

function ExpandableLegendItem({
  entry,
  expanded,
  isSelected,
  isDisabled,
  onToggle,
}: {
  entry: any;
  expanded?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  onToggle?: (isShiftKey: boolean) => void;
}) {
  const [_expanded, setExpanded] = useState(false);
  const isExpanded = _expanded || expanded;

  return (
    <span
      className={`d-flex gap-1 items-center justify-center ${styles.legendItem}`}
      style={{
        color: entry.color,
        opacity: isDisabled ? 0.3 : 1,
        fontWeight: isSelected ? 600 : 400,
        cursor: 'pointer',
      }}
      role="button"
      onClick={e => {
        if (onToggle) {
          onToggle(e.shiftKey);
        } else {
          setExpanded(v => !v);
        }
      }}
      title={
        isSelected
          ? 'Click to show all (Shift+click to deselect)'
          : 'Click to show only this (Shift+click for multi-select)'
      }
    >
      <div>
        <svg width="12" height="4">
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke={entry.color}
            opacity={isDisabled ? 0.3 : 1}
            strokeDasharray={entry.payload?.strokeDasharray}
            strokeWidth={isSelected ? 2.5 : 1.5}
          />
        </svg>
      </div>
      {isExpanded || isSelected
        ? entry.value
        : truncateMiddle(`${entry.value}`, 35)}
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
  allLineData?: LineData[];
  selectedSeries?: Set<string>;
  onToggleSeries?: (seriesName: string, isShiftKey?: boolean) => void;
}>(props => {
  const {
    payload = [],
    lineDataMap,
    allLineData = [],
    selectedSeries = new Set(),
    onToggleSeries,
  } = props;

  const hasSelection = selectedSeries.size > 0;

  // Use allLineData to ensure all series are always shown in legend
  const allSeriesPayload = useMemo(() => {
    if (allLineData.length > 0) {
      return allLineData.map(ld => ({
        dataKey: ld.dataKey,
        value: ld.displayName || ld.dataKey,
        color: ld.color,
        payload: { strokeDasharray: ld.isDashed ? '4 3' : '0' },
      }));
    }
    return payload;
  }, [allLineData, payload]);

  const sortedLegendItems = useMemo(() => {
    // Order items such that current and previous period lines are consecutive
    const currentPeriodKeyIndex = new Map<string, number>();
    allSeriesPayload.forEach((line, index) => {
      const currentPeriodKey =
        lineDataMap[line.dataKey]?.currentPeriodKey || '';
      if (!currentPeriodKeyIndex.has(currentPeriodKey)) {
        currentPeriodKeyIndex.set(currentPeriodKey, index);
      }
    });

    return allSeriesPayload.sort((a, b) => {
      const keyA = lineDataMap[a.dataKey]?.currentPeriodKey ?? '';
      const keyB = lineDataMap[b.dataKey]?.currentPeriodKey ?? '';

      const indexA = currentPeriodKeyIndex.get(keyA) ?? 0;
      const indexB = currentPeriodKeyIndex.get(keyB) ?? 0;

      return indexB - indexA || a.dataKey.localeCompare(b.dataKey);
    });
  }, [allSeriesPayload, lineDataMap]);

  const shownItems = sortedLegendItems.slice(0, MAX_LEGEND_ITEMS);
  const restItems = sortedLegendItems.slice(MAX_LEGEND_ITEMS);

  return (
    <div className={styles.legend}>
      {shownItems.map((entry, index) => {
        const isSelected = selectedSeries.has(entry.value);
        const isDisabled = hasSelection && !isSelected;
        return (
          <ExpandableLegendItem
            key={`item-${index}`}
            entry={entry}
            isSelected={isSelected}
            isDisabled={isDisabled}
            onToggle={isShiftKey => onToggleSeries?.(entry.value, isShiftKey)}
          />
        );
      })}
      {restItems.length ? (
        <Popover withinPortal withArrow closeOnEscape closeOnClickOutside>
          <Popover.Target>
            <div className={cx(styles.legendItem, styles.legendMoreLink)}>
              +{restItems.length} more
            </div>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <div className={styles.legendTooltipContent}>
              {restItems.map((entry, index) => {
                const isSelected = selectedSeries.has(entry.value);
                const isDisabled = hasSelection && !isSelected;
                return (
                  <ExpandableLegendItem
                    key={`item-${index}`}
                    entry={entry}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    onToggle={isShiftKey =>
                      onToggleSeries?.(entry.value, isShiftKey)
                    }
                  />
                );
              })}
            </div>
          </Popover.Dropdown>
        </Popover>
      ) : null}
    </div>
  );
});

export const HARD_LINES_LIMIT = 60;

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
  previousPeriodOffsetSeconds,
  selectedSeriesNames,
  onToggleSeries,
  granularity,
  dateRangeEndInclusive = true,
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
  previousPeriodOffsetSeconds?: number;
  selectedSeriesNames?: Set<string>;
  onToggleSeries?: (seriesName: string, isShiftKey?: boolean) => void;
  granularity: string;
  dateRangeEndInclusive?: boolean;
}) {
  const _id = useId();
  const id = _id.replace(/:/g, '');

  const [isHovered, setIsHovered] = useState(false);

  const ChartComponent =
    displayType === DisplayType.StackedBar ? BarChart : AreaChart; // LineChart;

  const lines = useMemo(() => {
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;

    const limitedGroupKeys = lineData
      .map(ld => ld.dataKey)
      .slice(0, HARD_LINES_LIMIT)
      .filter((key, i) => {
        const seriesName = lineData[i]?.displayName ?? key;
        // If there's a selection, only show selected series
        // If no selection, show all series
        return !hasSelection || selectedSeriesNames.has(seriesName);
      });

    return limitedGroupKeys.map(key => {
      const lineDataIndex = lineData.findIndex(ld => ld.dataKey === key);
      const color = lineData[lineDataIndex]?.color;
      const strokeDasharray = lineData[lineDataIndex]?.isDashed ? '4 3' : '0';
      const seriesName = lineData[lineDataIndex]?.displayName ?? key;

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
          name={seriesName}
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
                fill: `url(#time-chart-lin-grad-${id}-${color?.replace('#', '').toLowerCase()})`,
                strokeDasharray,
              })}
          name={seriesName}
          isAnimationActive={false}
          connectNulls
        />
      );
    });
  }, [lineData, displayType, id, isHovered, selectedSeriesNames]);

  const yAxisDomain: AxisDomain = useMemo(() => {
    const hasSelection = selectedSeriesNames && selectedSeriesNames.size > 0;

    if (!hasSelection) {
      // No selection, let Recharts auto-calculate based on all data
      return [0, 'auto'];
    }

    // When series are selected, calculate domain based only on visible series
    let minValue = Infinity;
    let maxValue = -Infinity;

    graphResults.forEach(dataPoint => {
      lineData.forEach(ld => {
        const seriesName = ld.displayName || ld.dataKey;
        // Only consider selected series
        if (selectedSeriesNames.has(seriesName)) {
          const value = dataPoint[ld.dataKey];
          if (typeof value === 'number' && !isNaN(value)) {
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
          }
        }
      });
    });

    // If we found valid values, return them with some padding
    if (minValue !== Infinity && maxValue !== -Infinity) {
      const padding = (maxValue - minValue) * 0.1; // 10% padding
      return [
        Math.max(0, minValue - padding), // Don't go below 0
        maxValue + padding,
      ];
    }

    return ['auto', 'auto'];
  }, [graphResults, lineData, selectedSeriesNames]);

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

  const xAxisDomain: AxisDomain = useMemo(() => {
    let startTime = toStartOfInterval(dateRange[0], granularity);
    let endTime = toStartOfInterval(dateRange[1], granularity);
    const endTimeIsBoundaryAligned = isSameSecond(dateRange[1], endTime);
    if (endTimeIsBoundaryAligned && !dateRangeEndInclusive) {
      endTime = sub(endTime, {
        seconds: convertGranularityToSeconds(granularity),
      });
    }

    // For bar charts, extend the domain in both directions by half a granularity unit
    // so that the full bar width is within the bounds of the chart
    if (displayType === DisplayType.StackedBar) {
      const halfGranularitySeconds =
        convertGranularityToSeconds(granularity) / 2;
      startTime = sub(startTime, { seconds: halfGranularitySeconds });
      endTime = add(endTime, { seconds: halfGranularitySeconds });
    }

    return [startTime.getTime() / 1000, endTime.getTime() / 1000];
  }, [dateRange, granularity, dateRangeEndInclusive, displayType]);

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
          domain={xAxisDomain}
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
          domain={yAxisDomain}
        />
        {lines}
        {isClickActive == null && (
          <Tooltip
            content={
              <HDXLineChartTooltip
                numberFormat={numberFormat}
                lineDataMap={lineDataMap}
                previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
              />
            }
            wrapperStyle={{
              zIndex: 1,
            }}
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
            content={
              <LegendRenderer
                lineDataMap={lineDataMap}
                allLineData={lineData}
                selectedSeries={selectedSeriesNames || new Set()}
                onToggleSeries={onToggleSeries}
              />
            }
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
