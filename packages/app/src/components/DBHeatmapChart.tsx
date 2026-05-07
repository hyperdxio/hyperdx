import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Plugin } from 'uplot';
import uPlot from 'uplot';
import UplotReact from 'uplot-react';
import {
  ClickHouseQueryError,
  inferTimestampColumn,
} from '@hyperdx/common-utils/dist/clickhouse';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Code,
  Divider,
  Flex,
  Group,
  Modal,
  Text,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useElementSize } from '@mantine/hooks';
import { IconArrowsDiagonal } from '@tabler/icons-react';

import { isAggregateFunction, timeBucketByGranularity } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { NumberFormat } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { formatDurationMsCompact, formatNumber } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import { SQLPreview } from './ChartSQLPreview';

type Mode2DataArray = [number[], number[], number[]];

/**
 * Drag-select bounds in data space: x in seconds (URL convention), y in
 * the y-axis's natural unit (NOT log-space; callers pass the actual value
 * users would expect to see, e.g. ms latency). yMin may be 0 when the
 * selection touched the bottom bucket; the renderer clamps to the chart's
 * visible y-axis floor.
 */
export type SelectionBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

/**
 * Reapply a persisted selection rectangle to a uPlot instance. Called on
 * chart create and whenever the bounds prop changes; uPlot's `u.select`
 * is owned by the chart, so it gets wiped on any chart recreation. We use
 * the URL-backed bounds as the source of truth and mirror them onto the
 * chart imperatively. fireHook=false avoids re-entering the setSelect hook.
 */
function applySelectionToChart(
  u: uPlot,
  bounds: SelectionBounds | null | undefined,
  scaleType: HeatmapScaleType,
) {
  // The clear path runs BEFORE the scale-not-populated guard below so a
  // null bounds always clears the rectangle, even on first paint when
  // u.scales.y is not yet populated. Keep this ordering when refactoring;
  // swapping it would suppress clears while scales are loading.
  if (bounds == null) {
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    return;
  }

  const { xMin, xMax, yMin, yMax } = bounds;

  // x is in seconds in the URL; uPlot's x-axis is configured ms:1 so
  // values are stored as ms.
  const xMinPx = u.valToPos(xMin * 1000, 'x');
  const xMaxPx = u.valToPos(xMax * 1000, 'x');

  const yScaleMin = u.scales.y?.min;
  const yScaleMax = u.scales.y?.max;
  if (yScaleMin == null || yScaleMax == null) {
    return;
  }

  // For log scale, y-axis values are stored in log-space. Convert and
  // clamp to the visible axis: yMin may be 0 (bottom-bucket adjustment in
  // HeatmapContainer's onFilter wrapper); yMax may exceed the axis.
  let yLowPlot: number;
  let yHighPlot: number;
  if (scaleType === 'log') {
    yHighPlot = yMax > 0 ? Math.min(Math.log(yMax), yScaleMax) : yScaleMax;
    yLowPlot = yMin > 0 ? Math.max(Math.log(yMin), yScaleMin) : yScaleMin;
  } else {
    yHighPlot = Math.min(yMax, yScaleMax);
    yLowPlot = Math.max(yMin, yScaleMin);
  }

  // uPlot's y-axis: high data values map to small pixel y (top of chart).
  const yHighPx = u.valToPos(yHighPlot, 'y');
  const yLowPx = u.valToPos(yLowPlot, 'y');

  const left = Math.min(xMinPx, xMaxPx);
  const right = Math.max(xMinPx, xMaxPx);

  u.setSelect(
    {
      left,
      top: yHighPx,
      width: right - left,
      height: Math.max(0, yLowPx - yHighPx),
    },
    false,
  );
}

