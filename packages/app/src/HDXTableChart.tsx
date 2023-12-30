import { memo, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import cx from 'classnames';
import {
  flexRender,
  getCoreRowModel,
  Row as TableRow,
  useReactTable,
} from '@tanstack/react-table';
import { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from './api';
import { AggFn } from './ChartUtils';
import { UNDEFINED_WIDTH } from './tableUtils';
import type { NumberFormat } from './types';
import { formatNumber } from './utils';
const Table = ({
  data,
  valueColumnName,
  numberFormat,
  onRowClick,
}: {
  data: any[];
  valueColumnName: string;
  numberFormat?: NumberFormat;
  onRowClick?: (row: any) => void;
}) => {
  //we need a reference to the scrolling element for logic down below
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: 'group',
      header: 'Group',
      size:
        // TODO: Figure out how to make this more robust
        tableContainerRef.current?.clientWidth != null
          ? tableContainerRef.current?.clientWidth * 0.5
          : 200,
    },
    {
      accessorKey: 'data',
      header: valueColumnName,
      size: UNDEFINED_WIDTH,
      cell: ({ getValue }) => {
        const value = getValue() as string;
        if (numberFormat) {
          return formatNumber(parseInt(value), numberFormat);
        }
        return value;
      },
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
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
                role={onRowClick ? 'button' : undefined}
                onClick={() => onRowClick?.(row.original)}
                key={virtualRow.key}
                className={cx('bg-default-dark-grey-hover', {
                  // 'bg-light-grey': highlightedPatternId === row.original.id,
                })}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
              >
                {row.getVisibleCells().map(cell => {
                  return (
                    <td
                      key={cell.id}
                      className={cx('align-top overflow-hidden py-1 pe-3', {
                        // 'text-break': wrapLines,
                        // 'text-truncate': !wrapLines,
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
          {paddingBottom > 0 && (
            <tr>
              <td colSpan={99999} style={{ height: `${paddingBottom}px` }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const HDXTableChart = memo(
  ({
    config: {
      table,
      aggFn,
      field,
      where,
      groupBy,
      dateRange,
      sortOrder,
      numberFormat,
    },
    onSettled,
  }: {
    config: {
      table: string;
      aggFn: AggFn;
      field: string;
      where: string;
      groupBy: string;
      dateRange: [Date, Date];
      sortOrder: 'asc' | 'desc';
      numberFormat?: NumberFormat;
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } =
      table === 'logs'
        ? api.useLogsChart(
            {
              aggFn,
              endDate: dateRange[1] ?? new Date(),
              field,
              granularity: undefined,
              groupBy,
              q: where,
              startDate: dateRange[0] ?? new Date(),
              sortOrder,
            },
            {
              onSettled,
            },
          )
        : api.useMetricsChart(
            {
              aggFn,
              endDate: dateRange[1] ?? new Date(),
              granularity: undefined,
              name: field,
              q: where,
              startDate: dateRange[0] ?? new Date(),
              groupBy,
              // sortOrder,
            },
            {
              onSettled,
            },
          );

    const valueColumnName = aggFn === 'count' ? 'Count' : `${aggFn}(${field})`;

    const router = useRouter();
    const handleRowClick = useMemo(() => {
      if (table !== 'logs') {
        return undefined;
      }
      return (row?: { group: string }) => {
        const qparams = new URLSearchParams({
          q:
            where +
            (groupBy
              ? ` ${groupBy}:${row?.group ? `"${row.group}"` : '*'}`
              : ''),
          from: `${dateRange[0].getTime()}`,
          to: `${dateRange[1].getTime()}`,
        });
        router.push(`/search?${qparams.toString()}`);
      };
    }, [dateRange, groupBy, router, table, where]);

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : data?.data?.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <div className="d-flex align-items-center justify-content-center fs-2 h-100">
        <Table
          data={data?.data ?? []}
          valueColumnName={valueColumnName}
          onRowClick={handleRowClick}
          numberFormat={numberFormat}
        />
      </div>
    );
  },
);

export default HDXTableChart;
