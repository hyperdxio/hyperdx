import { useCallback, useMemo, useRef, useState } from 'react';
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
} from '@mantine/core';
import { useDisclosure, useElementSize } from '@mantine/hooks';
import { IconArrowsDiagonal } from '@tabler/icons-react';

import { isAggregateFunction, timeBucketByGranularity } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { NumberFormat } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { formatNumber } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import { SQLPreview } from './ChartSQLPreview';

type Mode2DataArray = [number[], number[], number[]];

// From: https://github.com/leeoniya/uPlot/blob/a4edb297a9b80baf781f4d05a40fb52fae737bff/demos/latency-heatmap.html#L436
function heatmapPaths(opts: {
  disp: { fill: { lookup: string[]; values: any } };
}) {
  const { disp } = opts;

  return (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
    uPlot.orient(
      u,
      seriesIdx,
      (
        series,
        dataX,
        dataY,
        scaleX,
        scaleY,
        valToPosX,
        valToPosY,
        xOff,
        yOff,
        xDim,
        yDim,
        moveTo,
        lineTo,
        rect,
        arc,
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

        const fillPaths = fillPalette.map(color => new Path2D());

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

// Viridis-inspired palette — fully opaque for dark and light mode compatibility
const palette = [
  '#440154', // dark purple (low)
  '#3e4989',
  '#31688e',
  '#26828e',
  '#1f9e89',
  '#35b779',
  '#6ece58',
  '#b5de2b',
  '#fde725', // yellow (high)
];

const countsToFills = (u: uPlot, seriesIdx: number) => {
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

  const paletteSize = palette.length;
  const indexedFills = Array(dlen);

  if (nonZero.length === 0) {
    indexedFills.fill(-1);
    return indexedFills;
  }

  const p95Idx = Math.floor(nonZero.length * 0.95);
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
                (Math.sqrt(counts[i]) / (sqrtCeiling || 1)) * (paletteSize - 1),
              ),
            ),
            0,
          );
  }

  return indexedFills;
};

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
    },
    {
      ...axis,
    },
  ],
  series: [
    {},
    {
      label: 'Latency',
      paths: heatmapPaths({
        disp: {
          fill: {
            lookup: palette,
            values: countsToFills,
          },
        },
      }),
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

function ColorLegend() {
  return (
    <Flex align="center" gap={4} px="sm" pb={2}>
      <Text size="10px" c="dimmed">
        Low
      </Text>
      <div
        style={{
          display: 'flex',
          height: 8,
          flex: 1,
          maxWidth: 120,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {palette.map((color, i) => (
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
  title,
  toolbarPrefix,
  toolbarSuffix,
  scaleType = 'log',
}: {
  config: HeatmapChartConfig;
  enabled?: boolean;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  scaleType?: HeatmapScaleType;
}) {
  const dateRange = config.dateRange;
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

  const nBuckets = 80;

  const valueExpression = config.select[0].valueExpression;
  const countExpression = config.select[0].countExpression ?? 'count()';

  // When valueExpression is an aggregate like count(), we need to use a CTE to calculate the heatmap
  const isAggregateExpression = isAggregateFunction(valueExpression);

  // Use quantile-based range to avoid extreme outliers stretching the axis.
  // Log scale uses wider quantiles (p1–p99) because tiny near-zero outliers
  // create huge empty gaps at the bottom of the log axis.
  const qLo = scaleType === 'log' ? 0.01 : 0.001;
  const qHi = scaleType === 'log' ? 0.99 : 0.999;
  const minMaxConfig: BuilderChartConfigWithDateRange = isAggregateExpression
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
            aggFn: 'quantile' as const,
            level: qHi,
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
            aggFn: 'quantile' as const,
            level: qHi,
            valueExpression,
            aggCondition: '',
            alias: 'max',
          },
        ],
      };

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

  // For log scale: bucket by log(value) to get log-spaced boundaries
  // For linear scale: bucket by raw value (original behavior)
  const bucketExprAgg =
    scaleType === 'log'
      ? `widthBucket(log(greatest(value_calc, ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(value_calc, ${effectiveMin}, ${max}, ${nBuckets})`;
  const bucketExprDirect =
    scaleType === 'log'
      ? `widthBucket(log(greatest(${valueExpression}, ${effectiveMin})), log(${effectiveMin}), log(${max}), ${nBuckets})`
      : `widthBucket(${valueExpression}, ${effectiveMin}, ${max}, ${nBuckets})`;

  const bucketConfig: BuilderChartConfigWithDateRange = isAggregateExpression
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

  const { data, isLoading, error } = useQueriedChartConfig(bucketConfig, {
    queryKey: ['heatmap_bucket', bucketConfig],
    enabled: !!minMaxData && bucketConfig != null && max > effectiveMin,
  });

  const generatedTsBuckets = timeBucketByGranularity(
    dateRange[0],
    dateRange[1],
    granularity,
  );

  const timestampColumn = inferTimestampColumn(data?.meta ?? []);

  // Compute the y-axis value for a given bucket index.
  // For log scale we store values in log space so that bins are uniformly
  // spaced on the linear uPlot y-axis.  The heatmapPaths renderer assumes
  // uniform increments (yBinIncr = ys[1] - ys[0]) to compute tile height;
  // with actual log-spaced values the first increment is tiny relative to the
  // full range and tiles render at ~0px height (invisible).
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

  const time: number[] = []; // x values
  const bucket: number[] = []; // y value series 1
  const count: number[] = []; // y value series 2
  if (data != null && timestampColumn != null) {
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
  }

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [toolbarPrefix, toolbarSuffix]);

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
        <>
          <Heatmap
            key={JSON.stringify(config)}
            data={[time, bucket, count]}
            numberFormat={config.numberFormat}
            onFilter={onFilter}
            scaleType={scaleType}
          />
          <ColorLegend />
        </>
      )}
    </ChartContainer>
  );
}