// From: https://github.com/leeoniya/uPlot/blob/a4edb297a9b80baf781f4d05a40fb52fae737bff/demos/latency-heatmap.html#L436
function heatmapPaths(opts: {
  disp: { fill: { lookup: string[]; values: any } };
}) {
  const { disp } = opts;

  return (u: uPlot, seriesIdx: number, _idx0: number, _idx1: number) => {
    uPlot.orient(
      u,
      seriesIdx,
      (
        _series,
        _dataX,
        _dataY,
        scaleX,
        scaleY,
        valToPosX,
        valToPosY,
        xOff,
        yOff,
        xDim,
        yDim,
        _moveTo,
        _lineTo,
        rect,
        _arc,
      ) => {
        // mode 2 data format is not supported in types properly
        const d = u.data[seriesIdx] as unknown as Mode2DataArray;
        const [xs, ys, counts] = d;
        const dlen = xs.length;

        // fill colors are mapped from interpolating densities / counts along some gradient
        // (should be quantized to 64 colors/levels max. e.g. 16)
        const fills = disp.fill.values(u, seriesIdx);

        //	let fillPaths = new Map(); // #rgba => Path2D

        const fillPalette = disp.fill.lookup ?? [...new Set(fills)];

        const fillPaths = fillPalette.map(() => new Path2D());

        // fillPalette.forEach(fill => {
        // 	fillPaths.set(fill, new Path2D());
        // });

        // detect x and y bin qtys by detecting layout repetition in x & y data
        const yBinQty = dlen - ys.lastIndexOf(ys[0]);
        const xBinQty = dlen / yBinQty;
        const yBinIncr = ys[1] - ys[0];
        const xBinIncr = xs[yBinQty] - xs[0];

        // uniform tile sizes based on zoom level
        const xSize =
          valToPosX(xBinIncr, scaleX, xDim, xOff) -
          valToPosX(0, scaleX, xDim, xOff);
        const ySize =
          valToPosY(yBinIncr, scaleY, yDim, yOff) -
          valToPosY(0, scaleY, yDim, yOff);

        // pre-compute x and y offsets
        const cys = ys
          .slice(0, yBinQty)
          .map(y => Math.round(valToPosY(y, scaleY, yDim, yOff) - ySize / 2));
        const cxs = Array.from({ length: xBinQty }, (v, i) =>
          Math.round(
            valToPosX(xs[i * yBinQty], scaleX, xDim, xOff) - xSize / 2,
          ),
        );

        for (let i = 0; i < dlen; i++) {
          // filter out 0 counts and out of view
          if (
            counts[i] > 0 &&
            xs[i] >= (scaleX.min ?? -Infinity) &&
            xs[i] <= (scaleX.max ?? Infinity) &&
            ys[i] >= (scaleY.min ?? -Infinity) &&
            ys[i] <= (scaleY.max ?? Infinity)
          ) {
            const cx = cxs[~~(i / yBinQty)];
            const cy = cys[i % yBinQty];

            const fillPath = fillPaths[fills[i]];

            rect(fillPath, cx, cy, xSize, ySize);
          }
        }

        u.ctx.save();

        u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        u.ctx.clip();

        fillPaths.forEach((p, i) => {
          u.ctx.fillStyle = fillPalette[i];
          u.ctx.fill(p);
        });
        u.ctx.restore();
      },
    );

    return null;
  };
}

// Theme-specific palettes.  Red is deliberately avoided at the high end so
// it can be reserved for error overlays in the future.
// Dark theme: starts at a luminant indigo visible on dark bg, ends at bright amber.
// Light theme: starts at a saturated medium blue visible on white, ends at deep orange.
export const darkPalette = [
  '#7b6cf6', // indigo (low)
  '#5a9cf6', // sky blue
  '#38c9a0', // teal
  '#6cd44a', // green
  '#c4d629', // lime
  '#f0c528', // gold
  '#f5a623', // amber (high)
];
export const lightPalette = [
  '#2a6fb5', // medium blue (low)
  '#2a96a8', // teal
  '#33a85e', // green
  '#7db832', // lime
  '#c4a820', // dark gold
  '#e08a17', // orange
  '#d46a12', // deep orange (high)
];

function makeCountsToFills(colors: string[]) {
  return (u: uPlot, seriesIdx: number) => {
    // mode 2 data format is not supported in types properly
    const counts = u.data[seriesIdx][2] as unknown as number[];
    const dlen = counts.length;

    // Collect non-zero counts and sort to find a robust normalization ceiling.
    // Using p95 instead of max prevents a single hot cell from washing out the
    // rest of the chart, while still preserving cross-column comparability.
    const nonZero: number[] = [];
    for (let i = 0; i < dlen; i++) {
      if (counts[i] > 0) nonZero.push(counts[i]);
    }
    nonZero.sort((a, b) => a - b);

    const paletteSize = colors.length;
    const indexedFills = Array(dlen);

    if (nonZero.length === 0) {
      indexedFills.fill(-1);
      return indexedFills;
    }

    const p95Idx = Math.floor((nonZero.length - 1) * 0.95);
    const p95 = nonZero[p95Idx] ?? nonZero[nonZero.length - 1];
    const sqrtCeiling = Math.sqrt(p95);

    for (let i = 0; i < dlen; i++) {
      indexedFills[i] =
        counts[i] === 0
          ? -1
          : Math.max(
              Math.min(
                paletteSize - 1,
                Math.floor(
                  (Math.sqrt(counts[i]) / (sqrtCeiling || 1)) *
                    (paletteSize - 1),
                ),
              ),
              0,
            );
    }

    return indexedFills;
  };
}

const axis: uPlot.Axis = {
  stroke: 'rgba(102,102,102,1)', // color of the axis line
  font: '12px IBM Plex Mono, monospace',
  grid: {
    show: true, // show grid lines
    stroke: 'rgba(52,58,64)', // grid line color
    dash: [3, 3],
    width: 1,
  },
  border: {
    show: true,
    // stroke: 'rgba(82,82,82)', // grid line color
    stroke: 'rgba(102,102,102,1)', // color of the axis line
    width: 1,
  },
};

const opt: uPlot.Options = {
  width: 1500,
  height: 600,
  mode: 2,
  ms: 1,
  padding: [8, 8, 0, 4],
  legend: {
    show: false,
  },
  scales: {
    x: {
      time: true,
    },
  },
  axes: [
    {
      ...axis,
      gap: 10,
      space: 60,
    },
    {
      ...axis,
    },
  ],
  series: [
    {},
    {
      label: 'Latency',
      // paths and fill colors are set dynamically per theme in the
      // Heatmap component's useMemo — see buildSeriesForPalette().
      facets: [
        {
          scale: 'x',
          auto: true,
          sorted: 1,
        },
        {
          scale: 'y',
          auto: true,
        },
      ],
    },
  ],
};

