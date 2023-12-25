import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { add, format } from 'date-fns';
import pick from 'lodash/pick';
import {
  Bar,
  BarChart,
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

import api from './api';
import { AggFn, convertGranularityToSeconds, Granularity } from './ChartUtils';
import type { NumberFormat } from './types';
import useUserPreferences, { TimeFormat } from './useUserPreferences';
import { formatNumber } from './utils';
import { semanticKeyedColor, TIME_TOKENS, truncateMiddle } from './utils';

function ExpandableLegendItem({ value, entry }: any) {
  const [expanded, setExpanded] = useState(false);
  const { color } = entry;

  return (
    <span>
      <span
        style={{ color }}
        role="button"
        onClick={() => setExpanded(v => !v)}
        title="Click to expand"
      >
        {expanded ? value : truncateMiddle(`${value}`, 45)}
      </span>
    </span>
  );
}

const legendFormatter = (value: string, entry: any) => (
  <ExpandableLegendItem value={value} entry={entry} />
);

const MemoChart = memo(function MemoChart({
  graphResults,
  setIsClickActive,
  isClickActive,
  dateRange,
  groupKeys,
  alertThreshold,
  alertThresholdType,
  displayType = 'line',
  numberFormat,
}: {
  graphResults: any[];
  setIsClickActive: (v: any) => void;
  isClickActive: any;
  dateRange: [Date, Date];
  groupKeys: string[];
  alertThreshold?: number;
  alertThresholdType?: 'above' | 'below';
  displayType?: 'stacked_bar' | 'line';
  numberFormat?: NumberFormat;
}) {
  const ChartComponent = displayType === 'stacked_bar' ? BarChart : LineChart;

  const lines = useMemo(() => {
    return groupKeys.map(key =>
      displayType === 'stacked_bar' ? (
        <Bar
          key={key}
          type="monotone"
          dataKey={key}
          fill={semanticKeyedColor(key)}
          stackId="1"
        />
      ) : (
        <Line
          key={key}
          type="monotone"
          dataKey={key}
          stroke={semanticKeyedColor(key)}
          dot={false}
        />
      ),
    );
  }, [groupKeys, displayType]);

  const sizeRef = useRef<[number, number]>([0, 0]);
  const timeFormat: TimeFormat = useUserPreferences().timeFormat;
  const tsFormat = TIME_TOKENS[timeFormat];
  // Gets the preffered time format from User Preferences, then converts it to a formattable token

  const tickFormatter = useCallback(
    (value: number) =>
      numberFormat
        ? formatNumber(value, {
            ...numberFormat,
            average: true,
            mantissa: 0,
            unit: undefined,
          })
        : new Intl.NumberFormat('en-US', {
            notation: 'compact',
            compactDisplay: 'short',
          }).format(value),
    [numberFormat],
  );

  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      onResize={(width, height) => {
        sizeRef.current = [width ?? 1, height ?? 1];
      }}
    >
      <ChartComponent
        width={500}
        height={300}
        data={graphResults}
        syncId="hdx"
        syncMethod="value"
        onClick={(state, e) => {
          if (
            state != null &&
            state.chartX != null &&
            state.chartY != null &&
            state.activeLabel != null
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
        <XAxis
          dataKey={'ts_bucket'}
          domain={[
            dateRange[0].getTime() / 1000,
            dateRange[1].getTime() / 1000,
          ]}
          interval="preserveStartEnd"
          scale="time"
          type="number"
          tickFormatter={tick => format(new Date(tick * 1000), tsFormat)}
          minTickGap={50}
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <YAxis
          width={40}
          minTickGap={25}
          tickFormatter={tickFormatter}
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        {lines}
        <Tooltip
          content={<HDXLineChartTooltip numberFormat={numberFormat} />}
        />
        {alertThreshold != null && alertThresholdType === 'below' && (
          <ReferenceArea
            y1={0}
            y2={alertThreshold}
            ifOverflow="extendDomain"
            strokeWidth={0}
            fillOpacity={0.05}
          />
        )}
        {alertThreshold != null && alertThresholdType === 'above' && (
          <ReferenceArea
            y1={alertThreshold}
            ifOverflow="extendDomain"
            strokeWidth={0}
            fillOpacity={0.05}
          />
        )}
        {alertThreshold != null && (
          <ReferenceLine
            y={alertThreshold}
            label={<Label value="Alert Threshold" fill={'white'} />}
            stroke="red"
            strokeDasharray="3 3"
          />
        )}
        <Legend
          iconSize={10}
          verticalAlign="bottom"
          formatter={legendFormatter}
        />
        {/** Needs to be at the bottom to prevent re-rendering */}
        {isClickActive != null ? (
          <ReferenceLine x={isClickActive.activeLabel} stroke="#ccc" />
        ) : null}
      </ChartComponent>
    </ResponsiveContainer>
  );
});

const HDXLineChartTooltip = (props: any) => {
  const timeFormat: TimeFormat = useUserPreferences().timeFormat;
  const tsFormat = TIME_TOKENS[timeFormat];
  const { active, payload, label, numberFormat } = props;
  if (active && payload && payload.length) {
    return (
      <div className="bg-grey px-3 py-2 rounded fs-8">
        <div className="mb-2">{format(new Date(label * 1000), tsFormat)}</div>
        {payload
          .sort((a: any, b: any) => b.value - a.value)
          .map((p: any) => (
            <div key={p.name} style={{ color: p.color }}>
              {p.dataKey}:{' '}
              {numberFormat ? formatNumber(p.value, numberFormat) : p.value}
            </div>
          ))}
      </div>
    );
  }
  return null;
};
const HDXLineChart = memo(
  ({
    config: {
      table,
      aggFn,
      field,
      where,
      groupBy,
      granularity,
      dateRange,
      numberFormat,
    },
    onSettled,
    alertThreshold,
    alertThresholdType,
  }: {
    config: {
      table: string;
      aggFn: AggFn;
      field: string;
      where: string;
      groupBy: string;
      granularity: Granularity;
      dateRange: [Date, Date];
      numberFormat?: NumberFormat;
    };
    onSettled?: () => void;
    alertThreshold?: number;
    alertThresholdType?: 'above' | 'below';
  }) => {
    const { data, isError, isLoading } =
      table === 'logs'
        ? api.useLogsChart(
            {
              aggFn,
              endDate: dateRange[1] ?? new Date(),
              field,
              granularity,
              groupBy,
              q: where,
              startDate: dateRange[0] ?? new Date(),
            },
            {
              enabled:
                aggFn === 'count' ||
                (typeof field === 'string' && field.length > 0),
              onSettled,
            },
          )
        : api.useMetricsChart(
            {
              aggFn,
              endDate: dateRange[1] ?? new Date(),
              granularity,
              groupBy,
              name: field,
              q: where,
              startDate: dateRange[0] ?? new Date(),
            },
            {
              onSettled,
            },
          );

    const tsBucketMap = new Map();
    let graphResults: {
      ts_bucket: number;
      [key: string]: number | undefined;
    }[] = [];
    let groupKeys: string[] = [];
    const groupKeySet = new Set<string>();
    const groupKeyMax = new Map<string, number>();
    let totalGroups = 0;
    if (data != null) {
      for (const row of data.data) {
        const key = row.group;
        const value = Number.parseFloat(row.data);

        // Keep track of the max value we've seen for this key so far
        // we'll pick the top N to display later
        groupKeyMax.set(key, Math.max(groupKeyMax.get(key) ?? 0, value));

        const tsBucket = tsBucketMap.get(row.ts_bucket) ?? {};
        groupKeySet.add(key);
        tsBucketMap.set(row.ts_bucket, {
          ...tsBucket,
          ts_bucket: row.ts_bucket,
          [key]: value, // CH can return strings for UInt64
        });
      }

      // get top N keys from groupKeyMax
      const topN = 20;
      const topNKeys = Array.from(groupKeyMax.entries())
        .filter(([groupKey]) => groupKey !== '') // filter out zero padding key
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([k]) => k);

      totalGroups = groupKeyMax.size - 1; // subtract zero padding key from total

      graphResults = Array.from(tsBucketMap.values())
        .sort((a, b) => a.ts_bucket - b.ts_bucket)
        .map(v => {
          const defaultValues = Object.fromEntries(
            topNKeys.map(k => [k, aggFn === 'count' ? 0 : undefined]), // fill in undefined for missing value
          ) as { [key: string]: number | undefined };
          return {
            ...defaultValues,
            ...(pick(v, ['ts_bucket', ...topNKeys]) as {
              ts_bucket: number;
              [key: string]: number;
            }),
          };
        });
      groupKeys = topNKeys;
    }

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
      qparams = new URLSearchParams({
        q:
          where +
          (aggFn !== 'count' ? ` ${field}:*` : '') +
          (groupBy != null && groupBy != '' ? ` ${groupBy}:*` : ''),
        from: `${clickedActiveLabelDate?.getTime()}`,
        to: `${to.getTime()}`,
      });
    }

    const [displayType, setDisplayType] = useState<'stacked_bar' | 'line'>(
      'line',
    );

    return isLoading ? (
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
              <Link href={`/search?${qparams?.toString()}`}>
                <a className="text-white-hover text-decoration-none">
                  <i className="bi bi-search"></i> View Events
                </a>
              </Link>
            </div>
          ) : null}
          {totalGroups > groupKeys.length ? (
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
          ) : null}
          <div
            className="bg-grey px-3 py-2 rounded fs-8"
            style={{
              zIndex: 5,
              position: 'absolute',
              top: 0,
              right: 0,
              visibility: 'visible',
            }}
            title={`Only the top ${groupKeys.length} groups are shown, ${
              totalGroups - groupKeys.length
            } groups are hidden. Try grouping by a different field.`}
          >
            <span
              className={cx('text-decoration-none fs-7 cursor-pointer me-2', {
                'text-success': displayType === 'line',
                'text-muted-hover': displayType !== 'line',
              })}
              role="button"
              title="Display as line chart"
              onClick={() => setDisplayType('line')}
            >
              <i className="bi bi-graph-up"></i>
            </span>
            <span
              className={cx('text-decoration-none fs-7 cursor-pointer', {
                'text-success': displayType === 'stacked_bar',
                'text-muted-hover': displayType !== 'stacked_bar',
              })}
              role="button"
              title="Display as bar chart"
              onClick={() => setDisplayType('stacked_bar')}
            >
              <i className="bi bi-bar-chart"></i>
            </span>
          </div>
          <MemoChart
            graphResults={graphResults}
            groupKeys={groupKeys}
            isClickActive={activeClickPayload}
            setIsClickActive={setActiveClickPayload}
            dateRange={dateRange}
            alertThreshold={alertThreshold}
            alertThresholdType={alertThresholdType}
            displayType={displayType}
            numberFormat={numberFormat}
          />
        </div>
      </div>
    );
  },
);

export default HDXLineChart;
