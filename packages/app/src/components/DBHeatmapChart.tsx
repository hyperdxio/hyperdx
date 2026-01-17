import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Plugin } from 'uplot';
import uPlot from 'uplot';
import UplotReact from 'uplot-react';
import {
  ClickHouseQueryError,
  inferTimestampColumn,
} from '@hyperdx/common-utils/dist/clickhouse';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Code, Divider, Group, Modal, Text } from '@mantine/core';
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

// viridis(10)
const palette = [
  'rgba(253, 231, 37, 1.0)', // #fde725
  'rgba(181, 222, 43, 0.92)', // #b5de2b
  'rgba(110, 206, 88, 0.9)', // #6ece58
  'rgba(53, 183, 121, 0.8)', // #35b779
  'rgba(31, 158, 137, 0.8)', // #1f9e89
  'rgba(38, 130, 142, 0.7)', // #26828e
  'rgba(49, 104, 142, 0.7)', // #31688e
  'rgba(62, 73, 137, 0.7)', // #3e4989
  // 'rgba(72, 40, 120, 0.5)', // #482878
  // 'rgba(68, 1, 84, 0.4)', // #440154
  'hsla(259, 35%, 25%, 0.7)',
  // 'rgba(255, 0, 0, 1)', // #482878
  // 'rgba(255, 0, 255, 1)', // #482878
].reverse();