/** Build the series[1] overrides for a given palette. */
function buildSeriesForPalette(colors: string[]): Partial<uPlot.Series> {
  return {
    paths: heatmapPaths({
      disp: {
        fill: {
          lookup: colors,
          values: makeCountsToFills(colors),
        },
      },
    }),
  };
}

type HeatmapChartConfig = {
  displayType: DisplayType.Heatmap;
  select: [
    {
      aggFn: 'heatmap';
      valueExpression: string;
      countExpression?: string;
    },
  ];
  from: BuilderChartConfigWithDateRange['from'];
  where: BuilderChartConfigWithDateRange['where'];
  dateRange: BuilderChartConfigWithDateRange['dateRange'];
  granularity: BuilderChartConfigWithDateRange['granularity'];
  timestampValueExpression: BuilderChartConfigWithDateRange['timestampValueExpression'];
  numberFormat?: BuilderChartConfigWithDateRange['numberFormat'];
  filters?: BuilderChartConfigWithDateRange['filters'];
  connection: string;
  with?: BuilderChartConfigWithDateRange['with'];
};

/** Build a HeatmapChartConfig from a builder chart config that has heatmap extras on select[0]. */
export function toHeatmapChartConfig(config: BuilderChartConfigWithDateRange): {
  heatmapConfig: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
} {
  const firstSelect = Array.isArray(config.select)
    ? config.select[0]
    : undefined;
  return {
    heatmapConfig: {
      ...config,
      displayType: DisplayType.Heatmap,
      select: [
        {
          aggFn: 'heatmap' as const,
          valueExpression: firstSelect?.valueExpression ?? '',
          countExpression: firstSelect?.countExpression,
        },
      ],
      granularity: 'auto',
      numberFormat: config.numberFormat,
    },
    scaleType: firstSelect?.heatmapScaleType ?? 'log',
  };
}

export const HEATMAP_N_BUCKETS = 80;

/**
 * Build the bounds (min/max) ChartConfig that runs first.  Result feeds
 * `effectiveMin`/`max` into `buildHeatmapBucketConfig`.
 */
export function buildHeatmapBoundsConfig({
  config,
  scaleType,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
}): BuilderChartConfigWithDateRange {
  const valueExpression = config.select[0].valueExpression;
  const isAggregateExpression = isAggregateFunction(valueExpression);
  const qLo = scaleType === 'log' ? 0.01 : 0.001;

  return isAggregateExpression
    ? {
        ...config,
        where: '',
        orderBy: undefined,
        granularity: undefined,
        select: [
          {
            aggFn: 'quantile' as const,
            level: qLo,
            aggCondition: `value_calc >= 0`,
            aggConditionLanguage: 'sql',
            valueExpression: 'value_calc',
            alias: 'min',
          },
          {
            aggFn: 'max' as const,
            valueExpression: 'value_calc',
            alias: 'max',
          },
        ],
        with: [
          {
            name: 'min_max_calc',
            chartConfig: {
              ...config,
              select: [{ valueExpression, alias: 'value_calc' }],
              orderBy: undefined,
            },
          },
        ],
        timestampValueExpression: '__hdx_time_bucket',
        from: { databaseName: '', tableName: 'min_max_calc' },
      }
    : {
        ...config,
        orderBy: undefined,
        granularity: undefined,
        select: [
          {
            aggFn: 'quantile' as const,
            level: qLo,
            valueExpression,
            aggCondition: `${valueExpression} >= 0`,
            aggConditionLanguage: 'sql',
            alias: 'min',
          },
          {
            aggFn: 'max' as const,
            valueExpression,
            alias: 'max',
          },
        ],
      };
}

/**
 * Build the bucketed-counts ChartConfig that runs second.  `effectiveMin`/`max`
 * are usually numbers (resolved from the bounds query), but accept strings so
 * callers — like the editor's SQL preview — can pass placeholder tokens
 * (e.g. `'{min}'`) before the bounds are known.
 */
