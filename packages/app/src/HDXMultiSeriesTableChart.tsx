import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import {
  ChartPaletteToken,
  ColorCondition,
  isChartPaletteToken,
} from '@hyperdx/common-utils/dist/types';
import { Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconArrowUpRight,
  IconDownload,
  IconTextWrap,
} from '@tabler/icons-react';
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
import {
  formatNumber,
  getColorFromCSSToken,
  resolveConditionalColor,
} from './utils';

import styles from './HDXMultiSeriesTableChart.module.scss';
import focusStyles from '@styles/focus.module.scss';

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
    // Per-column static palette-token color (table tiles). Applied to the
    // cell text; falls back through `colorRules` then the default color.
    color?: ChartPaletteToken;
    // Ordered conditional color rules evaluated against each cell's value
    // (last match wins). Resolves to `color` when no rule matches.
    colorRules?: ColorCondition[];
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
            color,
            colorRules,
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

              // Resolve this cell's color from the column config: ordered
              // rules first (last match wins), then the column's static
              // color, else no override. ClickHouse serializes numeric
              // aggregates (count is UInt64, sums, etc.) as strings, so coerce
              // a numeric-looking value to a number first; otherwise the
              // numeric operators (gt / lt / between) never match. Genuine
              // strings (group-by labels, status values) stay as-is so the
              // equality / string-match rules still work. Mirrors the value
              // coercion in DBNumberChart.
              //
              // react-table types the getter as `number`, but the runtime
              // value can be a string (see above), so read it through
              // `unknown` to narrow honestly without an unsafe cast.
              const cellValue: unknown = value;
              const primitiveValue =
                typeof cellValue === 'number' || typeof cellValue === 'string'
                  ? cellValue
                  : null;
              const colorValue =
                typeof primitiveValue === 'string' &&
                primitiveValue.trim() !== '' &&
                Number.isFinite(Number(primitiveValue))
                  ? Number(primitiveValue)
                  : primitiveValue;
              const resolvedColorToken = resolveConditionalColor(
                colorValue,
                colorRules,
                color,
              );
              // Guard the CSS resolver: it throws on an unrecognized token,
              // so an unknown / legacy token (e.g. a hand-edited config)
              // renders with the default color instead of crashing the cell.
              const colorStyle =
                resolvedColorToken && isChartPaletteToken(resolvedColorToken)
                  ? { color: getColorFromCSSToken(resolvedColorToken) }
                  : undefined;

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
                  if (action.external) {
                    return (
                      <a
                        href={action.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={interactiveClassName}
                        data-testid="dashboard-table-row-action"
                        data-shape="external-link"
                      >
                        {formattedValue}
                      </a>
                    );
                  }
                  // Use prefetch={false} so virtualization scroll doesn't
                  // trigger an N-row prefetch storm against /search? and
                  // /dashboards/ routes the user usually never opens.
                  return (
                    <Link
                      href={action.url}
                      prefetch={false}
                      className={interactiveClassName}
                      style={colorStyle}
                      data-testid="dashboard-table-row-action"
                      data-shape="link"
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
                // notification toast on left-click. focusStyles.cellButton
                // resets the user-agent button defaults (padding, font,
                // color, text-align, line-height) so the wrapper renders
                // identically to the success-row <Link>.
                return (
                  <button
                    type="button"
                    className={cx(interactiveClassName, focusStyles.cellButton)}
                    style={colorStyle}
                    onClick={action.onClickError}
                    data-testid="dashboard-table-row-action"
                    data-shape="button"
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
                      style={colorStyle}
                      data-testid="dashboard-table-row-action"
                      data-shape="link"
                    >
                      {formattedValue}
                    </Link>
                  );
                }
              }

              return (
                <div className={className} style={colorStyle}>
                  {formattedValue}
                </div>
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
            // Body cells include positioned elements (e.g. the
            // position: relative `.lastCell`), which otherwise paint on
            // top of the sticky header as rows scroll underneath it.
            // A stacking context above those cells keeps the header on
            // top. Mirrors the log table's sticky head (LogTable.module.scss).
            zIndex: 2,
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
            // Compute the action once per row so the trailing-icon hint
            // shares the memoized result from useOnClickLinkBuilder with
            // the per-cell renders. The hook keys its cache off the row
            // reference via WeakMap (see useOnClickLinkBuilder), so this
            // extra call is an O(1) lookup when the per-cell renders
            // populate the entry first, and one extra compute per row
            // only when the WeakMap entry is cold (e.g. fresh data).
            const rowAction = getRowAction ? getRowAction(row.original) : null;
            // Narrow `rowAction.url` to a non-null `string` once per row so
            // the trailing-icon guard below (and the `<Link href={...}>`
            // sink inside it) doesn't need an `as string` cast and stays
            // type-safe under future changes to the `RowAction` shape.
            const actionUrl = rowAction?.url ?? null;
            const isActionable = actionUrl !== null;
            const visibleCells = row.getVisibleCells();
            const lastCellIndex = visibleCells.length - 1;
            return (
              <tr
                key={virtualRow.key}
                className={cx(styles.tableRow, {
                  // Actionable rows get the stronger `--color-bg-highlighted`
                  // hover via `.actionableRow`; everything else falls back
                  // to the global `bg-muted-hover` utility.
                  [styles.actionableRow]: isActionable,
                  'bg-muted-hover': !isActionable,
                })}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
              >
                {visibleCells.map((cell, cellIndex) => {
                  const isLastCell = cellIndex === lastCellIndex;
                  return (
                    <td
                      key={cell.id}
                      title={`${cell.getValue()}`}
                      className={cx({
                        [styles.lastCell]: isLastCell,
                      })}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                      {/* Trailing arrow hint: anchored Mantine Tooltip
                          wrapping a Next.js Link in the last cell of
                          rows that resolve to a URL. The icon is hidden
                          (opacity: 0) by default and revealed on row
                          hover via the .tableRow:hover .rowActionHint
                          rule. The Link inherits the same native
                          cmd-click / middle-click / right-click
                          semantics as the per-cell Link in the row body.
                          Suppressed when the row's templates failed
                          (rowAction.url === null) so the icon never
                          promises a destination the click won't open.
                          The arrow-up-right shape signals "navigate
                          elsewhere" without colliding with the
                          chevron-right used by sidebar group collapse
                          / expand affordances. See HDX-4405. */}
                      {isLastCell && actionUrl !== null && rowAction && (
                        <Tooltip
                          label={rowAction.description}
                          position="left"
                          withArrow
                          openDelay={300}
                          closeDelay={100}
                          fz="xs"
                        >
                          {rowAction.external ? (
                            <a
                              href={actionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              tabIndex={-1}
                              aria-hidden="true"
                              className={styles.rowActionHint}
                              data-testid="row-action-hint"
                            >
                              <IconArrowUpRight size={14} />
                            </a>
                          ) : (
                            <Link
                              href={actionUrl}
                              prefetch={false}
                              tabIndex={-1}
                              aria-hidden="true"
                              className={styles.rowActionHint}
                              data-testid="row-action-hint"
                            >
                              <IconArrowUpRight size={14} />
                            </Link>
                          )}
                        </Tooltip>
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
      {isTruncated && (
        <div className="p-2 text-center">
          Showing the first {MAX_TABLE_ROWS} rows.
        </div>
      )}
      {tableBottom}
    </div>
  );
};
