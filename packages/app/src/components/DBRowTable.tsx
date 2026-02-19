import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cx from 'classnames';
import { formatDistance } from 'date-fns';
import { isString } from 'lodash';
import curry from 'lodash/curry';
import ms from 'ms';
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
  extractColumnReferencesFromKey,
  isJSDataTypeJSONStringifiable,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  SelectList,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Code,
  Flex,
  Group,
  Modal,
  Text,
  Tooltip as MantineTooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCode,
  IconDownload,
  IconRefresh,
  IconRotateClockwise,
  IconSettings,
  IconTextWrap,
  IconTextWrapDisabled,
} from '@tabler/icons-react';
import { FetchNextPageOptions, useQuery } from '@tanstack/react-query';
import {
  ColumnDef,
  ColumnResizeMode,
  flexRender,
  getCoreRowModel,
  Row as TableRow,
  SortingState,
  TableOptions,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from '@/api';
import { searchChartConfigDefaults } from '@/defaults';
import {
  useAliasMapFromChartConfig,
  useRenderedSqlChartConfig,
} from '@/hooks/useChartConfig';
import { useCsvExport } from '@/hooks/useCsvExport';
import { useTableMetadata } from '@/hooks/useMetadata';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useGroupedPatterns } from '@/hooks/usePatterns';
import useRowWhere, {
  INTERNAL_ROW_FIELDS,
  RowWhereResult,
  WithClause,
} from '@/hooks/useRowWhere';
import { useTableSearch } from '@/hooks/useTableSearch';
import { useSource } from '@/source';
import { UNDEFINED_WIDTH } from '@/tableUtils';
import { FormatTime } from '@/useFormatTime';
import { useUserPreferences } from '@/useUserPreferences';
import {
  COLORS,
  getLogLevelClass,
  logLevelColor,
  useLocalStorage,
  usePrevious,
} from '@/utils';

import DBRowTableFieldWithPopover from './DBTable/DBRowTableFieldWithPopover';
import DBRowTableRowButtons from './DBTable/DBRowTableRowButtons';
import TableHeader from './DBTable/TableHeader';
import {
  highlightText,
  TableSearchInput,
  TableSearchMatchIndicator,
} from './DBTable/TableSearchInput';
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
  severityText: row => row.severityText ?? row.statusCode,
  default: (row, column) => row[column],
};

const MAX_SCROLL_FETCH_LINES = 1000;
const MAX_CELL_LENGTH = 500;

const getRowId = (row: Record<string, any>): string =>
  row[INTERNAL_ROW_FIELDS.ID];

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

