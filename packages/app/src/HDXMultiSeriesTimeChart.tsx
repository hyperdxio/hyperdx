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

import { useMultiSeriesChartV2 } from '@/api';
import {
  convertGranularityToSeconds,
  Granularity,
  seriesColumns,
  seriesToUrlSearchQueryParam,
} from '@/ChartUtils';
import type { ChartSeries, NumberFormat } from '@/types';
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
            zIndex: 1000,
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

const HDXMultiSeriesTimeChart = memo(
  ({
    config: {
      series,
      granularity,
      dateRange,
      seriesReturnType = 'column',
      displayType: displayTypeProp = DisplayType.Line,
    },
    onSettled,
    referenceLines,
    showDisplaySwitcher = true,
    setDisplayType,
    logReferenceTimestamp,
  }: {
    config: {
      series: ChartSeries[];
      granularity: Granularity;
      dateRange: [Date, Date] | Readonly<[Date, Date]>;
      seriesReturnType: 'ratio' | 'column';
      displayType?: DisplayType;
    };
    onSettled?: () => void;
    referenceLines?: React.ReactNode;
    showDisplaySwitcher?: boolean;
    setDisplayType?: (type: DisplayType) => void;
    logReferenceTimestamp?: number;
  }) => {
    const { data, isError, isLoading } = useMultiSeriesChartV2(
      {
        series,
        granularity,
        endDate: dateRange[1] ?? new Date(),
        startDate: dateRange[0] ?? new Date(),
        seriesReturnType,
      },
      {
        enabled:
          series.length > 0 &&
          series[0].type === 'time' &&
          series[0].table === 'metrics' &&
          series[0].field == null
            ? false
            : true,
      },
    );

    const tsBucketMap = new Map();
    let graphResults: {
      ts_bucket: number;
      [key: string]: number | undefined;
    }[] = [];

    // TODO: FIX THIS COUNTER
    let totalGroups = 0;
    const groupSet = new Set(); // to count how many unique groups there were

    const lineDataMap: {
      [seriesGroup: string]: {
        dataKey: string;
        displayName: string;
        color?: string;
      };
    } = {};

    const seriesMeta = seriesColumns({
      series,
      seriesReturnType,
    });

    // Each row of data will contain the ts_bucket, group name
    // and a data value per series, we just need to turn them all into keys
    if (data != null) {
      for (const row of data.data) {
        groupSet.add(`${row.group}`);

        const tsBucket = tsBucketMap.get(row.ts_bucket) ?? {};
        tsBucketMap.set(row.ts_bucket, {
          ...tsBucket,
          ts_bucket: row.ts_bucket,
          ...seriesMeta.reduce((acc, meta, i) => {
            // We set an arbitrary data key that is unique
            // per series/group
            const dataKey = `series_${i}.data:::${row.group}`;

            const hasGroup = Array.isArray(row.group) && row.group.length > 0;

            const displayName =
              series.length === 1
                ? // If there's only one series, just show the group, unless there is no group
                  hasGroup
                  ? `${row.group}`
                  : meta.displayName
                : // Otherwise, show the series and a group if there is any
                  `${hasGroup ? `${row.group} • ` : ''}${meta.displayName}`;

            const color = meta.color;

            acc[dataKey] = row[meta.dataKey];
            lineDataMap[dataKey] = {
              dataKey,
              displayName,
              color,
            };
            return acc;
          }, {} as any),
        });
      }
      graphResults = Array.from(tsBucketMap.values()).sort(
        (a, b) => a.ts_bucket - b.ts_bucket,
      );
      totalGroups = groupSet.size;
    }

    const groupKeys = Object.values(lineDataMap).map(s => s.dataKey);
    const lineNames = Object.values(lineDataMap).map(s => s.displayName);
    const lineColors = Object.values(lineDataMap).map(s => s.color);

    const [activeClickPayload, setActiveClickPayload] = useState<
      | {
          x: number;
          y: number;
          activeLabel: string;
          xPerc: number;
          yPerc: number;
        }
      | undefined
    >(undefined);

    useEffect(() => {
      const onClickHandler = () => {
        if (activeClickPayload) {
          setActiveClickPayload(undefined);
        }
      };
      document.addEventListener('click', onClickHandler);
      return () => document.removeEventListener('click', onClickHandler);
    }, [activeClickPayload]);

    const clickedActiveLabelDate =
      activeClickPayload?.activeLabel != null
        ? new Date(Number.parseInt(activeClickPayload.activeLabel) * 1000)
        : undefined;

    let qparams: URLSearchParams | undefined;

    if (clickedActiveLabelDate != null) {
      const to = add(clickedActiveLabelDate, {
        seconds: convertGranularityToSeconds(granularity),
      });
      qparams = seriesToUrlSearchQueryParam({
        series,
        dateRange: [clickedActiveLabelDate, to],
      });
    }

    const numberFormat =
      series[0].type === 'time' ? series[0]?.numberFormat : undefined;

    // To enable backward compatibility, allow non-controlled usage of displayType
    const [displayTypeLocal, setDisplayTypeLocal] = useState(displayTypeProp);

    const displayType = useMemo(() => {
      if (setDisplayType) {
        return displayTypeProp;
      } else {
        return displayTypeLocal;
      }
    }, [displayTypeLocal, displayTypeProp, setDisplayType]);

    const handleSetDisplayType = (type: DisplayType) => {
      if (setDisplayType) {
        setDisplayType(type);
      } else {
        setDisplayTypeLocal(type);
      }
    };

    return isLoading && !data ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : graphResults.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <div
        // Hack, recharts will release real fix soon https://github.com/recharts/recharts/issues/172
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          flexGrow: 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            top: 0,
          }}
        >
          {activeClickPayload != null && clickedActiveLabelDate != null ? (
            <div
              className="bg-grey px-3 py-2 rounded fs-8"
              style={{
                zIndex: 5,
                position: 'absolute',
                top: 0,
                left: 0,
                visibility: 'visible',
                transform: `translate(${
                  activeClickPayload.xPerc > 0.5
                    ? (activeClickPayload?.x ?? 0) - 130
                    : (activeClickPayload?.x ?? 0) + 4
                }px, ${activeClickPayload?.y ?? 0}px)`,
              }}
            >
              <Link
                href={`/search?${qparams?.toString()}`}
                className="text-white-hover text-decoration-none"
              >
                <i className="bi bi-search me-1"></i> View Events
              </Link>
            </div>
          ) : null}
          {/* {totalGroups > groupKeys.length ? (
            <div
              className="bg-grey px-3 py-2 rounded fs-8"
              style={{
                zIndex: 5,
                position: 'absolute',
                top: 0,
                left: 50,
                visibility: 'visible',
              }}
              title={`Only the top ${groupKeys.length} groups are shown, ${
                totalGroups - groupKeys.length
              } groups are hidden. Try grouping by a different field.`}
            >
              <span className="text-muted-hover text-decoration-none fs-8">
                <i className="bi bi-exclamation-triangle"></i> Only top{' '}
                {groupKeys.length} groups shown
              </span>
            </div>
            ) : null*/}
          {showDisplaySwitcher && (
            <div
              className="bg-grey px-3 py-2 rounded fs-8"
              style={{
                zIndex: 5,
                position: 'absolute',
                top: 0,
                right: 0,
                visibility: 'visible',
              }}
            >
              <span
                className={cx('text-decoration-none fs-7 cursor-pointer me-2', {
                  'text-success': displayType === 'line',
                  'text-muted-hover': displayType !== 'line',
                })}
                role="button"
                title="Display as line chart"
                onClick={() => handleSetDisplayType(DisplayType.Line)}
              >
                <i className="bi bi-graph-up"></i>
              </span>
              <span
                className={cx('text-decoration-none fs-7 cursor-pointer', {
                  'text-success': displayType === DisplayType.StackedBar,
                  'text-muted-hover': displayType !== DisplayType.StackedBar,
                })}
                role="button"
                title="Display as bar chart"
                onClick={() => handleSetDisplayType(DisplayType.StackedBar)}
              >
                <i className="bi bi-bar-chart"></i>
              </span>
            </div>
          )}
          <MemoChart
            isLoading={isLoading}
            lineNames={lineNames}
            lineColors={lineColors}
            graphResults={graphResults}
            groupKeys={groupKeys}
            isClickActive={activeClickPayload}
            setIsClickActive={setActiveClickPayload}
            dateRange={dateRange}
            displayType={displayType}
            numberFormat={numberFormat}
            logReferenceTimestamp={logReferenceTimestamp}
            referenceLines={referenceLines}
          />
        </div>
      </div>
    );
  },
);

export default HDXMultiSeriesTimeChart;