export function buildHeatmapBucketConfig({
  config,
  scaleType,
  effectiveMin,
  max,
  granularity,
  nBuckets,
}: {
  config: HeatmapChartConfig;
  scaleType: HeatmapScaleType;
  effectiveMin: string | number;
  max: string | number;
  granularity: string;
  nBuckets: number;
}): BuilderChartConfigWithDateRange {
  const valueExpression = config.select[0].valueExpression;
  const countExpression = config.select[0].countExpression ?? 'count()';
  const isAggregateExpression = isAggregateFunction(valueExpression);

  const bucketExprAgg =
    scaleType === 'log'
      ? `widthBucket(log(greatest(toFloat64(value_calc), ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(value_calc, ${effectiveMin}, ${max}, ${nBuckets})`;
  const bucketExprDirect =
    scaleType === 'log'
      ? `widthBucket(log(greatest(toFloat64(${valueExpression}), ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(${valueExpression}, ${effectiveMin}, ${max}, ${nBuckets})`;

  return isAggregateExpression
    ? {
        ...config,
        where: '',
        select: [
          {
            valueExpression: 'sum(value_count)',
            alias: 'count',
          },
        ],
        groupBy: [
          {
            valueExpression: bucketExprAgg,
            alias: 'x_bucket',
          },
        ],
        with: [
          {
            name: 'bucket_calc',
            chartConfig: {
              ...config,
              select: [
                { valueExpression, alias: 'value_calc' },
                {
                  valueExpression: countExpression,
                  alias: 'value_count',
                },
              ],
              granularity,
              orderBy: undefined,
            },
          },
        ],
        timestampValueExpression: '__hdx_time_bucket',
        from: { databaseName: '', tableName: 'bucket_calc' },
        orderBy: [{ valueExpression: 'x_bucket', ordering: 'ASC' }],
        granularity,
      }
    : {
        ...config,
        select: [
          {
            valueExpression: countExpression,
            alias: 'count',
          },
        ],
        groupBy: [
          {
            valueExpression: bucketExprDirect,
            alias: 'x_bucket',
          },
        ],
        orderBy: [{ valueExpression: 'x_bucket', ordering: 'ASC' }],
        granularity,
      };
}

