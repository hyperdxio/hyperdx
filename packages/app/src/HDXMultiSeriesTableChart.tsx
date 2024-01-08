import { memo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Flex, Text } from '@mantine/core';
import {
  flexRender,
  getCoreRowModel,
  Getter,
  Row,
  Row as TableRow,
  useReactTable,
} from '@tanstack/react-table';
import { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from './api';
import {
  Granularity,
  seriesColumns,
  seriesToUrlSearchQueryParam,
} from './ChartUtils';
import { UNDEFINED_WIDTH } from './tableUtils';
import type { ChartSeries, NumberFormat } from './types';
import { formatNumber } from './utils';

const Table = ({
  data,
  groupColumnName,
  columns,
  getRowSearchLink,
  onSortClick,
}: {
  data: any[];
  columns: {
    dataKey: string;
    displayName: string;
    sortOrder?: 'asc' | 'desc';
    numberFormat?: NumberFormat;
  }[];
  groupColumnName: string;
  getRowSearchLink?: (row: any) => string;
  onSortClick?: (columnNumber: number) => void;
}) => {
  //we need a reference to the scrolling element for logic down below
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const tableWidth = tableContainerRef.current?.clientWidth;
  const numColumns = columns.length + 1;
  const reactTableColumns: ColumnDef<any>[] = [
    {
      accessorKey: 'group',
      header: groupColumnName,
      size: tableWidth != null ? tableWidth / numColumns : 200,
    },
    ...columns.map(({ dataKey, displayName, numberFormat }, i) => ({
      accessorKey: dataKey,
      header: displayName,
      accessorFn: (row: any) => row[dataKey],
      cell: ({
        getValue,
        row,
      }: {
        getValue: Getter<number>;
        row: Row<any>;
      }) => {
        const value = getValue();
        let formattedValue: string | number | null = value ?? null;
        if (numberFormat) {
          formattedValue = formatNumber(value, numberFormat);
        }
        if (getRowSearchLink == null) {
          return formattedValue;
        }

        return (
          <Link href={getRowSearchLink(row.original)} passHref>
            <a
              className={'align-top overflow-hidden py-1 pe-3'}
              style={{
                display: 'block',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              {formattedValue}
            </a>
          </Link>
        );
      },
      size:
        i === columns.length - 1
          ? UNDEFINED_WIDTH
          : tableWidth != null
          ? tableWidth / numColumns
          : 200,
      enableResizing: i !== columns.length - 1,
    })),
  ];

  const table = useReactTable({
    data,
    columns: reactTableColumns,
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
                const sortOrder = columns[headerIndex - 1]?.sortOrder;
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
                      minWidth: 100,
                      position: 'relative',
                    }}
                  >
                    {header.isPlaceholder ? null : (
                      <Flex justify="space-between">
                        <div>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </div>
                        <Flex gap="sm">
                          {headerIndex > 0 && onSortClick != null && (
                            <div
                              role="button"
                              onClick={() => onSortClick(headerIndex - 1)}
                            >
                              {sortOrder === 'asc' ? (
                                <Text c="green">
                                  <i className="bi bi-sort-numeric-up-alt"></i>
                                </Text>
                              ) : sortOrder === 'desc' ? (
                                <Text c="green">
                                  <i className="bi bi-sort-numeric-down-alt"></i>
                                </Text>
                              ) : (
                                <Text c="dark.2">
                                  <i className="bi bi-sort-numeric-down-alt"></i>
                                </Text>
                              )}
                            </div>
                          )}
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`resizer text-gray-600 cursor-grab ${
                                header.column.getIsResizing()
                                  ? 'isResizing'
                                  : ''
                              }`}
                            >
                              <i className="bi bi-three-dots-vertical" />
                            </div>
                          )}
                        </Flex>
                      </Flex>
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
                key={virtualRow.key}
                className="bg-default-dark-grey-hover"
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
              >
                {row.getVisibleCells().map(cell => {
                  return (
                    <td key={cell.id}>
                      {getRowSearchLink == null ? (
                        <div className="align-top overflow-hidden py-1 pe-3">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      ) : (
                        <Link href={getRowSearchLink(row.original)} passHref>
                          <a
                            className="align-top overflow-hidden py-1 pe-3"
                            style={{
                              display: 'block',
                              color: 'inherit',
                              textDecoration: 'none',
                            }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </a>
                        </Link>
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

const HDXMultiSeriesTableChart = memo(
  ({
    config: { series, seriesReturnType = 'column', dateRange, groupColumnName },
    onSettled,
    onSortClick,
    getRowSearchLink,
  }: {
    config: {
      series: ChartSeries[];
      granularity: Granularity;
      dateRange: [Date, Date];
      seriesReturnType: 'ratio' | 'column';
      groupColumnName?: string;
    };
    onSettled?: () => void;
    onSortClick?: (seriesIndex: number) => void;
    getRowSearchLink?: (row: any) => string;
  }) => {
    const { data, isError, isLoading } = api.useMultiSeriesChart({
      series,
      endDate: dateRange[1] ?? new Date(),
      startDate: dateRange[0] ?? new Date(),
      seriesReturnType,
    });

    const seriesMeta = seriesColumns({
      series,
      seriesReturnType,
    });

    const defaultRowSearchLink = useCallback(
      (row: { group: string }) => {
        return `/search?${seriesToUrlSearchQueryParam({
          series,
          groupByValue: row.group ? `"${row.group}"` : undefined,
          dateRange,
        })}`;
      },
      [series, dateRange],
    );

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
          groupColumnName={
            groupColumnName ??
            (series[0].type === 'table'
              ? series[0].groupBy.join(' ') || 'Group'
              : 'Group')
          }
          columns={seriesMeta}
          getRowSearchLink={getRowSearchLink ?? defaultRowSearchLink}
          onSortClick={onSortClick}
        />
      </div>
    );
  },
);

export default HDXMultiSeriesTableChart;