export default dynamic(() => Promise.resolve(HeatmapContainer), {
  ssr: false,
});

function highlightDataPlugin({
  proximity,
  yFormatter,
  xFormatter,
  onPointHighlight,
}: {
  proximity: number;
  yFormatter: (value: number) => string;
  xFormatter: (value: number) => string;
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
  scaleType = 'linear',
}: {
  data: Mode2DataArray;
  numberFormat?: NumberFormat;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  scaleType?: HeatmapScaleType;
}) {
  const [selectingInfo, setSelectingInfo] = useState<
    | {
        // In pixel units
        top: number;
        left: number;
        width: number;
        height: number;
        // In data units
        xMin: number;
        yMin: number;
        xMax: number;
        yMax: number;
      }
    | undefined
  >(undefined);

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

  const { ref, width, height } = useElementSize();

  const tickFormatter = useCallback(
    (value: number) => {
      // y-values are stored in log space for log scale; exponentiate back
      // to the actual value before formatting.
      const actualValue = scaleType === 'log' ? Math.exp(value) : value;
      return numberFormat
        ? formatNumber(actualValue, {
            ...numberFormat,
            average: true,
            mantissa: 0,
          })
        : new Intl.NumberFormat('en-US', {
            notation: 'compact',
            compactDisplay: 'short',
          }).format(actualValue);
    },
    [numberFormat, scaleType],
  );

  const options: uPlot.Options = useMemo(() => {
    return {
      ...opt,
      ...(opt != null && opt.axes != null
        ? {
            axes: [
              opt.axes[0],
              {
                ...opt.axes[1],
                values: (u, vals) => {
                  return vals.map(tickFormatter);
                },
              },
            ],
          }
        : {}),
      width,
      height,
      cursor: {
        drag: {
          setScale: false, // Disable zooming
          x: true,
          y: true,
          dist: 5, // Only trigger drag if distance is greater than 5 pixels
        },
        show: true, // Ensure the cursor is enabled
        focus: {
          prox: 100, // Proximity to the cursor line to trigger focus
        },
      },
      plugins: [
        // legendAsTooltipPlugin()
        // eslint-disable-next-line react-hooks/refs -- mouseInsideRef is read at event time, not during render
        highlightDataPlugin({
          proximity: 20,
          yFormatter: tickFormatter,
          xFormatter: s => {
            return `${new Date(s).toLocaleString()}`;
          },
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
            setSelect: u => {
              // Ignore zero-size selections (e.g. single-click)
              if (u.select.width <= 0 || u.select.height <= 0) {
                return;
              }

              // Calculate offset from parent so we can render tooltip
              // relative to the parent pixels
              const { offsetLeft, offsetTop } = u.over;

              const xMin = u.posToVal(u.select.left, 'x');
              const xMax = u.posToVal(u.select.left + u.select.width, 'x');
              const yMax = u.posToVal(u.select.top, 'y');
              const yMin = u.posToVal(u.select.top + u.select.height, 'y');

              // This ensures we set the timeout after all click handlers
              // to prevent our state from being wiped by onclick handler
              setTimeout(() => {
                setSelectingInfo({
                  top: u.select.top + offsetTop,
                  left: u.select.left + offsetLeft,
                  width: u.select.width,
                  height: u.select.height,
                  xMin,
                  xMax,
                  yMin,
                  yMax,
                });
              }, 20);
            },
          },
        },
      ],
    };
  }, [width, height, tickFormatter]);

  return (
    <div
      ref={ref}
      className="heatmap-selection-container"
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onClick={() => {
        if (selectingInfo != null) {
          setSelectingInfo(undefined);
        }
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
              background: 'rgba(255, 255, 255, 0.8)',
            }}
          />
          <div
            className="px-2 py-1 fs-8"
            style={{
              position: 'absolute',
              top: highlightedPoint.yCoord + 5,
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
              backgroundColor: 'rgba(26, 29, 35, 0.75)',
              border: '1px solid #5F6776',
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          >
            <Text size="10px" pt="4px">
              Click & Drag to Select Data
            </Text>
            <Divider my="xs" />
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
      {selectingInfo != null && onFilter != null && (
        <div
          className="px-2 py-1 fs-8"
          style={{
            backdropFilter: 'blur(4px)',
            backgroundColor: 'rgba(26, 29, 35, 0.4)',
            border: '1px solid #5F6776',
            borderRadius: 2,
            position: 'absolute',
            bottom: height - selectingInfo?.top + 4,
            left: selectingInfo?.left,
          }}
          onClick={e => {
            e.stopPropagation();
            // y-values are stored in log space for log scale; convert back
            const yMin =
              scaleType === 'log'
                ? Math.exp(selectingInfo.yMin)
                : selectingInfo.yMin;
            const yMax =
              scaleType === 'log'
                ? Math.exp(selectingInfo.yMax)
                : selectingInfo.yMax;
            onFilter?.(
              selectingInfo.xMin / 1000,
              selectingInfo.xMax / 1000,
              yMin,
              yMax,
            );
          }}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const yMin =
                scaleType === 'log'
                  ? Math.exp(selectingInfo.yMin)
                  : selectingInfo.yMin;
              const yMax =
                scaleType === 'log'
                  ? Math.exp(selectingInfo.yMax)
                  : selectingInfo.yMax;
              onFilter?.(
                selectingInfo.xMin / 1000,
                selectingInfo.xMax / 1000,
                yMin,
                yMax,
              );
            }
          }}
        >
          Filter by Selection
        </div>
      )}
    </div>
  );
}