export function ColorLegend({ colors }: { colors: string[] }) {
  return (
    <Flex
      align="center"
      gap={4}
      role="img"
      aria-label="Color scale: low to high count"
    >
      <Text size="10px" c="dimmed">
        Low
      </Text>
      <div
        style={{
          display: 'flex',
          width: 80,
          height: 8,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {colors.map((color: string, i: number) => (
          <div key={i} style={{ flex: 1, background: color }} />
        ))}
      </div>
      <Text size="10px" c="dimmed">
        High
      </Text>
    </Flex>
  );
}

export type HeatmapScaleType = 'log' | 'linear';

function HeatmapContainer({
  config,
  enabled = true,
  onFilter,
  onClearFilter,
  selectionBounds,
  title,
  toolbarPrefix,
  toolbarSuffix,
  scaleType = 'log',
  showLegend = false,
}: {
  config: HeatmapChartConfig;
  enabled?: boolean;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  /**
   * The currently-applied drag-select bounds. When provided, the heatmap
   * draws the dashed selection rectangle and reapplies it after any uPlot
   * recreation (theme switch, prop change, resize) so the user always sees
   * which slice they filtered. Caller owns the URL/query-state plumbing;
   * this is purely a visual mirror of that state.
   */
  selectionBounds?: SelectionBounds | null;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  scaleType?: HeatmapScaleType;
  showLegend?: boolean;
}) {
  const dateRange = config.dateRange;
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

  const nBuckets = HEATMAP_N_BUCKETS;

  // Use quantile-based lower bound to avoid near-zero outliers stretching
  // the log axis.  For the upper bound, use actual max() so that latency
  // spikes (typically <1% of spans) remain visible — log scale already
  // handles wide ranges naturally.  Future: #1914 adds overflow-bucket
  // indicators for smarter range clamping without hiding spikes.
  const minMaxConfig = buildHeatmapBoundsConfig({ config, scaleType });

  const {
    data: minMaxData,
    isLoading: isMinMaxLoading,
    error: minMaxError,
  } = useQueriedChartConfig(minMaxConfig, {
    queryKey: ['heatmap', minMaxConfig],
    enabled: enabled,
  });

  const [errorModal, errorModalControls] = useDisclosure();

  // UInt64 are returned as strings; quantile returns floats
  const min = Number.parseFloat(minMaxData?.data?.[0]?.['min'] ?? '0');
  const max = Number.parseFloat(minMaxData?.data?.[0]?.['max'] ?? '0');

  // Ensure min > 0 for log scale (log(0) is undefined).
  // Cap the range to ~4 orders of magnitude so the axis isn't dominated
  // by a long empty tail of near-zero outliers.
  const effectiveMin =
    scaleType === 'log' ? Math.max(min, max * 1e-4 || 1e-4) : min;

  const bucketConfig = buildHeatmapBucketConfig({
    config,
    scaleType,
    effectiveMin,
    max,
    granularity,
    nBuckets,
  });

  const { data, isLoading, error } = useQueriedChartConfig(bucketConfig, {
    queryKey: ['heatmap_bucket', bucketConfig],
    enabled: !!minMaxData && bucketConfig != null && max > effectiveMin,
  });

  // Memoize so timeBucketByGranularity's fresh Date[] doesn't defeat
  // the heatmapData memoization downstream. dateRange itself may be a
  // fresh array each render, so depend on primitive ms + granularity.
  const fromMs = dateRange[0]?.getTime() ?? 0;
  const toMs = dateRange[1]?.getTime() ?? 0;
  const generatedTsBuckets = useMemo(
    () => timeBucketByGranularity(dateRange[0], dateRange[1], granularity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromMs, toMs, granularity],
  );

  // Stable [time, bucket, count] arrays let uplot-react skip its setData
  // path when only URL-state (xMin/xMax/yMin/yMax) changed. Pairs with the
  // selectionBounds prop on Heatmap below: the prop reapplies u.select on
  // any chart recreation, this memo prevents the recreation in the
  // common case.
  const heatmapData = useMemo<Mode2DataArray>(() => {
    const time: number[] = [];
    const bucket: number[] = [];
    const count: number[] = [];

    // timestampColumn is derived from data.meta, so data covers the dep.
    const timestampColumn = inferTimestampColumn(data?.meta ?? []);

    if (data == null || timestampColumn == null) {
      return [time, bucket, count];
    }

    // Compute the y-axis value for a given bucket index.
    // For log scale we store values in log space so that bins are uniformly
    // spaced on the linear uPlot y-axis.  The heatmapPaths renderer assumes
    // uniform increments (yBinIncr = ys[1] - ys[0]) to compute tile height;
    // with actual log-spaced values the first increment is tiny relative to
    // the full range and tiles render at ~0px height (invisible).
    const bucketToYValue = (j: number) => {
      if (scaleType === 'log' && effectiveMin > 0 && max > effectiveMin) {
        // Return the natural-log of the actual bucket boundary so that the
        // y-values are uniformly spaced.  Tick labels are exponentiated back
        // via the tickFormatter below.
        const actualValue =
          effectiveMin * Math.pow(max / effectiveMin, j / nBuckets);
        return Math.log(actualValue);
      }
      // Linear: min + j * step
      return effectiveMin + j * ((max - effectiveMin) / nBuckets);
    };

    let dataIndex = 0;
    for (let i = 0; i < generatedTsBuckets.length; i++) {
      const generatedTs = generatedTsBuckets[i].getTime();

      // CH widthBucket will return buckets from 0 to nBuckets + 1
      for (let j = 0; j <= nBuckets + 1; j++) {
        const row = data?.data?.[dataIndex];

        if (
          row != null &&
          new Date(row[timestampColumn.name]).getTime() == generatedTs &&
          row['x_bucket'] == j
        ) {
          time.push(new Date(row[timestampColumn.name]).getTime());
          bucket.push(bucketToYValue(row['x_bucket']));
          count.push(Number.parseInt(row['count'], 10)); // UInt64 returns as string

          dataIndex++;
        } else {
          time.push(generatedTs);
          bucket.push(bucketToYValue(j));
          count.push(0);
        }
      }
    }

    return [time, bucket, count];
  }, [data, generatedTsBuckets, scaleType, effectiveMin, max, nBuckets]);

  const time = heatmapData[0];

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems: React.ReactNode[] = [];

    if (showLegend) {
      allToolbarItems.push(
        <ColorLegend key="heatmap-legend" colors={palette} />,
      );
    }

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [showLegend, palette, toolbarPrefix, toolbarSuffix]);

  const _error = error || minMaxError;

  return (
    <ChartContainer
      title={title}
      toolbarItems={toolbarItemsMemo}
      disableReactiveContainer
    >
      {isLoading || isMinMaxLoading ? (
        <Text size="sm" ta="center" p="xl">
          Loading...
        </Text>
      ) : _error ? (
        <Box p="xl" ta="center" h="100%">
          <Text size="sm" mt="sm">
            Error loading chart, please check your query or try again later.
          </Text>
          <Button
            className="mx-auto"
            variant="subtle"
            color="red"
            onClick={() => errorModalControls.open()}
          >
            <Group gap="xxs">
              <IconArrowsDiagonal size={16} />
              See Error Details
            </Group>
          </Button>
          <Modal
            opened={errorModal}
            onClose={() => errorModalControls.close()}
            title="Error Details"
          >
            <Group align="start">
              <Text size="sm" ta="center">
                Error Message:
              </Text>
              <Code
                block
                style={{
                  whiteSpace: 'pre-wrap',
                }}
              >
                {_error.message}
              </Code>
              {_error instanceof ClickHouseQueryError && (
                <>
                  <Text my="sm" size="sm" ta="center">
                    Sent Query:
                  </Text>
                  <SQLPreview data={_error?.query} enableCopy />
                </>
              )}
            </Group>
          </Modal>
        </Box>
      ) : time.length < 2 || generatedTsBuckets?.length < 2 ? (
        <Text size="sm" ta="center" p="xl">
          Not enough data points to render heatmap. Try expanding your search
          criteria.
        </Text>
      ) : (
        <Heatmap
          key={JSON.stringify(config)}
          data={heatmapData}
          numberFormat={config.numberFormat}
          onFilter={
            onFilter
              ? (xMin, xMax, yMin, yMax) => {
                  // In log mode, the bottom bucket collects all values
                  // clamped by greatest(value, effectiveMin).  If the
                  // selection touches that bucket, widen yMin to 0 so
                  // the downstream SQL filter captures all those spans.
                  // The 1.1x threshold adds 10% headroom to account for
                  // floating-point rounding in the bucket boundary.
                  const adjustedYMin =
                    scaleType === 'log' && yMin <= effectiveMin * 1.1
                      ? 0
                      : yMin;
                  onFilter(xMin, xMax, adjustedYMin, yMax);
                }
              : undefined
          }
          onClearFilter={onClearFilter}
          scaleType={scaleType}
          palette={palette}
          selectionBounds={selectionBounds}
        />
      )}
    </ChartContainer>
  );
}

export default dynamic(() => Promise.resolve(HeatmapContainer), {
  ssr: false,
});

function highlightDataPlugin({
  proximity,
  onPointHighlight,
}: {
  proximity: number;
  onPointHighlight: (point: {
    // data point values
    xVal: number;
    yVal: number;
    countVal: number;
    // distance data
    closestDistance: number;
    closestIndex: number;
    // bounding box for data point in css parent unit
    xCoord: number;
    yCoord: number;
    xSize: number;
    ySize: number;
  }) => void;
}): Plugin {
  // let dataPoint: HTMLDivElement | null = null;
  let lastDataPointIndex = -1; // Used to prevent duplicate calls
  return {
    hooks: {
      setCursor: (u: uPlot) => {
        const { top, left } = u.cursor;
        if (top == null || left == null) {
          return;
        }

        // const y = u.posToVal(top, 'y');
        // const x = u.posToVal(left, 'x');

        const [xs, ys, counts] = u.data[1] as unknown as Mode2DataArray;

        let closestIndex = 0;
        let closestDistance = Infinity;

        for (let i = 0; i < xs.length; i++) {
          const xPx = u.valToPos(xs[i], 'x');
          const yPx = u.valToPos(ys[i], 'y');

          // const distance = Math.abs(xs[i] - x) + Math.abs(ys[i] - y);
          const distance = Math.sqrt((xPx - left) ** 2 + (yPx - top) ** 2);

          if (distance < closestDistance && counts[i] > 0) {
            closestIndex = i;
            closestDistance = distance;
          }
        }

        // Taken from heatmapPaths and modified for css pixels
        const dlen = xs.length;

        // detect x and y bin qtys by detecting layout repetition in x & y data
        const yBinQty = dlen - ys.lastIndexOf(ys[0]);
        const yBinIncr = ys[1] - ys[0];
        const xBinIncr = xs[yBinQty] - xs[0];

        const xSize = Math.abs(u.valToPos(xBinIncr, 'x') - u.valToPos(0, 'x'));
        const ySize = Math.abs(u.valToPos(yBinIncr, 'y') - u.valToPos(0, 'y'));

        const xCoord = u.valToPos(xs[closestIndex], 'x');
        const yCoord = u.valToPos(ys[closestIndex], 'y');

        const countVal = counts[closestIndex];
        const xVal = xs[closestIndex];
        const yVal = ys[closestIndex];

        const { offsetLeft, offsetTop } = u.over;

        if (
          closestDistance < proximity &&
          closestIndex !== lastDataPointIndex
        ) {
          lastDataPointIndex = closestIndex;
          onPointHighlight({
            xVal,
            yVal,
            countVal,
            closestDistance,
            closestIndex,
            xCoord: xCoord + offsetLeft,
            yCoord: yCoord + offsetTop,
            xSize,
            ySize,
          });
        }
      },
    },
  };
}

function Heatmap({
  data,
  numberFormat,
  onFilter,
  onClearFilter,
  scaleType = 'linear',
  palette,
  selectionBounds,
}: {
  data: Mode2DataArray;
  numberFormat?: NumberFormat;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  scaleType?: HeatmapScaleType;
  palette: string[];
  selectionBounds?: SelectionBounds | null;
}) {
  const [highlightedPoint, setHighlightedPoint] = useState<
    | {
        xVal: number;
        yVal: number;
        countVal: number;
        closestDistance: number;
        closestIndex: number;
        xCoord: number;
        yCoord: number;
        xSize: number;
        ySize: number;
      }
    | undefined
  >(undefined);

  // Gate tooltip display on actual mouse interaction. uPlot fires setCursor
  // on init (before user hovers), which would show the tooltip on page load.
  const mouseInsideRef = useRef(false);

  // Depend on the boolean, not the onFilter function reference, so the
  // options useMemo doesn't recompute (and re-initialize uPlot — wiping its
  // internal u.select drag rectangle) on every parent render.
  const hasFilter = !!onFilter;

  // Hold onFilter in a ref so the setSelect hook (captured inside the
  // options useMemo) can always call the latest callback without needing
  // onFilter in the memo's dep array.
  const onFilterRef = useRef(onFilter);
  useEffect(() => {
    onFilterRef.current = onFilter;
  }, [onFilter]);

  // Hold the uPlot instance so outside-click can explicitly clear the
  // persisted u.select rectangle (which is owned by uPlot, not React).
  const uplotRef = useRef<uPlot | null>(null);

  // Hold selectionBounds and scaleType in refs so the uPlot `ready` hook
  // (captured inside the options useMemo via closure) always sees the
  // latest values without needing them in the memo's dep array. Mutating
  // a ref doesn't trigger re-renders, so the options identity stays
  // stable across selection/scale changes.
  const selectionBoundsRef = useRef(selectionBounds);
  const scaleTypeRef = useRef(scaleType);
  // Runs every commit; mirrors latest props into refs (no deps array on
  // purpose).
  useEffect(() => {
    selectionBoundsRef.current = selectionBounds;
    scaleTypeRef.current = scaleType;
  });

  // Reapply the URL-backed selection whenever the bounds prop changes
  // (e.g. a fresh drag-select arrives via the round-trip through the
  // parent's URL state, or the parent clears the filter). This complements
  // the uPlot `ready` hook below: that handles initial chart creation
  // (and any recreation), this handles bounds changes against an existing
  // chart.
  useEffect(() => {
    if (uplotRef.current) {
      applySelectionToChart(uplotRef.current, selectionBounds, scaleType);
    }
  }, [selectionBounds, scaleType]);

  // Timestamp of the most recent drag-end. Guards the container's onClick
  // handler from clearing the selection when the synthetic click event
  // that fires on mouseup-after-drag arrives.
  const justDraggedAtRef = useRef(0);

  const { ref, width, height } = useElementSize();

  // Stabilize on numberFormat content, not reference. Callers (e.g.
  // DBSearchHeatmapChart) build a fresh `numberFormat` object on every
  // render; depending on its identity would rebuild tickFormatter, then
  // the options memo, then uplot-react would see new top-level keys via
  // optionsUpdateState and treat the change as 'create', destroying the
  // chart and wiping u.select. Hashing the contents lets the memo skip
  // when the actual format is unchanged. (HDX-4147)
  //
  // Relies on NumberFormat being JSON-serializable: today it is plain
  // config (string + number fields), so JSON.stringify is a faithful
  // fingerprint. If the type ever grows a function-valued field
  // (e.g. a custom `formatter` callback), switch to a shallow-equal
  // helper keyed on the known fields, because functions stringify to
  // undefined and would silently skip rebuilds.
  const numberFormatKey = useMemo(
    () => (numberFormat ? JSON.stringify(numberFormat) : ''),
    [numberFormat],
  );
  const tickFormatter = useCallback(
    (value: number) => {
      // y-values are stored in log space for log scale; exponentiate back
      // to the actual value before formatting.
      const actualValue = scaleType === 'log' ? Math.exp(value) : value;

      if (numberFormat?.unit === 'ms' || numberFormat?.output === 'duration') {
        const msValue =
          numberFormat?.output === 'duration'
            ? actualValue * (numberFormat?.factor ?? 1) * 1000
            : actualValue;
        return formatDurationMsCompact(msValue);
      }

      return numberFormat
        ? formatNumber(actualValue, {
            ...numberFormat,
            average: true,
            mantissa: Math.abs(actualValue) >= 1 ? 0 : 2,
          })
        : new Intl.NumberFormat('en-US', {
            notation: 'compact',
            compactDisplay: 'short',
          }).format(actualValue);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [numberFormatKey, scaleType],
  );

  const options: uPlot.Options = useMemo(() => {
    const themedSeries = buildSeriesForPalette(palette);
    return {
      ...opt,
      series: [opt.series[0], { ...opt.series[1], ...themedSeries }],
      ...(opt != null && opt.axes != null
        ? {
            axes: [
              opt.axes[0],
              {
                ...opt.axes[1],
                values: (_u: uPlot, vals: number[]) => {
                  return vals.map(tickFormatter);
                },
                // Override the static size fn so it measures the actual
                // formatted labels (from tickFormatter) rather than
                // whatever raw values uPlot passes in a prior cycle.
                size(self: uPlot, values: string[]) {
                  if (!values || values.length === 0) return 50;
                  const font =
                    self.axes[1]?.font ?? '12px IBM Plex Mono, monospace';
                  const ctx = self.ctx;
                  ctx.save();
                  ctx.font = font;
                  let maxW = 0;
                  for (const v of values) {
                    const w = ctx.measureText(v).width;
                    if (w > maxW) maxW = w;
                  }
                  ctx.restore();
                  return Math.ceil(maxW) + 16;
                },
                // For log scale, place ticks at powers of 10 (0.01, 0.1, 1,
                // 10, 100…) so labels are clean round numbers instead of
                // arbitrary positions in log-space.
                ...(scaleType === 'log'
                  ? {
                      splits: (u: uPlot) => {
                        const [yMin, yMax] =
                          u.scales.y!.min != null
                            ? [u.scales.y!.min, u.scales.y!.max!]
                            : [0, 1];
                        // yMin/yMax are in log-space (natural log)
                        const realMin = Math.exp(yMin);
                        const realMax = Math.exp(yMax);
                        const splits: number[] = [];
                        // Generate powers of 10 within range
                        const startExp = Math.floor(Math.log10(realMin));
                        const endExp = Math.ceil(Math.log10(realMax));
                        for (let e = startExp; e <= endExp; e++) {
                          const v = Math.pow(10, e);
                          const logV = Math.log(v);
                          if (logV >= yMin && logV <= yMax) {
                            splits.push(logV);
                          }
                        }
                        // If too few splits, add intermediate values (×3)
                        if (splits.length < 3) {
                          for (let e = startExp; e <= endExp; e++) {
                            for (const mult of [1, 3]) {
                              const v = mult * Math.pow(10, e);
                              const logV = Math.log(v);
                              if (logV >= yMin && logV <= yMax) {
                                splits.push(logV);
                              }
                            }
                          }
                          // Deduplicate and sort
                          return [...new Set(splits)].sort((a, b) => a - b);
                        }
                        return splits;
                      },
                    }
                  : {}),
              },
            ],
          }
        : {}),
      width,
      height,
      cursor: {
        drag: {
          setScale: false,
          x: hasFilter,
          y: hasFilter,
          dist: 5,
        },
        show: true,
        focus: {
          prox: 100,
        },
      },
      plugins: [
        // legendAsTooltipPlugin()
        // eslint-disable-next-line react-hooks/refs -- mouseInsideRef is read at event time, not during render
        highlightDataPlugin({
          proximity: 20,
          onPointHighlight: ({
            xVal,
            yVal,
            countVal,
            closestDistance,
            closestIndex,
            xCoord,
            yCoord,
            xSize,
            ySize,
          }) => {
            // Only show tooltip after the user has actually hovered the chart.
            // uPlot fires setCursor on init which would trigger this on page load.
            if (!mouseInsideRef.current) return;
            setHighlightedPoint({
              xVal,
              yVal,
              countVal,
              closestDistance,
              closestIndex,
              xCoord,
              yCoord,
              xSize,
              ySize,
            });
          },
        }),
        {
          hooks: {
            // Fires once after uPlot finishes initial layout/draw. At
            // onCreate time scales aren't reliably populated for mode-2
            // facet data, so reapplying the URL-backed selection from
            // here ensures valToPos has the bounds it needs. (HDX-4147)
            ready: u => {
              applySelectionToChart(
                u,
                selectionBoundsRef.current,
                scaleTypeRef.current,
              );
            },
            setSelect: u => {
              // Ignore zero-size selections (e.g. single-click)
              if (u.select.width <= 0 || u.select.height <= 0) {
                return;
              }

              const xMin = u.posToVal(u.select.left, 'x');
              const xMax = u.posToVal(u.select.left + u.select.width, 'x');
              const rawYMax = u.posToVal(u.select.top, 'y');
              const rawYMin = u.posToVal(u.select.top + u.select.height, 'y');

              // y-values are stored in log space for log scale; convert back
              const yMin = scaleType === 'log' ? Math.exp(rawYMin) : rawYMin;
              const yMax = scaleType === 'log' ? Math.exp(rawYMax) : rawYMax;

              // Apply the filter immediately on drag end. Record the
              // timestamp so the synthetic click event that follows the
              // drag (mouseup fires a click on the container) doesn't
              // immediately clear the selection we just made.
              justDraggedAtRef.current = performance.now();
              onFilterRef.current?.(xMin / 1000, xMax / 1000, yMin, yMax);
            },
          },
        },
      ],
    };
  }, [width, height, tickFormatter, scaleType, palette, hasFilter]);

  return (
    <div
      ref={ref}
      className="heatmap-selection-container"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onClick={() => {
        // Chromium fires a click event on mouseup even after a drag.
        // Ignore it; the drag itself was handled by setSelect.
        if (performance.now() - justDraggedAtRef.current < 300) {
          return;
        }
        if (!hasFilter) return;
        // Random click on the chart clears the persisted selection and
        // exits comparison mode.
        uplotRef.current?.setSelect(
          { left: 0, top: 0, width: 0, height: 0 },
          false,
        );
        onClearFilter?.();
      }}
      onMouseEnter={() => {
        mouseInsideRef.current = true;
      }}
      onMouseLeave={() => {
        mouseInsideRef.current = false;
        setHighlightedPoint(undefined);
      }}
    >
      <UplotReact
        options={options}
        // @ts-expect-error TODO: uPlot types are wrong for mode 2 data
        data={[[], data]}
        resetScales={true}
        onCreate={chart => {
          uplotRef.current = chart;
        }}
        onDelete={() => {
          uplotRef.current = null;
        }}
      />
      {highlightedPoint != null && (
        <>
          <div
            style={{
              position: 'absolute',
              top: highlightedPoint.yCoord,
              // TODO: This seems to be off by a few pixels depending on scale
              left: highlightedPoint.xCoord,
              width: highlightedPoint.xSize,
              height: highlightedPoint.ySize,
              pointerEvents: 'none',
              background: 'var(--mantine-color-default-hover)',
            }}
          />
          <div
            className="px-2 py-1 fs-8"
            style={{
              position: 'absolute',
              // Clamp so the tooltip stays within the chart container
              top: Math.min(highlightedPoint.yCoord + 5, height - 90),
              ...(highlightedPoint.xCoord > width / 2
                ? {
                    right: width - highlightedPoint.xCoord + 10,
                  }
                : {
                    left: highlightedPoint.xCoord + 10,
                  }),
              maxWidth: '50%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
              backdropFilter: 'blur(8px)',
              backgroundColor: 'var(--mantine-color-body)',
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          >
            {onFilter && (
              <>
                <Text size="10px" pt="4px">
                  Drag to Compare · Click to Clear
                </Text>
                <Divider my="xs" />
              </>
            )}
            <div>
              <FormatTime value={highlightedPoint.xVal} />
            </div>
            <div>
              <b>Y Value:</b> {tickFormatter(highlightedPoint.yVal)}
            </div>
            <div>
              <b>Count Value:</b>{' '}
              {new Intl.NumberFormat('en-US', {
                notation: 'standard',
                compactDisplay: 'short',
              }).format(highlightedPoint.countVal)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