const countsToFills = (u: uPlot, seriesIdx: number) => {
  // mode 2 data format is not supported in types properly
  const counts = u.data[seriesIdx][2] as unknown as number[];

  // TODO: integrate 1e-9 hideThreshold?
  const hideThreshold = 0;

  let minCount = Infinity;
  let maxCount = -Infinity;

  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > hideThreshold) {
      minCount = Math.min(minCount, counts[i]);
      maxCount = Math.max(maxCount, counts[i]);
    }
  }

  // Normalize values
  const tFn = (x: number) => Math.log(x) / Math.log(20);

  // Floor to at least 1 count difference to prevent NaN
  const logRange = tFn(maxCount) - tFn(minCount);

  const paletteSize = palette.length;

  const indexedFills = Array(counts.length);

  for (let i = 0; i < counts.length; i++) {
    indexedFills[i] =
      counts[i] === 0
        ? -1
        : Math.max(
            Math.min(
              paletteSize - 1,
              Math.floor(
                Math.max(
                  paletteSize * (tFn(counts[i]) - tFn(minCount)),
                  1e-32, // Prevent NaN when divided by 0, bias towards +Inf
                ) / logRange,
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
  from: ChartConfigWithDateRange['from'];
  where: ChartConfigWithDateRange['where'];
  dateRange: ChartConfigWithDateRange['dateRange'];
  granularity: ChartConfigWithDateRange['granularity'];
  timestampValueExpression: ChartConfigWithDateRange['timestampValueExpression'];
  numberFormat?: ChartConfigWithDateRange['numberFormat'];
  filters?: ChartConfigWithDateRange['filters'];
  connection: string;
  with?: ChartConfigWithDateRange['with'];
};

function HeatmapContainer({
  config,
  enabled = true,
  onFilter,
  title,
  toolbarPrefix,
  toolbarSuffix,
}: {
  config: HeatmapChartConfig;
  enabled?: boolean;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
}) {
  const dateRange = config.dateRange;
  const granularity = convertDateRangeToGranularityString(dateRange, 245);

  const nBuckets = 80;

  const valueExpression = config.select[0].valueExpression;
  const countExpression = config.select[0].countExpression ?? 'count()';

  // When valueExpression is an aggregate like count(), we need to use a CTE to calculate the heatmap
  const isAggregateExpression = isAggregateFunction(valueExpression);

  const minMaxConfig: ChartConfigWithDateRange = isAggregateExpression
    ? {
        ...config,
        where: '',
        orderBy: undefined,
        granularity: undefined,
        select: [
          {
            aggFn: 'min',
            // TODO: Select if we can be negative
            aggCondition: `value_calc >= 0`,
            aggConditionLanguage: 'sql',
            valueExpression: 'value_calc',
            alias: 'min',
          },
          {
            aggFn: 'max',
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
            aggFn: 'min',
            valueExpression,
            // TODO: Select if we can be negative
            aggCondition: `${valueExpression} >= 0`,
            aggConditionLanguage: 'sql',
            alias: 'min',
          },
          { aggFn: 'max', valueExpression, aggCondition: '', alias: 'max' },
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

  // UInt64 are returned as strings
  const min = Number.parseInt(minMaxData?.data?.[0]?.['min'] ?? '0', 10);
  const max = Number.parseInt(minMaxData?.data?.[0]?.['max'] ?? '0', 10);

  const bucketConfig: ChartConfigWithDateRange = isAggregateExpression
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
            valueExpression: `widthBucket(value_calc, ${min}, ${max}, ${nBuckets})`,
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
            valueExpression: `widthBucket(${valueExpression}, ${min}, ${max}, ${nBuckets})`,
            alias: 'x_bucket',
          },
        ],
        orderBy: [{ valueExpression: 'x_bucket', ordering: 'ASC' }],
        granularity,
      };

  const { data, isLoading, error } = useQueriedChartConfig(bucketConfig, {
    queryKey: ['heatmap_bucket', bucketConfig],
    enabled: !!minMaxData && bucketConfig != null,
  });

  const generatedTsBuckets = timeBucketByGranularity(
    dateRange[0],
    dateRange[1],
    granularity,
  );

  const timestampColumn = inferTimestampColumn(data?.meta ?? []);

  const time: number[] = []; // x values
  const bucket: number[] = []; // y value series 1
  const count: number[] = []; // y value series 2
  if (data != null && timestampColumn != null) {
    let dataIndex = 0;

    for (let i = 0; i < generatedTsBuckets.length; i++) {
      const generatedTs = generatedTsBuckets[i].getTime();

      // CH widthBucket will return buckets from 0 to nBuckets + 1
      for (let j = 0; j <= nBuckets + 1; j++) {
        // const resultIndex = i * nBuckets + j;
        const row = data?.data?.[dataIndex];

        if (
          row != null &&
          new Date(row[timestampColumn.name]).getTime() == generatedTs &&
          row['x_bucket'] == j
        ) {
          time.push(new Date(row[timestampColumn.name]).getTime());
          bucket.push(min + row['x_bucket'] * ((max - min) / nBuckets));
          count.push(Number.parseInt(row['count'], 10)); // UInt64 returns as string

          dataIndex++;
        } else {
          time.push(generatedTs);
          bucket.push(min + j * ((max - min) / nBuckets));
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
        <Heatmap
          key={JSON.stringify(config)}
          data={[time, bucket, count]}
          numberFormat={config.numberFormat}
          onFilter={onFilter}
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
}: {
  data: Mode2DataArray;
  numberFormat?: NumberFormat;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
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

  const { ref, width, height } = useElementSize();

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
        // legendAsTooltipPlugin(),
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
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onClick={() => {
        if (selectingInfo != null) {
          setSelectingInfo(undefined);
        }
      }}
      onMouseLeave={() => {
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
              ...(highlightedPoint.xCoord > (width * 2) / 3
                ? {
                    right: width - highlightedPoint.xCoord + 10,
                  }
                : {
                    left: highlightedPoint.xCoord + 10,
                  }),
              backdropFilter: 'blur(8px)',
              backgroundColor: 'rgba(#1A1D23 0.75)',
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
            backgroundColor: 'rgba(#1A1D23 0.4)',
            border: '1px solid #5F6776',
            borderRadius: 2,
            position: 'absolute',
            bottom: height - selectingInfo?.top + 4,
            left: selectingInfo?.left,
          }}
          onClick={e => {
            e.stopPropagation();
            onFilter?.(
              selectingInfo.xMin / 1000,
              selectingInfo.xMax / 1000,
              selectingInfo.yMin,
              selectingInfo.yMax,
            );
          }}
          role="button"
        >
          Filter by Selection
        </div>
      )}
    </div>
  );
}
