import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import stripAnsi from 'strip-ansi';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  Row as TableRow,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from './api';
import { Granularity, timeBucketByGranularity } from './ChartUtils';
import LogLevel from './LogLevel';
import { Pattern } from './PatternSidePanel';
import { UNDEFINED_WIDTH } from './tableUtils';
import { useWindowSize } from './utils';

const PatternTrendChartTooltip = (props: any) => {
  return null;
};

const PatternTrendChart = ({
  data,
  dateRange,
  granularity,
}: {
  data: { bucket: string; count: number }[];
  dateRange: [Date, Date];
  granularity: Granularity;
}) => {
  const chartData = useMemo(() => {
    const computedBuckets = timeBucketByGranularity(
      dateRange[0],
      dateRange[1],
      granularity,
    );

    return computedBuckets.map(bucket => {
      const match = data.find(
        d => new Date(d.bucket).getTime() === bucket.getTime(),
      );
      return {
        ts_bucket: bucket.getTime() / 1000,
        count: match?.count ?? 0,
      };
    });
  }, [data, granularity, dateRange]);

  return (
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
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            width={500}
            height={300}
            data={chartData}
            syncId="hdx"
            syncMethod="value"
            margin={{ top: 4, left: 0, right: 4, bottom: 0 }}
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
              // tickFormatter={tick =>
              //   format(new Date(tick * 1000), 'MMM d HH:mm')
              // }
              tickFormatter={tick => ''}
              minTickGap={50}
              tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <YAxis
              width={40}
              minTickGap={25}
              tickFormatter={(value: number) =>
                new Intl.NumberFormat('en-US', {
                  notation: 'compact',
                  compactDisplay: 'short',
                }).format(value)
              }
              tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
            />
            <Bar dataKey="count" stackId="a" fill="#20c997" maxBarSize={24} />
            {/* <Line
              key={'count'}
              type="monotone"
              dataKey={'count'}
              stroke={'#20c997'}
              dot={false}
            /> */}
            <Tooltip content={<PatternTrendChartTooltip />} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const MemoPatternTable = memo(
  ({
    dateRange,
    patterns,
    formatUTC,
    highlightedPatternId,
    isLoading,
    onRowExpandClick,
    onShowEventsClick,
    wrapLines,
  }: {
    dateRange: [Date, Date];
    patterns: any;
    wrapLines: boolean;
    isLoading: boolean;
    onRowExpandClick: (pattern: Pattern) => void;
    formatUTC: boolean;
    highlightedPatternId: string | undefined;
    onShowEventsClick?: () => void;
  }) => {
    const { width } = useWindowSize();
    const isSmallScreen = (width ?? 1000) < 900;

    //we need a reference to the scrolling element for logic down below
    const tableContainerRef = useRef<HTMLDivElement>(null);

    const columns = useMemo<ColumnDef<any>[]>(
      () => [
        {
          accessorKey: 'id',
          header: () => '',
          cell: info => {
            return (
              <div
                role="button"
                className={cx('cursor-pointer', {
                  'text-success': highlightedPatternId === info.getValue(),
                  'text-muted-hover': highlightedPatternId !== info.getValue(),
                })}
                onMouseDown={e => {
                  // For some reason this interfers with the onclick handler
                  // inside a dashboard tile
                  e.stopPropagation();
                }}
                onClick={() => {
                  onRowExpandClick(info.row.original);
                }}
              >
                {'> '}
              </div>
            );
          },
          size: 8,
          enableResizing: false,
        },
        {
          accessorKey: 'count',
          header: 'Count',
          cell: info => (
            <span>
              ~{' '}
              {new Intl.NumberFormat('en-US', {
                notation: 'compact',
                compactDisplay: 'short',
              }).format(Number.parseInt(info.getValue<string>()))}
            </span>
          ),
          size: 70,
        },
        {
          accessorKey: 'trends.data',
          header: 'Trend',
          cell: info => {
            return (
              <div style={{ height: 50, width: '100%' }}>
                <PatternTrendChart
                  data={info.getValue() as any[]}
                  dateRange={dateRange}
                  granularity={info.row.original.trends.granularity}
                />
              </div>
            );
          },
          size: isSmallScreen ? 70 : 120,
        },
        {
          accessorKey: 'level',
          header: 'Level',
          cell: info => (
            <span>
              <LogLevel level={info.getValue<string>()} />
            </span>
          ),
          size: isSmallScreen ? 50 : 100,
        },
        {
          accessorKey: 'service',
          header: 'Service',
          cell: info => <span>{info.getValue<string>()}</span>,
          size: isSmallScreen ? 70 : 100,
        },
        {
          accessorKey: 'pattern',
          header: () => (
            <span>
              Pattern{' '}
              {onShowEventsClick && (
                <span>
                  •{' '}
                  <span
                    role="button"
                    className="text-muted-hover fw-normal text-decoration-underline"
                    onClick={onShowEventsClick}
                  >
                    Show Events
                  </span>
                </span>
              )}
            </span>
          ),
          cell: info => <div>{stripAnsi(info.getValue<string>())}</div>,
          size: UNDEFINED_WIDTH,
          enableResizing: false,
        },
      ],
      [
        // formatUTC,
        highlightedPatternId,
        onRowExpandClick,
        isSmallScreen,
        onShowEventsClick,
        dateRange,
      ],
    );

    const table = useReactTable({
      data: patterns,
      columns,
      getCoreRowModel: getCoreRowModel(),
      // debugTable: true,
      enableColumnResizing: true,
      columnResizeMode: 'onChange',
    });

    const { rows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => tableContainerRef.current,
      estimateSize: useCallback(() => 58, []),
      overscan: 10,
      paddingEnd: 20,
    });

    const items = rowVirtualizer.getVirtualItems();

    const [paddingTop, paddingBottom] =
      items.length > 0
        ? [
            Math.max(0, items[0].start - rowVirtualizer.options.scrollMargin),
            Math.max(
              0,
              rowVirtualizer.getTotalSize() - items[items.length - 1].end,
            ),
          ]
        : [0, 0];

    return (
      <div
        className="overflow-auto h-100 fs-8 bg-inherit"
        ref={tableContainerRef}
        // Fixes flickering scroll bar: https://github.com/TanStack/virtual/issues/426#issuecomment-1403438040
        // style={{ overflowAnchor: 'none' }}
      >
        <table className="w-100 bg-inherit" style={{ tableLayout: 'fixed' }}>
          <thead
            className="bg-inherit"
            style={{
              background: 'inherit',
              position: 'sticky',
              top: 0,
            }}
          >
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, headerIndex) => {
                  return (
                    <th
                      className="overflow-hidden text-truncate"
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{
                        width:
                          header.getSize() === UNDEFINED_WIDTH
                            ? '100%'
                            : header.getSize(),
                        // Allow unknown width columns to shrink to 0
                        minWidth:
                          header.getSize() === UNDEFINED_WIDTH
                            ? 0
                            : header.getSize(),
                        position: 'relative',
                      }}
                    >
                      {header.isPlaceholder ? null : (
                        <div>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </div>
                      )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={`resizer text-gray-600 cursor-grab ${
                            header.column.getIsResizing() ? 'isResizing' : ''
                          }`}
                          style={{
                            position: 'absolute',
                            right: 4,
                            top: 0,
                            bottom: 0,
                            width: 12,
                          }}
                        >
                          <i className="bi bi-three-dots-vertical" />
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={99999} style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {items.map(virtualRow => {
              const row = rows[virtualRow.index] as TableRow<any>;
              return (
                <tr
                  role="button"
                  onClick={() => {
                    onRowExpandClick(row.original);
                  }}
                  key={virtualRow.key}
                  className={cx('bg-default-dark-grey-hover', {
                    'bg-light-grey': highlightedPatternId === row.original.id,
                  })}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                >
                  {row.getVisibleCells().map(cell => {
                    return (
                      <td
                        key={cell.id}
                        className={cx('align-top overflow-hidden py-1', {
                          'text-break': wrapLines,
                          'text-truncate': !wrapLines,
                        })}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td colSpan={800}>
                {(isLoading || patterns.length === 0) && (
                  <div className="rounded fs-7 bg-grey text-center d-flex align-items-center justify-content-center mt-3">
                    {isLoading ? (
                      <div className="my-3">
                        <div className="spin-animate d-inline-block">
                          <i className="bi bi-arrow-repeat" />
                        </div>{' '}
                        Calculating patterns...
                      </div>
                    ) : patterns.length === 0 ? (
                      <div className="my-3">No patterns found.</div>
                    ) : null}
                  </div>
                )}
              </td>
            </tr>
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={99999} style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  },
);

export default function PatternTable({
  config: { where, dateRange },
  onRowExpandClick,
  isUTC,
  onShowEventsClick,
  highlightedPatternId,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  highlightedPatternId: undefined | string;
  onRowExpandClick: (pattern: Pattern) => void;
  isUTC: boolean;
  onShowEventsClick?: () => void;
}) {
  const { data: histogramResults, isLoading: isHistogramResultsLoading } =
    api.useLogHistogram(
      where,
      dateRange?.[0] ?? new Date(),
      dateRange?.[1] ?? new Date(),
      {
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    );

  const { data: patterns, isFetching: isPatternsFetching } = api.useLogPatterns(
    {
      q: where,
      startDate: dateRange?.[0] ?? new Date(),
      endDate: dateRange?.[1] ?? new Date(),
      sampleRate: Math.min(
        10000 /
          (histogramResults?.data?.reduce(
            (p: number, v: any) => p + Number.parseInt(v.count),
            0,
          ) +
            1),
        1,
      ),
    },
    {
      enabled:
        histogramResults != null &&
        dateRange?.[0] != null &&
        dateRange?.[1] != null,
      refetchOnWindowFocus: false,
    },
  );

  const isLoading = isPatternsFetching;

  return (
    <>
      <MemoPatternTable
        wrapLines={true}
        dateRange={dateRange}
        highlightedPatternId={highlightedPatternId}
        patterns={patterns?.data ?? []}
        isLoading={isLoading}
        formatUTC={isUTC}
        onRowExpandClick={onRowExpandClick}
        onShowEventsClick={onShowEventsClick}
      />
    </>
  );
}
