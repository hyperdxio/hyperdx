import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cx from 'classnames';
import { format, formatDistance } from 'date-fns';
import { isString } from 'lodash';
import curry from 'lodash/curry';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  ColumnMetaType,
  convertCHDataTypeToJSType,
  extractColumnReference,
  isJSDataTypeJSONStringifiable,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithDateRange,
  SelectList,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/utils';
import {
  Box,
  Code,
  Flex,
  Modal,
  Text,
  Tooltip as MantineTooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  FetchNextPageOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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

import api from '@/api';
import { searchChartConfigDefaults } from '@/defaults';
import { useRenderedSqlChartConfig } from '@/hooks/useChartConfig';
import { useCsvExport } from '@/hooks/useCsvExport';
import { useTableMetadata } from '@/hooks/useMetadata';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useGroupedPatterns } from '@/hooks/usePatterns';
import useRowWhere from '@/hooks/useRowWhere';
import { useSource } from '@/source';
import { UNDEFINED_WIDTH } from '@/tableUtils';
import { FormatTime } from '@/useFormatTime';
import { useUserPreferences } from '@/useUserPreferences';
import {
  getLogLevelClass,
  logLevelColor,
  useLocalStorage,
  usePrevious,
  useWindowSize,
} from '@/utils';

import { SQLPreview } from './ChartSQLPreview';
import { CsvExportButton } from './CsvExportButton';
import {
  createExpandButtonColumn,
  ExpandedLogRow,
  useExpandableRows,
} from './ExpandableRowTable';
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

const getRowId = (row: Record<string, any>): string => row.__hyperdx_id;

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
        isString(value) &&
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

const PatternTrendChartTooltip = (props: any) => {
  return null;
};

