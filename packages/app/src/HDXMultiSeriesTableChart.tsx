import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { HoverCard, Text, UnstyledButton } from '@mantine/core';
import { IconDownload, IconTextWrap } from '@tabler/icons-react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Getter,
  Row,
  Row as TableRow,
  SortingFnOption,
  SortingState,
  TableOptions,
  useReactTable,
} from '@tanstack/react-table';
import { ColumnDef } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import { CsvExportButton } from './components/CsvExportButton';
import TableHeader from './components/DBTable/TableHeader';
import { useCsvExport } from './hooks/useCsvExport';
import type { RowAction } from './hooks/useOnClickLinkBuilder';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { UNDEFINED_WIDTH } from './tableUtils';
import type { NumberFormat } from './types';
import { formatNumber } from './utils';

import focusStyles from '../styles/focus.module.scss';

export type TableVariant = 'default' | 'muted';

// Arbitrary limit to prevent OOM crashes for very large result sets. Most result sets should be paginated anyway.
export const MAX_TABLE_ROWS = 10_000;

export const Table = ({
  data,
  groupColumnName,
  columns,
  getRowAction,
  getRowSearchLink,
  tableBottom,
  enableClientSideSorting = false,
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
    sortingFn?: SortingFnOption<any>;
  }[];
  groupColumnName?: string;
  // Returns the row click destination + a hover-hint description. When
  // set, the cell becomes an <a> wrapped in a HoverCard. The resolved
  // URL goes straight in the href so the browser handles cmd-click,
  // middle-click, right-click, status bar preview, and keyboard
  // activation natively. Rows whose templates fail (`url: null`) fall
  // back to a click handler that fires a notification, preserving the
  // pre-existing #2140 / #2141 / #2146 / #2148 behavior.
  getRowAction?: (row: any) => RowAction;
  // Legacy single-tile drilldown: bare URL, no hint, no HoverCard.
  // Used outside the dashboard onClick path (event side panel, services
  // dashboard, etc.). Only consulted when getRowAction is not provided.
  getRowSearchLink?: (row: any) => string | null;
  tableBottom?: React.ReactNode;
  enableClientSideSorting?: boolean;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  variant?: TableVariant;
}) => {
  const brandName = useBrandDisplayName();
  const MIN_COLUMN_WIDTH_PX = 100;
  //we need a reference to the scrolling element for logic down below
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const truncatedData = useMemo(() => {
    if (data.length > MAX_TABLE_ROWS) {
      return data.slice(0, MAX_TABLE_ROWS);
    }
    return data;
  }, [data]);
  const isTruncated = truncatedData.length === MAX_TABLE_ROWS;

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
          {
            id,
            dataKey,
            displayName,
            numberFormat,
            columnWidthPercent,
            sortingFn,
          },
          i,
        ) =>
          ({
            id: id,
            accessorKey: dataKey,
            header: displayName,
            accessorFn: (row: any) => row[dataKey],
            sortingFn,
            cell: ({
              getValue,
              row,
            }: {
              getValue: Getter<number>;
              row: Row<any>;
            }) => {
              const value = getValue();
              let formattedValue: string | number | null = value ?? null;

              // Table cannot accept values which are objects or arrays, so we need to stringify them
              if (typeof value !== 'string' && typeof value !== 'number') {
                formattedValue = JSON.stringify(value);
              } else if (numberFormat) {
                formattedValue = formatNumber(value, numberFormat);
              }

              const className = cx('align-top overflow-hidden py-1 pe-3', {
                'text-break': wrapLinesEnabled,
                'text-truncate': !wrapLinesEnabled,
              });

              // Native <a href> covers cmd-click (new tab), middle-click
              // (new tab), right-click ("Open in New Tab" / "Copy Link
              // Address"), Enter key activation, and the browser status
              // bar URL preview. No manual handlers required.
              const interactiveClassName = cx(
                className,
                'd-block text-reset text-decoration-none w-100 text-start',
                focusStyles.focusRing,
              );

              if (getRowAction) {
                // The hook memoizes per-row results internally, so calling
                // this once per cell is cheap and the row-level HoverCard
                // in the <tbody> loop below sees the same identity.
                const action = getRowAction(row.original);
                if (action.url) {
                  // Use prefetch={false} so virtualization scroll doesn't
                  // trigger an N-row prefetch storm against /search? and
                  // /dashboards/ routes the user usually never opens.
                  return (
                    <Link
                      href={action.url}
                      prefetch={false}
                      className={interactiveClassName}
                      data-testid="dashboard-table-row-action"
                    >
                      {formattedValue}
                    </Link>
                  );
                }
                // Row's templates failed to resolve. Use a real <button> so
                // cmd-click, middle-click, and right-click "Open Link in
                // New Tab" stay disabled (a # anchor would silently open
                // a meaningless new tab on auxclick before our onClick
                // handler runs). The button still surfaces the existing
                // notification toast on left-click; the proper "muted row
                // + warning icon" preempt state is tracked as AC8.
                return (
                  <button
                    type="button"
                    className={interactiveClassName}
                    onClick={action.onClickError}
                    style={{ background: 'none', border: 'none' }}
                    data-testid="dashboard-table-row-action"
                  >
                    {formattedValue}
                  </button>
                );
              }

              if (getRowSearchLink) {
                const url = getRowSearchLink(row.original);
                if (url) {
                  return (
                    <Link
                      href={url}
                      prefetch={false}
                      className={interactiveClassName}
                      data-testid="dashboard-table-row-action"
                    >
                      {formattedValue}
                    </Link>
                  );
                }
              }

              return <div className={className}>{formattedValue}</div>;
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
          }) satisfies ColumnDef<any>,
      ),
  ];

  const sortingParams: Partial<TableOptions<any>> = useMemo(() => {
    return enableClientSideSorting
      ? {
          enableSorting: true,
          getSortedRowModel: getSortedRowModel(),
        }
      : {
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
        };
  }, [enableClientSideSorting, onSortingChange, sorting]);

  const table = useReactTable({
    data: truncatedData,
    columns: reactTableColumns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    ...sortingParams,
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
    truncatedData,
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
            // Compute the action once per row so the row-level HoverCard
            // sees the same description and per-cell renders share the
            // memoized result from useOnClickLinkBuilder.
            const rowAction = getRowAction ? getRowAction(row.original) : null;
            const tr = (
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
            // Row-level HoverCard so the hint position stays stable as the
            // cursor moves between cells in the same row. Mantine's
            // HoverCard.Target clones the <tr> and merges its hover ref
            // with the virtualizer's measureElement ref.
            if (rowAction) {
              return (
                <HoverCard
                  key={virtualRow.key}
                  withinPortal
                  shadow="md"
                  openDelay={250}
                  position="top"
                >
                  <HoverCard.Target>{tr}</HoverCard.Target>
                  <HoverCard.Dropdown py="xs" px="sm">
                    <Text size="xs">{rowAction.description}</Text>
                  </HoverCard.Dropdown>
                </HoverCard>
              );
            }
            return tr;
          })}
          {paddingBottom > 0 && (
            <tr>
              <td colSpan={99999} style={{ height: `${paddingBottom}px` }} />
            </tr>
          )}
        </tbody>
      </table>
      {isTruncated && (
        <div className="p-2 text-center">
          Showing the first {MAX_TABLE_ROWS} rows.
        </div>
      )}
      {tableBottom}
    </div>
  );
};
