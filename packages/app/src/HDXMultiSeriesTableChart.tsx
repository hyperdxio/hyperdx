import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { UnstyledButton } from '@mantine/core';
import { IconDownload, IconTextWrap } from '@tabler/icons-react';
import {
  flexRender,
  getCoreRowModel,
  Getter,
  Row,
  Row as TableRow,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import { CsvExportButton } from './components/CsvExportButton';
import TableHeader from './components/DBTable/TableHeader';
import { useCsvExport } from './hooks/useCsvExport';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { UNDEFINED_WIDTH } from './tableUtils';
import type { NumberFormat } from './types';
import { formatNumber } from './utils';

export type TableVariant = 'default' | 'muted';

export const Table = ({
  data,
  groupColumnName,
  columns,
  getRowSearchLink,
  tableBottom,
  sorting,
  onSortingChange,
  variant = 'default',
}: {
  data: any[];
  columns: {
    id: string;
    dataKey: string;
    displayName: string;
    sortOrder?: 'asc' | 'desc';
    numberFormat?: NumberFormat;
    columnWidthPercent?: number;
    visible?: boolean;
  }[];
  groupColumnName?: string;
  getRowSearchLink?: (row: any) => string | null;
  tableBottom?: React.ReactNode;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  variant?: TableVariant;
}) => {
  const brandName = useBrandDisplayName();
  const MIN_COLUMN_WIDTH_PX = 100;
  //we need a reference to the scrolling element for logic down below
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const tableWidth = tableContainerRef.current?.clientWidth;
  const numColumns = columns.filter(c => c.visible !== false).length + 1;
  const dataColumnsWidthPerc = columns
    .filter(c => c.visible !== false)
    .map(({ columnWidthPercent }) =>
      Math.max(
        tableWidth != null ? (MIN_COLUMN_WIDTH_PX / tableWidth) * 100 : 0,
        columnWidthPercent ?? (1 / numColumns) * 100,
      ),
    );

  const labelColumnWidthPercent = Math.min(
    100 - dataColumnsWidthPerc.reduce((a, b) => a + b, 0),
    75,
  );

  const reactTableColumns: ColumnDef<any>[] = [
    // DB table charts dont have a default column, we should stop using
    // this across the app
    ...(groupColumnName != null
      ? [
          {
            accessorKey: 'group',
            header: groupColumnName,
            size:
              tableWidth != null
                ? Math.max(tableWidth * (labelColumnWidthPercent / 100), 100)
                : 200,
          },
        ]
      : []),
    ...columns
      .filter(c => c.visible !== false)
      .map(
        (
          { id, dataKey, displayName, numberFormat, columnWidthPercent },
          i,
        ) => ({
          id: id,
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
            const link = getRowSearchLink(row.original);

            if (!link) {
              return (
                <div
                  className={cx('align-top overflow-hidden py-1 pe-3', {
                    'text-break': wrapLinesEnabled,
                    'text-truncate': !wrapLinesEnabled,
                  })}
                >
                  {formattedValue}
                </div>
              );
            }

            return (
              <Link
                href={link}
                className={cx('align-top overflow-hidden py-1 pe-3', {
                  'text-break': wrapLinesEnabled,
                  'text-truncate': !wrapLinesEnabled,
                })}
                style={{
                  display: 'block',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                {formattedValue}
              </Link>
            );
          },
          size:
            i === numColumns - 2
              ? UNDEFINED_WIDTH
              : tableWidth != null && columnWidthPercent != null
                ? Math.max(
                    tableWidth * (columnWidthPercent / 100),
                    MIN_COLUMN_WIDTH_PX,
                  )
                : tableWidth != null
                  ? tableWidth / numColumns
                  : 200,
          enableResizing: i !== numColumns - 2,
        }),
      ),
  ];

  const table = useReactTable({
    data,
    columns: reactTableColumns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableSorting: true,
    manualSorting: true,
    onSortingChange: v => {
      if (typeof v === 'function') {
        const newSortVal = v(sorting);
        onSortingChange?.(newSortVal ?? null);
      } else {
        onSortingChange?.(v ?? null);
      }
    },
    state: {
      sorting,
    },
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
  const totalSize = rowVirtualizer.getTotalSize();

  const [paddingTop, paddingBottom] = useMemo(
    () =>
      items.length > 0
        ? [
            Math.max(0, items[0].start - rowVirtualizer.options.scrollMargin),
            Math.max(0, totalSize - items[items.length - 1].end),
          ]
        : [0, 0],
    [items, rowVirtualizer.options.scrollMargin, totalSize],
  );
  const [wrapLinesEnabled, setWrapLinesEnabled] = useState(false);

  const { csvData } = useCsvExport(
    data,
    columns.map(col => ({
      dataKey: col.dataKey,
      displayName: col.displayName,
    })),
    { groupColumnName },
  );

  return (
    <div className="overflow-auto h-100 fs-8" ref={tableContainerRef}>
      <table
        className="w-100"
        style={{
          tableLayout: 'fixed',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-ibm-plex-mono)',
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            background:
              variant === 'muted'
                ? 'var(--color-bg-muted)'
                : 'var(--color-bg-body)',
          }}
        >
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, headerIndex) => {
                return (
                  <TableHeader
                    key={header.id}
                    header={header}
                    isLast={headerIndex === headerGroup.headers.length - 1}
                    lastItemButtons={
                      <>
                        {headerIndex === headerGroup.headers.length - 1 && (
                          <div className="d-flex align-items-center">
                            <UnstyledButton
                              onClick={() => setWrapLinesEnabled(prev => !prev)}
                            >
                              <IconTextWrap size={14} />
                            </UnstyledButton>
                            <CsvExportButton
                              data={csvData}
                              filename={`${brandName}_table_results`}
                              className="fs-8 ms-2"
                              title="Download table as CSV"
                            >
                              <IconDownload size={14} />
                            </CsvExportButton>
                          </div>
                        )}
                      </>
                    }
                  />
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
                className="bg-muted-hover"
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
              >
                {row.getVisibleCells().map(cell => {
                  return (
                    <td key={cell.id} title={`${cell.getValue()}`}>
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
      {tableBottom}
    </div>
  );
};