const PatternTrendChartTooltip = () => {
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
              tickFormatter={() => ''}
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
              fill={color || COLORS[0]}
              maxBarSize={24}
            />
            {/* <Line
              key={'count'}
              type="monotone"
              dataKey={'count'}
              stroke={COLORS[0]}
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
          <div className="d-inline-block me-2">
            <IconRefresh size={14} className="spin-animate" />
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
    enableSorting = false,
    onSortingChange,
    sortOrder,
    showExpandButton = true,
    getRowWhere,
    variant = 'default',
  }: {
    wrapLines?: boolean;
    displayedColumns: string[];
    onSettingsClick?: () => void;
    onInstructionsClick?: () => void;
    rows: Record<string, any>[];
    isLoading?: boolean;
    fetchNextPage?: (options?: FetchNextPageOptions | undefined) => any;
    onRowDetailsClick: (row: Record<string, any>) => void;
    generateRowId: (row: Record<string, any>) => RowWhereResult;
    // onPropertySearchClick: (
    //   name: string,
    //   value: string | number | boolean,
    // ) => void;
    hasNextPage?: boolean;
    highlightedLineId?: string;
    onScroll?: (scrollTop: number) => void;
    isLive?: boolean;
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
    renderRowDetails?: (row: {
      id: string;
      aliasWith?: WithClause[];
      [key: string]: any;
    }) => React.ReactNode;
    enableSorting?: boolean;
    sortOrder?: SortingState;
    onSortingChange?: (v: SortingState | null) => void;
    getRowWhere?: (row: Record<string, any>) => RowWhereResult;
    variant?: DBRowTableVariant;
  }) => {
    const dedupedRows = useMemo(() => {
      const lIds = new Set();
      const returnedRows = dedupRows
        ? rows.filter(l => {
            const rowWhereResult = generateRowId(l);
            if (lIds.has(rowWhereResult.where)) {
              return false;
            }
            lIds.add(rowWhereResult.where);
            return true;
          })
        : rows;

      return returnedRows.map(r => {
        const rowWhereResult = generateRowId(r);
        return {
          ...r,
          [INTERNAL_ROW_FIELDS.ID]: rowWhereResult.where,
          [INTERNAL_ROW_FIELDS.ALIAS_WITH]: rowWhereResult.aliasWith,
        };
      });
    }, [rows, dedupRows, generateRowId]);

    const _onRowExpandClick = useCallback(
      (row: Record<string, any>) => {
        onRowDetailsClick?.(row);
      },
      [onRowDetailsClick],
    );

    const {
      userPreferences: { isUTC },
    } = useUserPreferences();

    const [columnSizeStorage, setColumnSizeStorage] = useLocalStorage<
      Record<string, number>
    >(`${tableId}-column-sizes`, {});

    //once the user has scrolled within 500px of the bottom of the table, fetch more data if there is any
    const FETCH_NEXT_PAGE_PX = 500;

    //we need a reference to the scrolling element for logic down below
    const [tableContainerRef, setTableContainerRef] =
      useState<HTMLDivElement | null>(null);
    const tableContainerRefCallback = useCallback(
      (node: HTMLDivElement): (() => void) => {
        if (node) {
          setTableContainerRef(node);
        }
        return () => {
          setTableContainerRef(null);
        };
      },
      [],
    );

    // Get the alias map from the config so we resolve correct column ids
    const { data: aliasMap } = useAliasMapFromChartConfig(config);

    // Reset scroll when live tail is enabled for the first time
    const prevIsLive = usePrevious(isLive);
    useEffect(() => {
      if (isLive && prevIsLive === false && tableContainerRef != null) {
        tableContainerRef.scrollTop = 0;
      }
    }, [isLive, prevIsLive, tableContainerRef]);

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

    // Find within page functionality using custom hook
    const tableSearch = useTableSearch({
      rows: dedupedRows,
      searchableColumns: displayedColumns,
      debounceMs: 300,
    });

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
            // If the column is an alias, wrap in quotes.
            id: aliasMap?.[column] ? `"${column}"` : column,
            // TODO: add support for sorting on Dynamic JSON fields
            enableSorting: jsColumnType !== JSDataType.Dynamic,
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
                      color={logLevelColor(
                        info.row.original.severityText ??
                          info.row.original.statusCode,
                      )}
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

              // Apply search highlighting if there's a search query
              // Use React Table's row index which corresponds to dedupedRows index
              const isCurrentMatch =
                !!tableSearch.searchQuery &&
                tableSearch.matchIndices.length > 0 &&
                tableSearch.matchIndices[tableSearch.currentMatchIndex] ===
                  info.row.index;

              const displayValue = tableSearch.searchQuery
                ? highlightText(truncatedStrValue, tableSearch.searchQuery, {
                    isCurrentMatch,
                  })
                : truncatedStrValue;

              return (
                <span
                  className={cx({
                    'text-muted': value === SPECIAL_VALUES.not_available,
                  })}
                >
                  {displayValue}
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
        aliasMap,
        tableSearch.searchQuery,
        tableSearch.matchIndices,
        tableSearch.currentMatchIndex,
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
      fetchMoreOnBottomReached(tableContainerRef);
    }, [fetchMoreOnBottomReached, tableContainerRef]);

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
        enableSorting,
        manualSorting: true,
        onSortingChange: v => {
          if (typeof v === 'function') {
            const newSortVal = v(sortOrder ?? []);
            onSortingChange?.(newSortVal ?? null);
          } else {
            onSortingChange?.(v ?? null);
          }
        },
        state: {
          sorting: sortOrder ?? [],
        },
        enableColumnResizing: true,
        columnResizeMode: 'onChange' as ColumnResizeMode,
      } satisfies TableOptions<any>;

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
      sortOrder,
      enableSorting,
      onSortingChange,
      columnSizeStorage,
      setColumnSizeStorage,
    ]);

    const table = useReactTable(reactTableProps);

    const { rows: _rows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
      count: _rows.length,
      // count: hasNextPage ? allRows.length + 1 : allRows.length,
      getScrollElement: useCallback(
        () => tableContainerRef,
        [tableContainerRef],
      ),
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
    const [wrapLinesEnabled, setWrapLinesEnabled] = useLocalStorage<boolean>(
      `${tableId}-wrap-lines`,
      wrapLines ?? false,
    );
    const [showSql, setShowSql] = useState(false);

    const handleSqlModalOpen = (open: boolean) => {
      setShowSql(open);
      onChildModalOpen?.(open);
    };

    // Scroll to current match (only when explicitly navigating)
    // Fixed: Properly synchronized scroll flag with state updates
    useEffect(() => {
      if (!tableSearch.shouldScrollToMatch) {
        return;
      }

      if (
        tableSearch.matchIndices.length > 0 &&
        rowVirtualizer &&
        tableSearch.currentMatchIndex < tableSearch.matchIndices.length &&
        tableSearch.searchQuery.trim()
      ) {
        const matchRowIndex =
          tableSearch.matchIndices[tableSearch.currentMatchIndex];
        const matchedRow = dedupedRows[matchRowIndex];

        if (matchedRow) {
          // Find the corresponding row in the react-table rows
          const tableRowIndex = _rows.findIndex(
            row => getRowId(row.original) === getRowId(matchedRow),
          );

          if (tableRowIndex !== -1) {
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => {
              rowVirtualizer.scrollToIndex(tableRowIndex, {
                align: 'center',
              });
              // Clear the flag after scrolling completes
              tableSearch.clearShouldScrollToMatch();
            });
          } else {
            // Row not found in virtual list, clear flag
            tableSearch.clearShouldScrollToMatch();
          }
        } else {
          // No matched row, clear flag
          tableSearch.clearShouldScrollToMatch();
        }
      } else {
        // Conditions not met, clear flag
        tableSearch.clearShouldScrollToMatch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      tableSearch.shouldScrollToMatch,
      tableSearch.currentMatchIndex,
      tableSearch.matchIndices,
      tableSearch.searchQuery,
      tableSearch.clearShouldScrollToMatch,
      rowVirtualizer,
      _rows,
      dedupedRows,
    ]);

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
      <Flex direction="column" h="100%">
        <Box pos="relative" style={{ flex: 1, minHeight: 0 }}>
          {/* Find within page search bar - floating on top right */}
          <TableSearchInput
            searchQuery={tableSearch.inputValue}
            onSearchChange={tableSearch.handleSearchChange}
            matchIndices={tableSearch.matchIndices}
            currentMatchIndex={tableSearch.currentMatchIndex}
            onPreviousMatch={tableSearch.handlePreviousMatch}
            onNextMatch={tableSearch.handleNextMatch}
            isVisible={tableSearch.isSearchVisible}
            onVisibilityChange={tableSearch.setIsSearchVisible}
            containerRef={tableContainerRef}
          />
          <div
            data-testid="search-results-table"
            className={cx('overflow-auto h-100 fs-8', styles.tableWrapper, {
              [styles.muted]: variant === 'muted',
            })}
            onScroll={e => {
              fetchMoreOnBottomReached(e.target as HTMLDivElement);

              if (e.target != null) {
                const { scrollTop } = e.target as HTMLDivElement;
                onScroll?.(scrollTop);
              }
            }}
            ref={tableContainerRefCallback}
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
            <table className={cx('w-100', styles.table)} id={tableId}>
              <thead className={styles.tableHead}>
                {displayedColumns.length > 0 &&
                  table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header, headerIndex) => {
                        const isLast =
                          headerIndex === headerGroup.headers.length - 1;
                        return (
                          <TableHeader
                            key={header.id}
                            header={header}
                            isLast={isLast}
                            lastItemButtons={
                              <Group gap={8} mr={8}>
                                {tableId &&
                                  Object.keys(columnSizeStorage).length > 0 && (
                                    <UnstyledButton
                                      onClick={() => setColumnSizeStorage({})}
                                      title="Reset Column Widths"
                                    >
                                      <MantineTooltip label="Reset Column Widths">
                                        <IconRotateClockwise size={16} />
                                      </MantineTooltip>
                                    </UnstyledButton>
                                  )}
                                {config && (
                                  <UnstyledButton
                                    onClick={() => handleSqlModalOpen(true)}
                                    title="Show Generated SQL"
                                    tabIndex={0}
                                  >
                                    <MantineTooltip label="Show Generated SQL">
                                      <IconCode size={16} />
                                    </MantineTooltip>
                                  </UnstyledButton>
                                )}
                                <UnstyledButton
                                  onClick={() =>
                                    setWrapLinesEnabled(prev => !prev)
                                  }
                                  title={`${wrapLinesEnabled ? 'Disable' : 'Enable'}  Wrap Lines`}
                                >
                                  <MantineTooltip
                                    label={`${wrapLinesEnabled ? 'Disable' : 'Enable'} Wrap Lines`}
                                  >
                                    {wrapLinesEnabled ? (
                                      <IconTextWrapDisabled size={16} />
                                    ) : (
                                      <IconTextWrap size={16} />
                                    )}
                                  </MantineTooltip>
                                </UnstyledButton>

                                <CsvExportButton
                                  data={csvData}
                                  filename={`hyperdx_search_results_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`}
                                  className="fs-6"
                                >
                                  <MantineTooltip
                                    label={`Download Table as CSV (max ${maxRows.toLocaleString()} rows)${isLimited ? ' - data truncated' : ''}`}
                                  >
                                    <IconDownload size={16} />
                                  </MantineTooltip>
                                </CsvExportButton>
                                {onSettingsClick != null && (
                                  <UnstyledButton
                                    onClick={() => onSettingsClick()}
                                    title="Settings"
                                  >
                                    <MantineTooltip label="Settings">
                                      <IconSettings size={16} />
                                    </MantineTooltip>
                                  </UnstyledButton>
                                )}
                              </Group>
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
                  const row = _rows[virtualRow.index] as TableRow<any>;
                  const rowId = getRowId(row.original);
                  const isExpanded = expandedRows[rowId] ?? false;

                  return (
                    <React.Fragment key={virtualRow.key}>
                      <tr
                        data-testid={`table-row-${rowId}`}
                        className={cx(styles.tableRow, {
                          [styles.tableRow__selected]:
                            highlightedLineId && highlightedLineId === rowId,
                        })}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                      >
                        {/* Expand button cell */}
                        {showExpandButton && (
                          <td
                            className="align-top overflow-hidden"
                            style={{ width: '40px' }}
                          >
                            {flexRender(
                              row.getVisibleCells()[0].column.columnDef.cell,
                              row.getVisibleCells()[0].getContext(),
                            )}
                          </td>
                        )}

                        {/* Content columns grouped back to preserve row hover/click */}
                        <td
                          className="align-top overflow-hidden p-0"
                          colSpan={columns.length - (showExpandButton ? 1 : 0)}
                        >
                          <button
                            type="button"
                            className={cx(styles.rowContentButton, {
                              [styles.isWrapped]: wrapLinesEnabled,
                              [styles.isTruncated]: !wrapLinesEnabled,
                            })}
                            onClick={e => {
                              _onRowExpandClick(row.original);
                            }}
                            aria-label="View details for log entry"
                          >
                            {row
                              .getVisibleCells()
                              .slice(showExpandButton ? 1 : 0) // Skip expand
                              .map(cell => {
                                const columnCustomClassName = (
                                  cell.column.columnDef.meta as any
                                )?.className;
                                const columnSize = cell.column.getSize();
                                const cellValue = cell.getValue<any>();

                                return (
                                  <div
                                    key={cell.id}
                                    className={cx(
                                      'flex-shrink-0 overflow-hidden position-relative',
                                      columnCustomClassName,
                                    )}
                                    style={{
                                      width:
                                        columnSize === UNDEFINED_WIDTH
                                          ? 'auto'
                                          : `${columnSize}px`,
                                      flex:
                                        columnSize === UNDEFINED_WIDTH
                                          ? '1'
                                          : 'none',
                                    }}
                                  >
                                    <div className={styles.fieldTextContainer}>
                                      <DBRowTableFieldWithPopover
                                        key={cell.id}
                                        cellValue={cellValue}
                                        wrapLinesEnabled={wrapLinesEnabled}
                                        tableContainerRef={tableContainerRef}
                                        columnName={
                                          (cell.column.columnDef.meta as any)
                                            ?.column
                                        }
                                        isChart={
                                          (cell.column.columnDef.meta as any)
                                            ?.column === '__hdx_pattern_trend'
                                        }
                                      >
                                        {flexRender(
                                          cell.column.columnDef.cell,
                                          cell.getContext(),
                                        )}
                                      </DBRowTableFieldWithPopover>
                                    </div>
                                  </div>
                                );
                              })}
                            {/* Row-level copy buttons */}
                            {getRowWhere && (
                              <DBRowTableRowButtons
                                row={row.original}
                                getRowWhere={getRowWhere}
                                sourceId={source?.id}
                                isWrapped={wrapLinesEnabled}
                                onToggleWrap={() =>
                                  setWrapLinesEnabled(!wrapLinesEnabled)
                                }
                              />
                            )}
                          </button>
                        </td>
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
                            aliasWith:
                              row.original[INTERNAL_ROW_FIELDS.ALIAS_WITH],
                            ...row.original,
                          })}
                        </ExpandedLogRow>
                      )}
                    </React.Fragment>
                  );
                })}
                <tr>
                  <td colSpan={800}>
                    <div className="rounded fs-7 bg-muted text-center d-flex align-items-center justify-content-center mt-3">
                      {isLoading ? (
                        <div className="my-3">
                          <div className="d-inline-block">
                            <IconRefresh size={14} className="spin-animate" />
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
                              {formatDistance(
                                dateRange?.[1],
                                dateRange?.[0],
                              )}{' '}
                              {'('}
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
                            Error loading results, please check your query or
                            try again.
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
                        <div
                          className="my-3"
                          data-testid="db-row-table-no-results"
                        >
                          No results found.
                          <Text mt="sm">
                            Try checking the query explainer in the search bar
                            if there are any search syntax issues.
                          </Text>
                          {dateRange?.[0] != null && dateRange?.[1] != null ? (
                            <Text mt="sm">
                              Searched Time Range:{' '}
                              {formatDistance(dateRange?.[1], dateRange?.[0])}{' '}
                              {'('}
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
                    <td
                      colSpan={99999}
                      style={{ height: `${paddingBottom}px` }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Match indicator on the right side */}
          <TableSearchMatchIndicator
            searchQuery={tableSearch.searchQuery}
            matchIndices={tableSearch.matchIndices}
            currentMatchIndex={tableSearch.currentMatchIndex}
            dedupedRows={dedupedRows}
            tableRows={_rows}
            getRowId={getRowId}
            onMatchClick={tableSearch.handleMatchClick}
          />
        </Box>
      </Flex>
    );
  },
);

export function appendSelectWithPrimaryAndPartitionKey(
  select: SelectList,
  primaryKeys: string,
  partitionKey: string,
): { select: SelectList; additionalKeysLength: number } {
  const partitionKeyArr = extractColumnReferencesFromKey(partitionKey);
  const primaryKeyArr = extractColumnReferencesFromKey(primaryKeys);
  const allKeys = new Set([...partitionKeyArr, ...primaryKeyArr]);
  if (typeof select === 'string') {
    const selectSplit = splitAndTrimWithBracket(select);
    const selectColumns = new Set(selectSplit);
    const additionalKeys = [...allKeys].filter(k => !selectColumns.has(k));
    return {
      select: [...selectColumns, ...additionalKeys].join(','),
      additionalKeysLength: additionalKeys.length,
    };
  } else {
    const additionalKeys = [...allKeys].map(k => ({ valueExpression: k }));
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

export type DBRowTableVariant = 'default' | 'muted';

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
  onSortingChange,
  initialSortBy,
  variant = 'default',
}: {
  config: ChartConfigWithDateRange;
  sourceId?: string;
  onRowDetailsClick?: (rowWhere: RowWhereResult) => void;
  highlightedLineId?: string;
  queryKeyPrefix?: string;
  enabled?: boolean;
  isLive?: boolean;
  renderRowDetails?: (r: {
    id: string;
    aliasWith?: WithClause[];
    [key: string]: unknown;
  }) => React.ReactNode;
  onScroll?: (scrollTop: number) => void;
  onError?: (error: Error | ClickHouseQueryError) => void;
  denoiseResults?: boolean;
  onChildModalOpen?: (open: boolean) => void;
  onExpandedRowsChange?: (hasExpandedRows: boolean) => void;
  collapseAllRows?: boolean;
  showExpandButton?: boolean;
  initialSortBy?: SortingState;
  onSortingChange?: (v: SortingState | null) => void;
  variant?: DBRowTableVariant;
}) {
  const { data: me } = api.useMe();

  const [orderBy, setOrderBy] = useState<SortingState[number] | null>(
    initialSortBy?.[0] ?? null,
  );

  const orderByArray = useMemo(() => (orderBy ? [orderBy] : []), [orderBy]);

  const _onSortingChange = useCallback(
    (v: SortingState | null) => {
      onSortingChange?.(v);
      setOrderBy(v?.[0] ?? null);
    },
    [setOrderBy, onSortingChange],
  );

  const prevSourceId = usePrevious(sourceId);
  useEffect(() => {
    if (prevSourceId && prevSourceId !== sourceId) {
      _onSortingChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  // Sync local orderBy state with initialSortBy when it changes
  // (e.g., when loading a saved search)
  const prevInitialSortBy = usePrevious(initialSortBy);
  useEffect(() => {
    const currentSort = initialSortBy?.[0] ?? null;
    const prevSort = prevInitialSortBy?.[0] ?? null;

    // Only sync if initialSortBy actually changed (not orderBy)
    // We don't include orderBy in deps to avoid infinite loop
    if (JSON.stringify(currentSort) !== JSON.stringify(prevSort)) {
      setOrderBy(currentSort);
    }
  }, [initialSortBy, prevInitialSortBy]);

  const mergedConfigObj = useMemo(() => {
    const base = {
      ...searchChartConfigDefaults(me?.team),
      ...config,
    };
    if (orderByArray.length) {
      base.orderBy = orderByArray.map(o => {
        return {
          valueExpression: o.id,
          ordering: o.desc ? 'DESC' : 'ASC',
        };
      });
    }
    return base;
  }, [me, config, orderByArray]);

  const mergedConfig = useConfigWithPrimaryAndPartitionKey(mergedConfigObj);

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

  const denoisedRows = useQuery({
    queryKey: [
      'denoised-rows',
      config,
      denoiseResults,
      // Only include processed rows if denoising is enabled
      // This helps prevent the queryKey from getting extremely large
      // and causing memory issues, when it's not used.
      ...(denoiseResults ? [processedRows] : []),
      noisyPatternIds,
      patternColumn,
    ],
    queryFn: async () => {
      if (!denoiseResults) {
        return [];
      }
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
    gcTime: isLive ? ms('30s') : ms('5m'), // more aggressive gc for live data, since it can end up holding lots of data
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

  const loadingDate =
    data?.window?.direction === 'ASC'
      ? data?.window?.endTime
      : data?.window?.startTime;

  return (
    <>
      {denoiseResults && (
        <Box mb="xxs" px="sm">
          <Text fw="bold" fz="xs" mb="xxs">
            Removed Noisy Event Patterns
          </Text>
          <Box mah={100} style={{ overflow: 'auto' }}>
            {noisyPatterns.data?.map(p => (
              <Text fz="xs" key={p.id}>
                {p.pattern}
              </Text>
            ))}
            {noisyPatternIds.length === 0 && (
              <Text fz="xs">No noisy patterns found</Text>
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
        loadingDate={loadingDate}
        config={mergedConfigObj}
        onChildModalOpen={onChildModalOpen}
        source={source}
        onExpandedRowsChange={onExpandedRowsChange}
        collapseAllRows={collapseAllRows}
        showExpandButton={showExpandButton}
        enableSorting={true}
        onSortingChange={_onSortingChange}
        sortOrder={orderByArray}
        getRowWhere={getRowWhere}
        variant={variant}
      />
    </>
  );
}
export const DBSqlRowTable = memo(DBSqlRowTableComponent);
