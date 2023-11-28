import Link from 'next/link';
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { CategoricalChartState } from 'recharts/types/chart/generateCategoricalChart';
import { memo, useCallback, useMemo, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import api from './api';
import { generateSearchUrl } from './utils';

const MemoChart = memo(function MemoChart({
  graphResults,
  generateSearchUrl,
}: {
  graphResults: any[];
  generateSearchUrl: (lower: string, upper: string) => string;
}) {
  const data = useMemo(() => {
    return (
      graphResults?.map((result: any) => {
        return {
          lower: result[0],
          upper: result[1],
          height: result[2],
        };
      }) ?? []
    );
  }, [graphResults]);

  const barChartRef = useRef<any>();
  const activeBar = useRef<CategoricalChartState>();

  useHotkeys(['esc'], () => {
    activeBar.current = undefined;
  });

  // Complete hack
  // See: https://github.com/recharts/recharts/issues/1231#issuecomment-1237958802
  const setChartActive = (payload: {
    activeCoordinate?: { x: number; y: number };
    activeLabel: any;
    activePayload?: any[];
  }) => {
    if (barChartRef.current == null) return;

    if (activeBar.current == null) {
      // @ts-ignore
      return barChartRef.current.setState({
        isTooltipActive: false,
      });
    }

    // @ts-ignore
    barChartRef.current.setState({
      isTooltipActive: true,
      activeCoordinate: payload.activeCoordinate,
      activeLabel: payload.activeLabel,
      activePayload: payload.activePayload,
    });
  };

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart
        width={500}
        height={300}
        data={data}
        className="user-select-none cursor-crosshair"
        ref={barChartRef}
        onMouseMove={() => {
          if (activeBar.current == null) return;

          setChartActive({
            activeCoordinate: activeBar.current.activeCoordinate,
            activeLabel: activeBar.current.activeLabel,
            activePayload: activeBar.current.activePayload,
          });
        }}
        onMouseLeave={() => {
          activeBar.current = undefined;
        }}
        onClick={click => {
          activeBar.current = click;

          if (click != null) {
            setChartActive({
              activeCoordinate: activeBar.current.activeCoordinate,
              activeLabel: activeBar.current.activeLabel,
              activePayload: activeBar.current.activePayload,
            });
          }
        }}
      >
        <XAxis
          dataKey={'lower'}
          domain={
            data.length > 1
              ? [data[0].lower, data[data.length - 1].upper]
              : undefined
          }
          interval="preserveStartEnd"
          type="category"
          tickFormatter={(value: number) =>
            new Intl.NumberFormat('en-US', {
              notation: 'compact',
              compactDisplay: 'short',
            }).format(value)
          }
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <YAxis
          width={35}
          minTickGap={25}
          tickFormatter={(value: number) =>
            new Intl.NumberFormat('en-US', {
              notation: 'compact',
              compactDisplay: 'short',
            }).format(value)
          }
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip
          content={
            <HDXHistogramChartTooltip generateSearchUrl={generateSearchUrl} />
          }
          active
        />
        <Bar dataKey="height" stackId="a" fill="#50FA7B" />
      </BarChart>
    </ResponsiveContainer>
  );
});

const HDXHistogramChartTooltip = (props: any) => {
  const { active, payload, generateSearchUrl } = props;
  if (active && payload && payload.length > 0) {
    const bucket = props.payload[0].payload;

    const lower = bucket.lower.toFixed(5);
    const upper = bucket.upper.toFixed(5);

    return (
      <div
        className="bg-grey px-3 py-2 rounded fs-8"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="mb-2">
          Bucket: {lower} - {upper}
        </div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.color }}>
            Number of Events: {p.value}
          </div>
        ))}
        <div className="mt-2">
          <Link href={generateSearchUrl(lower, upper)}>
            <a
              className="text-muted-hover cursor-pointer"
              onClick={e => e.stopPropagation()}
            >
              View Events
            </a>
          </Link>
        </div>
        <div className="text-muted fs-9 mt-2">
          Click to Pin Tooltip • Approx value via SPDT algorithm
        </div>
      </div>
    );
  }
  return null;
};
const HDXHistogramChart = memo(
  ({
    config: { table, field, where, dateRange },
    onSettled,
  }: {
    config: {
      table: string;
      field: string;
      where: string;
      dateRange: [Date, Date];
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } = api.useLogsChartHistogram(
      {
        endDate: dateRange[1] ?? new Date(),
        field,
        q: where,
        startDate: dateRange[0] ?? new Date(),
      },
      {
        enabled:
          dateRange[0] != null &&
          dateRange[1] != null &&
          typeof field === 'string' &&
          field.length > 0,
        onSettled,
      },
    );

    const genSearchUrl = useCallback(
      (lower: string, upper: string) => {
        return generateSearchUrl({
          query: `${where} ${field}:[${lower} TO ${upper}]`.trim(),
          dateRange,
        });
      },
      [where, field, dateRange],
    );

    // Don't ask me why...
    const buckets = data?.data?.[0]?.data;

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : buckets?.length === 0 ? (
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
          <MemoChart graphResults={buckets} generateSearchUrl={genSearchUrl} />
        </div>
      </div>
    );
  },
);

export default HDXHistogramChart;
