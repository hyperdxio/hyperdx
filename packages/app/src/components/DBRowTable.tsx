import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import curry from 'lodash/curry';
import { Button, Modal } from 'react-bootstrap';
import { CSVLink } from 'react-csv';
import { useHotkeys } from 'react-hotkeys-hook';
import { Box, Code, Flex, Text } from '@mantine/core';
import { FetchNextPageOptions } from '@tanstack/react-query';
import {
  ColumnDef,
  ColumnResizeMode,
  flexRender,
  getCoreRowModel,
  Row as TableRow,
  TableOptions,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import {
  ClickHouseQueryError,
  convertCHDataTypeToJSType,
  extractColumnReference,
  JSDataType,
} from '@/clickhouse';
import { useTableMetadata } from '@/hooks/useMetadata';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere from '@/hooks/useRowWhere';
import { ChartConfigWithDateRange } from '@/renderChartConfig';
import { SelectList } from '@/sqlTypes';
import { UNDEFINED_WIDTH } from '@/tableUtils';
import { FormatTime } from '@/useFormatTime';
import { useUserPreferences } from '@/useUserPreferences';
import {
  getLogLevelClass,
  useLocalStorage,
  usePrevious,
  useWindowSize,
} from '@/utils';

import { SQLPreview } from './ChartSQLPreview';
import LogLevel from './LogLevel';

import styles from '../../styles/LogTable.module.scss';
type Row = Record<string, any> & { duration: number };
type AccessorFn = (row: Row, column: string) => any;

const SPECIAL_VALUES = {
  not_available: 'NULL',
};
const ACCESSOR_MAP: Record<string, AccessorFn> = {
  duration: row =>
    row.duration >= 0 ? row.duration : SPECIAL_VALUES.not_available,
  default: (row, column) => row[column],
};

const MAX_SCROLL_FETCH_LINES = 1000;
const MAX_CELL_LENGTH = 500;

function retrieveColumnValue(column: string, row: Row): any {
  const accessor = ACCESSOR_MAP[column] ?? ACCESSOR_MAP.default;
  return accessor(row, column);
}

function inferLogLevelColumn(rows: Record<string, any>[]) {
  const MAX_ROWS_TO_INSPECT = 100;
  const levelCounts: Record<string, number> = {};
  const inspectRowCount = Math.min(rows.length, MAX_ROWS_TO_INSPECT);
  for (let i = 0; i < inspectRowCount; i++) {
    const row = rows[i];
    Object.keys(row).forEach(key => {
      const value = row[key];
      if (
        (value?.length || 0) > 0 &&
        (value?.length || 0) < 512 && // avoid inspecting long strings
        getLogLevelClass(value) != null
      ) {
        levelCounts[key] = (levelCounts[key] ?? 0) + 1;
      }
    });
  }

  let maxCount = 0;
  let maxKey = '';
  for (const [key, count] of Object.entries(levelCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxKey = key;
    }
  }

  if (maxCount > 0) {
    return maxKey;
  }

  return undefined;
}

export const RawLogTable = memo(
  ({
    tableId,
    displayedColumns,
    fetchNextPage,
    hasNextPage,
    highlightedLineId,
    isLive,
    isLoading,
    rows,
    generateRowId,
    onInstructionsClick,
    // onPropertySearchClick,
    onRowExpandClick,
    onScroll,
    onSettingsClick,
    onShowPatternsClick,
    wrapLines,
    columnNameMap,
    showServiceColumn = true,
    dedupRows,
    isError,
    error,
    columnTypeMap,
  }: {
    wrapLines: boolean;
    displayedColumns: string[];
    onSettingsClick?: () => void;
    onInstructionsClick?: () => void;
    rows: Record<string, any>[];
    isLoading: boolean;
    fetchNextPage: (options?: FetchNextPageOptions | undefined) => any;
    onRowExpandClick: (row: Record<string, any>) => void;
    generateRowId: (row: Record<string, any>) => string;
    // onPropertySearchClick: (
    //   name: string,
    //   value: string | number | boolean,
    // ) => void;
    hasNextPage: boolean;
    highlightedLineId: string | undefined;
    onScroll: (scrollTop: number) => void;
    isLive: boolean;
    onShowPatternsClick?: () => void;
    tableId?: string;
    columnNameMap?: Record<string, string>;
    showServiceColumn?: boolean;
    dedupRows?: boolean;
    columnTypeMap: Map<string, { _type: JSDataType | null }>;

    isError?: boolean;
    error?: ClickHouseQueryError | Error;
  }) => {
    const generateRowMatcher = generateRowId;

    const dedupedRows = useMemo(() => {
      const lIds = new Set();
      const returnedRows = dedupRows
        ? rows.filter(l => {
            const matcher = generateRowMatcher(l);
            if (lIds.has(matcher)) {
              return false;
            }
            lIds.add(matcher);
            return true;
          })
        : rows;

      return returnedRows.map(r => ({
        ...r,
        __hyperdx_id: generateRowMatcher(r),
      }));
    }, [rows, dedupRows, generateRowMatcher]);

    const _onRowExpandClick = useCallback(
      ({ __hyperdx_id, ...row }: Record<string, any>) => {
        onRowExpandClick(row);
      },
      [onRowExpandClick],
    );

    const { width } = useWindowSize();
    const isSmallScreen = (width ?? 1000) < 900;
    const {
      userPreferences: { isUTC },
    } = useUserPreferences();

    const [columnSizeStorage, setColumnSizeStorage] = useLocalStorage<
      Record<string, number>
    >(`${tableId}-column-sizes`, {});

    //once the user has scrolled within 500px of the bottom of the table, fetch more data if there is any
    const FETCH_NEXT_PAGE_PX = 500;

    //we need a reference to the scrolling element for logic down below
    const tableContainerRef = useRef<HTMLDivElement>(null);

    // Reset scroll when live tail is enabled for the first time
    const prevIsLive = usePrevious(isLive);
    useEffect(() => {
      if (isLive && prevIsLive === false && tableContainerRef.current != null) {
        tableContainerRef.current.scrollTop = 0;
      }
    }, [isLive, prevIsLive]);

    const logLevelColumn = useMemo(() => {
      return inferLogLevelColumn(dedupedRows);
    }, [dedupedRows]);

    const columns = useMemo<ColumnDef<any>[]>(
      () => [
        {
          id: 'expand-btn',
          accessorKey: '__hyperdx_id',
          header: () => '',
          cell: info => {
            return (
              <div
                role="button"
                className={cx('cursor-pointer', {
                  'text-success': highlightedLineId === info.getValue(),
                  'text-muted-hover': highlightedLineId !== info.getValue(),
                })}
                onMouseDown={e => {
                  // For some reason this interfers with the onclick handler
                  // inside a dashboard tile
                  e.stopPropagation();
                }}
                onClick={() => {
                  _onRowExpandClick(info.row.original);
                }}
              >
                <span className="bi bi-chevron-right" />
              </div>
            );
          },
          size: 8,
          enableResizing: false,
        },
        ...(displayedColumns.map((column, i) => {
          const jsColumnType = columnTypeMap.get(column)?._type;
          const isDate = jsColumnType === JSDataType.Date;
          return {
            meta: {
              column,
              jsColumnType,
            },
            accessorFn: curry(retrieveColumnValue)(column), // Columns can contain '.' and will not work with accessorKey
            header: `${columnNameMap?.[column] ?? column}${isDate ? (isUTC ? ' (UTC)' : ' (Local)') : ''}`,
            cell: info => {
              const value = info.getValue<any>(); // This can be any type realistically (numbers, strings, etc.)

              if (isDate) {
                const date = new Date(value);
                return (
                  <span className="text-muted">
                    <FormatTime value={date} format="withMs" />
                  </span>
                );
              }

              const strValue = typeof value === 'string' ? value : `${value}`;

              if (column === logLevelColumn) {
                return <LogLevel level={strValue} />;
              }

              const truncatedStrValue =
                strValue.length > MAX_CELL_LENGTH
                  ? `${strValue.slice(0, MAX_CELL_LENGTH)}...`
                  : strValue;

              return (
                <span
                  className={cx({
                    'text-muted': value === SPECIAL_VALUES.not_available,
                  })}
                >
                  {truncatedStrValue}
                </span>
              );
            },
            size:
              i === displayedColumns.length - 1
                ? UNDEFINED_WIDTH // last column is always whatever is left
                : (columnSizeStorage[column] ?? 150),
          };
        }) as ColumnDef<any>[]),
      ],
      [
        isUTC,
        highlightedLineId,
        _onRowExpandClick,
        displayedColumns,
        columnSizeStorage,
        columnNameMap,
        columnTypeMap,
        logLevelColumn,
      ],
    );

    //called on scroll and possibly on mount to fetch more data as the user scrolls and reaches bottom of table
    const fetchMoreOnBottomReached = useCallback(
      (containerRefElement?: HTMLDivElement | null) => {
        if (containerRefElement) {
          const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
          if (
            scrollHeight - scrollTop - clientHeight < FETCH_NEXT_PAGE_PX &&
            !isLoading &&
            hasNextPage
          ) {
            // Cancel refetch is important to ensure we wait for the last fetch to finish
            fetchNextPage({ cancelRefetch: false });
          }
        }
      },
      [fetchNextPage, isLoading, hasNextPage],
    );

    //a check on mount and after a fetch to see if the table is already scrolled to the bottom and immediately needs to fetch more data
    useEffect(() => {
      fetchMoreOnBottomReached(tableContainerRef.current);
    }, [fetchMoreOnBottomReached]);

    const reactTableProps = useMemo((): TableOptions<any> => {
      //TODO: fix any
      const onColumnSizingChange = (updaterOrValue: any) => {
        const state =
          updaterOrValue instanceof Function
            ? updaterOrValue()
            : updaterOrValue;
        setColumnSizeStorage({ ...columnSizeStorage, ...state });
      };

      const initReactTableProps = {
        data: dedupedRows,
        columns,
        getCoreRowModel: getCoreRowModel(),
        // debugTable: true,
        enableColumnResizing: true,
        columnResizeMode: 'onChange' as ColumnResizeMode,
      };

      const columnSizeProps = {
        state: {
          columnSizing: columnSizeStorage,
        },
        onColumnSizingChange: onColumnSizingChange,
      };

      return tableId
        ? { ...initReactTableProps, ...columnSizeProps }
        : initReactTableProps;
    }, [
      columns,
      dedupedRows,
      tableId,
      columnSizeStorage,
      setColumnSizeStorage,
    ]);

    const table = useReactTable(reactTableProps);

    const { rows: _rows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
      count: _rows.length,
      // count: hasNextPage ? allRows.length + 1 : allRows.length,
      getScrollElement: () => tableContainerRef.current,
      estimateSize: useCallback(() => 23, []),
      overscan: 30,
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

    // Scroll to log id if it's not in window yet
    const [scrolledToHighlightedLine, setScrolledToHighlightedLine] =
      useState(false);

    useEffect(() => {
      if (
        scrolledToHighlightedLine ||
        highlightedLineId == null ||
        rowVirtualizer == null
      ) {
        return;
      }

      const rowIdx = dedupedRows.findIndex(
        l => l.__hyperdx_id === highlightedLineId,
      );
      if (rowIdx == -1) {
        if (
          dedupedRows.length < MAX_SCROLL_FETCH_LINES &&
          !isLoading &&
          hasNextPage
        ) {
          fetchNextPage({ cancelRefetch: false });
        }
      } else {
        setScrolledToHighlightedLine(true);
        if (
          rowVirtualizer.getVirtualItems().find(l => l.index === rowIdx) == null
        ) {
          rowVirtualizer.scrollToIndex(rowIdx, {
            align: 'center',
          });
        }
      }
    }, [
      dedupedRows,
      highlightedLineId,
      fetchNextPage,
      rowVirtualizer,
      scrolledToHighlightedLine,
      isLoading,
      hasNextPage,
    ]);

    const shiftHighlightedLineId = useCallback(
      (shift: number) => {
        if (highlightedLineId == null) {
          return;
        }

        const newIndex =
          dedupedRows.findIndex(l => l.__hyperdx_id === highlightedLineId) +
          shift;

        if (newIndex < 0 || newIndex >= dedupedRows.length) {
          return;
        }

        const newLine = dedupedRows[newIndex];

        _onRowExpandClick(newLine);
      },
      [highlightedLineId, _onRowExpandClick, dedupedRows],
    );

    useHotkeys(['ArrowRight', 'ArrowDown', 'j'], e => {
      e.preventDefault();
      shiftHighlightedLineId(1);
    });
    useHotkeys(['ArrowLeft', 'ArrowUp', 'k'], e => {
      e.preventDefault();
      shiftHighlightedLineId(-1);
    });

    return (
      <div
        className="overflow-auto h-100 fs-8 bg-inherit"
        onScroll={e => {
          fetchMoreOnBottomReached(e.target as HTMLDivElement);

          if (e.target != null) {
            const { scrollTop } = e.target as HTMLDivElement;
            onScroll(scrollTop);
          }
        }}
        ref={tableContainerRef}
        // Fixes flickering scroll bar: https://github.com/TanStack/virtual/issues/426#issuecomment-1403438040
        // style={{ overflowAnchor: 'none' }}
      >
        <table
          className="w-100 bg-inherit"
          id={tableId}
          style={{ tableLayout: 'fixed' }}
        >
          <thead className={styles.tableHead}>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, headerIndex) => {
                  return (
                    <th
                      className="overflow-hidden text-truncate bg-hdx-dark"
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
                          className={`resizer text-gray-600 cursor-col-resize ${
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
                      {headerIndex === headerGroup.headers.length - 1 && (
                        <div
                          className="d-flex align-items-center"
                          style={{
                            position: 'absolute',
                            right: 8,
                            top: 0,
                            bottom: 0,
                          }}
                        >
                          {tableId != null &&
                            Object.keys(columnSizeStorage).length > 0 && (
                              <div
                                className="fs-8 text-muted-hover disabled"
                                role="button"
                                onClick={() => setColumnSizeStorage({})}
                                title="Reset Column Widths"
                              >
                                <i className="bi bi-arrow-clockwise" />
                              </div>
                            )}
                          {onSettingsClick != null && (
                            <div
                              className="fs-8 text-muted-hover ms-2"
                              role="button"
                              onClick={() => onSettingsClick()}
                            >
                              <i className="bi bi-gear-fill" />
                            </div>
                          )}
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
              const row = _rows[virtualRow.index] as TableRow<any>;
              return (
                <tr
                  onClick={() => {
                    // onRowExpandClick(row.original.id, row.original.sort_key);
                    _onRowExpandClick(row.original);
                  }}
                  role="button"
                  key={virtualRow.key}
                  // TODO: Restore highlight
                  className={cx(styles.tableRow, {
                    [styles.tableRow__selected]:
                      highlightedLineId === row.original.__hyperdx_id,
                  })}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                >
                  {row.getVisibleCells().map(cell => {
                    return (
                      <td
                        key={cell.id}
                        className={cx('align-top overflow-hidden', {
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
                <div className="rounded fs-7 bg-grey text-center d-flex align-items-center justify-content-center mt-3">
                  {isLoading ? (
                    <div className="my-3">
                      <div className="spin-animate d-inline-block">
                        <i className="bi bi-arrow-repeat" />
                      </div>{' '}
                      Loading results...
                    </div>
                  ) : hasNextPage == false &&
                    isLoading == false &&
                    dedupedRows.length > 0 ? (
                    <div className="my-3">End of Results</div>
                  ) : isError ? (
                    <div className="my-3">
                      <Text ta="center" size="sm">
                        Error loading results, please check your query or try
                        again.
                      </Text>
                      <Box p="sm">
                        <Box mt="sm">
                          <Code
                            block
                            style={{
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {error?.message}
                          </Code>
                        </Box>
                        {error instanceof ClickHouseQueryError && (
                          <>
                            <Text my="sm" size="sm" ta="center">
                              Sent Query:
                            </Text>
                            <Flex
                              w="100%"
                              ta="initial"
                              align="center"
                              justify="center"
                            >
                              <SQLPreview data={error?.query} />
                            </Flex>
                          </>
                        )}
                      </Box>
                    </div>
                  ) : hasNextPage == false &&
                    isLoading == false &&
                    dedupedRows.length === 0 ? (
                    <div className="my-3">
                      No results found.
                      <div className="text-muted mt-3">
                        Try checking the query explainer in the search bar if
                        there are any search syntax issues.
                      </div>
                    </div>
                  ) : (
                    <div />
                  )}
                </div>
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

function mergeSelectWithPrimaryAndPartitionKey(
  select: SelectList,
  primaryKeys: string,
  partitionKey: string,
): { select: SelectList; additionalKeysLength: number } {
  const partitionKeyArr = partitionKey
    .split(',')
    .map(k => extractColumnReference(k.trim()))
    .filter((k): k is string => k != null && k.length > 0);
  const primaryKeyArr = primaryKeys.split(',').map(k => k.trim());
  const allKeys = [...partitionKeyArr, ...primaryKeyArr];
  if (typeof select === 'string') {
    const selectSplit = select
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const selectColumns = new Set(selectSplit);
    const additionalKeys = allKeys.filter(k => !selectColumns.has(k));
    return {
      select: [...selectColumns, ...additionalKeys].join(','),
      additionalKeysLength: additionalKeys.length,
    };
  } else {
    const additionalKeys = allKeys.map(k => ({ valueExpression: k }));
    return {
      select: [...select, ...additionalKeys],
      additionalKeysLength: additionalKeys.length,
    };
  }
}

function getSelectLength(select: SelectList): number {
  if (typeof select === 'string') {
    return select.split(',').filter(s => s.trim().length > 0).length;
  } else {
    return select.length;
  }
}

export function DBSqlRowTable({
  config,
  onRowExpandClick,
  highlightedLineId,
  enabled = true,
  isLive = false,
  queryKeyPrefix,
  onScroll,
}: {
  config: ChartConfigWithDateRange;
  onRowExpandClick: (where: string) => void;
  highlightedLineId: string | undefined;
  queryKeyPrefix?: string;
  enabled?: boolean;
  isLive?: boolean;
  onScroll: (scrollTop: number) => void;
}) {
  const { data: tableMetadata } = useTableMetadata({
    databaseName: config.from.databaseName,
    tableName: config.from.tableName,
    connectionId: config.connection,
  });

  const primaryKey = tableMetadata?.primary_key;
  const partitionKey = tableMetadata?.partition_key;

  const mergedConfig = useMemo(() => {
    if (primaryKey == null || partitionKey == null) {
      return undefined;
    }

    const { select, additionalKeysLength } =
      mergeSelectWithPrimaryAndPartitionKey(
        config.select,
        primaryKey,
        partitionKey,
      );
    return { ...config, select, additionalKeysLength };
  }, [primaryKey, partitionKey, config]);

  const { data, fetchNextPage, hasNextPage, isFetching, isError, error } =
    useOffsetPaginatedQuery(mergedConfig ?? config, {
      enabled:
        enabled && mergedConfig != null && getSelectLength(config.select) > 0,
      isLive,
      queryKeyPrefix,
    });

  // The first N columns are the select columns from the user
  // We can't use names as CH may rewrite the names
  // We have to do the subtraction here because the select length can
  // differ from returned columns (eg. SELECT *)
  // we have to subtract the additional key length as the pk merging
  // can dedup the columns between the user select and pk
  const selectMeta = useMemo(
    () =>
      data?.meta?.slice(
        0,
        (data?.meta?.length ?? 0) - (mergedConfig?.additionalKeysLength ?? 0),
      ) ?? [],
    [data, mergedConfig],
  );

  const columns = useMemo(
    () => selectMeta?.map(c => c.name) ?? [],
    [selectMeta],
  );
  const columnMap = useMemo(
    () =>
      new Map(
        selectMeta?.map(c => [
          c.name,
          {
            ...c,
            _type: convertCHDataTypeToJSType(c.type),
          },
        ]),
      ),
    [selectMeta],
  );

  // FIXME: do this on the db side ?
  // Or, the react-table should render object-type cells as JSON.stringify
  const objectTypeColumns = useMemo(() => {
    return columns.filter(c => {
      const columnType = columnMap.get(c)?._type;
      return columnType === JSDataType.Map || columnType === JSDataType.Array;
    });
  }, [columns, columnMap]);
  const processedRows = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.map(row => {
      const newRow = { ...row };
      objectTypeColumns.forEach(c => {
        newRow[c] = JSON.stringify(row[c]);
      });
      return newRow;
    });
  }, [data, objectTypeColumns]);

  const getRowWhere = useRowWhere({ meta: data?.meta });

  const _onRowExpandClick = useCallback(
    (row: Record<string, any>) => {
      return onRowExpandClick(getRowWhere(row));
    },
    [onRowExpandClick, getRowWhere],
  );

  return (
    <RawLogTable
      isLive={isLive}
      wrapLines={false}
      displayedColumns={columns}
      highlightedLineId={highlightedLineId}
      rows={processedRows}
      isLoading={isFetching}
      fetchNextPage={fetchNextPage}
      // onPropertySearchClick={onPropertySearchClick}
      hasNextPage={hasNextPage}
      onRowExpandClick={_onRowExpandClick}
      onScroll={onScroll}
      generateRowId={getRowWhere}
      isError={isError}
      error={error ?? undefined}
      columnTypeMap={columnMap}
    />
  );
}