export const PatternTrendChart = ({
  data,
  dateRange,
  color,
}: {
  data: { bucket: string; count: number }[];
  dateRange: [Date, Date];
  color?: string;
}) => {
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
            data={data}
            syncId="hdx"
            syncMethod="value"
            margin={{ top: 4, left: 0, right: 4, bottom: 0 }}
          >
            <XAxis
              dataKey={'bucket'}
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
            <Bar
              isAnimationActive={false}
              dataKey="count"
              stackId="a"
              fill={color || '#20c997'}
              maxBarSize={24}
            />
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

const SqlModal = ({
  opened,
  onClose,
  config,
}: {
  opened: boolean;
  onClose: () => void;
  config: ChartConfigWithDateRange;
}) => {
  const { data: sql, isLoading: isLoadingSql } = useRenderedSqlChartConfig(
    config,
    {
      queryKey: ['SqlModal', config],
      placeholderData: prev => prev ?? '', // Avoid flicker when query changes (eg. when in live mode)
      enabled: opened,
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Generated SQL" size="auto">
      {sql ? (
        <SQLPreview data={sql} enableCopy={true} />
      ) : isLoadingSql ? (
        <div className="text-center my-2">
          <div className="spin-animate d-inline-block me-2">
            <i className="bi bi-arrow-repeat" />
          </div>
          Loading SQL...
        </div>
      ) : (
        <div className="text-center my-2">No SQL available</div>
      )}
    </Modal>
  );
};

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
    onRowDetailsClick,
    onScroll,
    onSettingsClick,
    onShowPatternsClick,
    wrapLines = false,
    columnNameMap,
    showServiceColumn = true,
    dedupRows,
    isError,
    error,
    columnTypeMap,
    dateRange,
    loadingDate,
    config,
    onChildModalOpen,
    renderRowDetails,
    source,
    onExpandedRowsChange,
    collapseAllRows,
    showExpandButton = true,
  }: {
    wrapLines: boolean;
    displayedColumns: string[];
    onSettingsClick?: () => void;
    onInstructionsClick?: () => void;
    rows: Record<string, any>[];
    isLoading?: boolean;
    fetchNextPage?: (options?: FetchNextPageOptions | undefined) => any;
    onRowDetailsClick: (row: Record<string, any>) => void;
    generateRowId: (row: Record<string, any>) => string;
    // onPropertySearchClick: (
    //   name: string,
    //   value: string | number | boolean,
    // ) => void;
    hasNextPage?: boolean;
    highlightedLineId?: string;
    onScroll?: (scrollTop: number) => void;
    isLive: boolean;
    onShowPatternsClick?: () => void;
    tableId?: string;
    columnNameMap?: Record<string, string>;
    showServiceColumn?: boolean;
    dedupRows?: boolean;
    columnTypeMap: Map<string, { _type: JSDataType | null }>;

    isError?: boolean;
    error?: ClickHouseQueryError | Error;
    dateRange?: [Date, Date];
    loadingDate?: Date;
    config?: ChartConfigWithDateRange;
    onChildModalOpen?: (open: boolean) => void;
    source?: TSource;
    onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
    collapseAllRows?: boolean;
    showExpandButton?: boolean;
    renderRowDetails?: (row: Record<string, any>) => React.ReactNode;
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
        onRowDetailsClick?.(row);
      },
      [onRowDetailsClick],
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

    const { csvData, maxRows, isLimited } = useCsvExport(
      dedupedRows,
      displayedColumns.map(col => ({
        dataKey: col,
        displayName: columnNameMap?.[col] ?? col,
      })),
    );

    // Expandable rows functionality
    const {
      expandedRows,
      toggleRowExpansion,
      collapseAllRows: collapseRows,
    } = useExpandableRows(onExpandedRowsChange);

    // Effect to collapse all rows when requested by parent
    useEffect(() => {
      if (collapseAllRows) {
        collapseRows();
      }
    }, [collapseAllRows, collapseRows]);

    const columns = useMemo<ColumnDef<any>[]>(
      () => [
        ...(showExpandButton
          ? [
              createExpandButtonColumn(
                expandedRows,
                toggleRowExpansion,
                highlightedLineId,
              ),
            ]
          : []),
        ...(displayedColumns.map((column, i) => {
          const jsColumnType = columnTypeMap.get(column)?._type;
          const isDate = jsColumnType === JSDataType.Date;
          const isMaybeSeverityText = column === logLevelColumn;
          return {
            meta: {
              column,
              jsColumnType,
            },
            accessorFn: curry(retrieveColumnValue)(column), // Columns can contain '.' and will not work with accessorKey
            header: `${columnNameMap?.[column] ?? column}${isDate ? (isUTC ? ' (UTC)' : ' (Local)') : ''}`,
            cell: info => {
              const value = info.getValue<any>(); // This can be any type realistically (numbers, strings, etc.)

              if (column === '__hdx_pattern_trend') {
                return (
                  <div style={{ height: 50, width: '100%' }}>
                    <PatternTrendChart
                      data={value.data}
                      dateRange={value.dateRange}
                      color={logLevelColor(info.row.original.severityText)}
                    />
                  </div>
                );
              }

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
                : (columnSizeStorage[column] ??
                  (isDate ? 170 : isMaybeSeverityText ? 115 : 160)),
          };
        }) as ColumnDef<any>[]),
      ],
      [
        isUTC,
        highlightedLineId,
        displayedColumns,
        columnSizeStorage,
        columnNameMap,
        columnTypeMap,
        logLevelColumn,
        expandedRows,
        toggleRowExpansion,
        showExpandButton,
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
            fetchNextPage?.({ cancelRefetch: false });
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
    const [wrapLinesEnabled, setWrapLinesEnabled] = useState(wrapLines);
    const [showSql, setShowSql] = useState(false);

    const handleSqlModalOpen = (open: boolean) => {
      setShowSql(open);
      onChildModalOpen?.(open);
    };

    useEffect(() => {
      if (
        scrolledToHighlightedLine ||
        !highlightedLineId ||
        rowVirtualizer == null
      ) {
        return;
      }

      const rowIdx = dedupedRows.findIndex(
        l => getRowId(l) === highlightedLineId,
      );
      if (rowIdx == -1 && highlightedLineId) {
        if (
          dedupedRows.length < MAX_SCROLL_FETCH_LINES &&
          !isLoading &&
          hasNextPage
        ) {
          fetchNextPage?.({ cancelRefetch: false });
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
          dedupedRows.findIndex(l => getRowId(l) === highlightedLineId) + shift;

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
            onScroll?.(scrollTop);
          }
        }}
        ref={tableContainerRef}
        // Fixes flickering scroll bar: https://github.com/TanStack/virtual/issues/426#issuecomment-1403438040
        // style={{ overflowAnchor: 'none' }}
      >
        {config && (
          <SqlModal
            opened={showSql}
            onClose={() => handleSqlModalOpen(false)}
            config={config}
          />
        )}
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
                      {header.column.getCanResize() &&
                        headerIndex !== headerGroup.headers.length - 1 && (
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
                          {config && (
                            <UnstyledButton
                              onClick={() => handleSqlModalOpen(true)}
                            >
                              <MantineTooltip label="Show generated SQL">
                                <i className="bi bi-code-square" />
                              </MantineTooltip>
                            </UnstyledButton>
                          )}
                          <UnstyledButton
                            onClick={() => setWrapLinesEnabled(prev => !prev)}
                            className="ms-2"
                          >
                            <MantineTooltip label="Wrap lines">
                              <i className="bi bi-text-wrap" />
                            </MantineTooltip>
                          </UnstyledButton>

                          <CsvExportButton
                            data={csvData}
                            filename={`hyperdx_search_results_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`}
                            className="fs-6 text-muted-hover ms-2"
                          >
                            <MantineTooltip
                              label={`Download table as CSV (max ${maxRows.toLocaleString()} rows)${isLimited ? ' - data truncated' : ''}`}
                            >
                              <i className="bi bi-download" />
                            </MantineTooltip>
                          </CsvExportButton>
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
              const rowId = getRowId(row.original);
              const isExpanded = expandedRows[rowId] ?? false;

              return (
                <React.Fragment key={virtualRow.key}>
                  <tr
                    data-testid={`table-row-${rowId}`}
                    onClick={() => {
                      _onRowExpandClick(row.original);
                    }}
                    role="button"
                    // TODO: Restore highlight
                    className={cx(styles.tableRow, {
                      [styles.tableRow__selected]:
                        highlightedLineId && highlightedLineId === rowId,
                    })}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                  >
                    {row.getVisibleCells().map(cell => {
                      return (
                        <td
                          key={cell.id}
                          className={cx('align-top overflow-hidden', {
                            'text-break': wrapLinesEnabled,
                            'text-truncate': !wrapLinesEnabled,
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
                  {showExpandButton && isExpanded && (
                    <ExpandedLogRow
                      columnsLength={columns.length}
                      virtualKey={virtualRow.key.toString()}
                      source={source}
                      rowId={rowId}
                      measureElement={rowVirtualizer.measureElement}
                      virtualIndex={virtualRow.index}
                    >
                      {renderRowDetails?.({
                        id: rowId,
                        ...row.original,
                      })}
                    </ExpandedLogRow>
                  )}
                </React.Fragment>
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
                      {loadingDate != null && (
                        <>
                          Searched <FormatTime value={loadingDate} />.{' '}
                        </>
                      )}
                      Loading results
                      {dateRange?.[0] != null && dateRange?.[1] != null ? (
                        <>
                          {' '}
                          across{' '}
                          {formatDistance(dateRange?.[1], dateRange?.[0])} {'('}
                          <FormatTime
                            value={dateRange?.[0]}
                            format="withYear"
                          />{' '}
                          to{' '}
                          <FormatTime
                            value={dateRange?.[1]}
                            format="withYear"
                          />
                          {')'}
                        </>
                      ) : null}
                      ...
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
                      <Text mt="sm" c="gray.3">
                        Try checking the query explainer in the search bar if
                        there are any search syntax issues.
                      </Text>
                      {dateRange?.[0] != null && dateRange?.[1] != null ? (
                        <Text mt="sm" c="gray.3">
                          Searched Time Range:{' '}
                          {formatDistance(dateRange?.[1], dateRange?.[0])} {'('}
                          <FormatTime
                            value={dateRange?.[0]}
                            format="withYear"
                          />{' '}
                          to{' '}
                          <FormatTime
                            value={dateRange?.[1]}
                            format="withYear"
                          />
                          {')'}
                        </Text>
                      ) : null}
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

function appendSelectWithPrimaryAndPartitionKey(
  select: SelectList,
  primaryKeys: string,
  partitionKey: string,
): { select: SelectList; additionalKeysLength: number } {
  const partitionKeyArr = partitionKey
    .split(',')
    .map(k => extractColumnReference(k.trim()))
    .filter((k): k is string => k != null && k.length > 0);
  const primaryKeyArr =
    primaryKeys.trim() !== '' ? splitAndTrimWithBracket(primaryKeys) : [];
  const allKeys = [...partitionKeyArr, ...primaryKeyArr];
  if (typeof select === 'string') {
    const selectSplit = splitAndTrimWithBracket(select);
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

export function useConfigWithPrimaryAndPartitionKey(
  config: ChartConfigWithDateRange,
) {
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
      appendSelectWithPrimaryAndPartitionKey(
        config.select,
        primaryKey,
        partitionKey,
      );
    return { ...config, select, additionalKeysLength };
  }, [primaryKey, partitionKey, config]);

  return mergedConfig;
}

export function selectColumnMapWithoutAdditionalKeys(
  selectMeta: ColumnMetaType[] | undefined,
  additionalKeysLength: number | undefined,
): Map<
  string,
  {
    _type: JSDataType | null;
  }
> {
  if (selectMeta == null || additionalKeysLength == null) {
    return new Map();
  }
  const sm = selectMeta.slice(0, selectMeta.length - additionalKeysLength);

  return new Map(
    sm?.map(c => [
      c.name,
      {
        ...c,
        _type: convertCHDataTypeToJSType(c.type),
      },
    ]),
  );
}

function DBSqlRowTableComponent({
  config,
  sourceId,
  onError,
  onRowDetailsClick,
  highlightedLineId,
  enabled = true,
  isLive = false,
  queryKeyPrefix,
  onScroll,
  denoiseResults = false,
  onChildModalOpen,
  onExpandedRowsChange,
  collapseAllRows,
  showExpandButton = true,
  renderRowDetails,
}: {
  config: ChartConfigWithDateRange;
  sourceId?: string;
  onRowDetailsClick?: (where: string) => void;
  highlightedLineId?: string;
  queryKeyPrefix?: string;
  enabled?: boolean;
  isLive?: boolean;
  renderRowDetails?: (r: { [key: string]: unknown }) => React.ReactNode;
  onScroll?: (scrollTop: number) => void;
  onError?: (error: Error | ClickHouseQueryError) => void;
  denoiseResults?: boolean;
  onChildModalOpen?: (open: boolean) => void;
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
  collapseAllRows?: boolean;
  showExpandButton?: boolean;
}) {
  const { data: me } = api.useMe();
  const mergedConfig = useConfigWithPrimaryAndPartitionKey({
    ...searchChartConfigDefaults(me?.team),
    ...config,
  });

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
  const columnMap = useMemo(() => {
    return selectColumnMapWithoutAdditionalKeys(
      data?.meta,
      mergedConfig?.additionalKeysLength,
    );
  }, [data, mergedConfig]);

  const columns = useMemo(() => Array.from(columnMap.keys()), [columnMap]);

  // FIXME: do this on the db side ?
  // Or, the react-table should render object-type cells as JSON.stringify
  const objectTypeColumns = useMemo(() => {
    return columns.filter(c => {
      const columnType = columnMap.get(c)?._type;
      return isJSDataTypeJSONStringifiable(columnType);
    });
  }, [columns, columnMap]);
  const processedRows = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.map(row => {
      const newRow = { ...row };
      objectTypeColumns.forEach(c => {
        if (columnMap.get(c)?._type === JSDataType.JSON) {
          // special rule for json
          // for json {SomePath: /c}, CH will return {SomePath: \/c}
          // add this to make sure md5 get correct result
          newRow[c] = JSON.stringify(row[c]).replace(/\//g, '\\/');
        } else {
          newRow[c] = JSON.stringify(row[c]);
        }
      });
      return newRow;
    });
  }, [data, objectTypeColumns, columnMap]);

  const aliasMap = useMemo(
    () => chSqlToAliasMap(data?.chSql ?? { sql: '', params: {} }),
    [data],
  );

  const getRowWhere = useRowWhere({ meta: data?.meta, aliasMap });

  const _onRowDetailsClick = useCallback(
    (row: Record<string, any>) => {
      return onRowDetailsClick?.(getRowWhere(row));
    },
    [onRowDetailsClick, getRowWhere],
  );

  useEffect(() => {
    if (isError && onError && error) {
      onError(error);
    }
  }, [isError, onError, error]);

  const { data: source } = useSource({ id: sourceId });
  const patternColumn = columns[columns.length - 1];
  const groupedPatterns = useGroupedPatterns({
    config,
    samples: 10_000,
    bodyValueExpression: patternColumn ?? '',
    severityTextExpression: source?.severityTextExpression ?? '',
    totalCount: undefined,
    enabled: denoiseResults,
  });
  const noisyPatterns = useQuery({
    queryKey: ['noisy-patterns', config],
    queryFn: async () => {
      return Object.values(groupedPatterns.data).filter(
        p => p.count / (groupedPatterns.sampledRowCount ?? 1) > 0.1,
      );
    },
    enabled:
      denoiseResults &&
      groupedPatterns.data != null &&
      Object.values(groupedPatterns.data).length > 0 &&
      groupedPatterns.miner != null,
  });
  const noisyPatternIds = useMemo(() => {
    return noisyPatterns.data?.map(p => p.id) ?? [];
  }, [noisyPatterns.data]);

  const queryClient = useQueryClient();

  const denoisedRows = useQuery({
    queryKey: [
      'denoised-rows',
      config,
      processedRows,
      noisyPatternIds,
      patternColumn,
    ],
    queryFn: async () => {
      // No noisy patterns, so no need to denoise
      if (noisyPatternIds.length === 0) {
        return processedRows;
      }

      const matchedLogs = await groupedPatterns.miner?.matchLogs(
        processedRows.map(row => row[patternColumn]),
      );
      return processedRows.filter((row, i) => {
        const match = matchedLogs?.[i];
        return !noisyPatternIds.includes(`${match}`);
      });
    },
    placeholderData: (previousData, previousQuery) => {
      // If it's the same search, but new data, return the previous data while we load
      if (
        previousQuery?.queryKey?.[0] === 'denoised-rows' &&
        previousQuery?.queryKey?.[1] === config
      ) {
        return previousData;
      }
      return undefined;
    },
    enabled:
      denoiseResults &&
      noisyPatterns.isSuccess &&
      processedRows.length > 0 &&
      groupedPatterns.miner != null,
  });

  const isLoading = denoiseResults
    ? isFetching ||
      denoisedRows.isFetching ||
      noisyPatterns.isFetching ||
      groupedPatterns.isLoading
    : isFetching;

  return (
    <>
      {denoiseResults && (
        <Box mb="xxs" px="sm" mt="-24px">
          <Text fw="bold" fz="xs" mb="xxs">
            Removed Noisy Event Patterns
          </Text>
          <Box mah={100} style={{ overflow: 'auto' }}>
            {noisyPatterns.data?.map(p => (
              <Text c="gray.3" fz="xs" key={p.id}>
                {p.pattern}
              </Text>
            ))}
            {noisyPatternIds.length === 0 && (
              <Text c="gray.3" fz="xs">
                No noisy patterns found
              </Text>
            )}
          </Box>
        </Box>
      )}
      <RawLogTable
        isLive={isLive}
        wrapLines={false}
        displayedColumns={columns}
        highlightedLineId={highlightedLineId}
        rows={denoiseResults ? (denoisedRows?.data ?? []) : processedRows}
        renderRowDetails={renderRowDetails}
        isLoading={isLoading}
        fetchNextPage={fetchNextPage}
        // onPropertySearchClick={onPropertySearchClick}
        hasNextPage={hasNextPage}
        onRowDetailsClick={_onRowDetailsClick}
        onScroll={onScroll}
        generateRowId={getRowWhere}
        isError={isError}
        error={error ?? undefined}
        columnTypeMap={columnMap}
        dateRange={config.dateRange}
        loadingDate={data?.window?.startTime}
        config={config}
        onChildModalOpen={onChildModalOpen}
        source={source}
        onExpandedRowsChange={onExpandedRowsChange}
        collapseAllRows={collapseAllRows}
        showExpandButton={showExpandButton}
      />
    </>
  );
}
export const DBSqlRowTable = memo(DBSqlRowTableComponent);
