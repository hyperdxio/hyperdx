import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import curry from 'lodash/curry';
import { Button, Modal } from 'react-bootstrap';
import { CSVLink } from 'react-csv';
import { useHotkeys } from 'react-hotkeys-hook';
import stripAnsi from 'strip-ansi';
import { Text } from '@mantine/core';
import {
  CellContext,
  ColumnDef,
  ColumnResizeMode,
  flexRender,
  getCoreRowModel,
  Row as TableRow,
  TableOptions,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from './api';
import Checkbox from './Checkbox';
import { IS_LOCAL_MODE } from './config';
import FieldMultiSelect from './FieldMultiSelect';
import InstallInstructionsModal from './InstallInstructionsModal';
import LogLevel from './LogLevel';
import { useSearchEventStream } from './search';
import { UNDEFINED_WIDTH } from './tableUtils';
import { useUserPreferences } from './useUserPreferences';
import { useLocalStorage, usePrevious, useWindowSize } from './utils';
import { TIME_TOKENS } from './utils';

import styles from '../styles/LogTable.module.scss';

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

function retrieveColumnValue(column: string, row: Row): any {
  const accessor = ACCESSOR_MAP[column] ?? ACCESSOR_MAP.default;
  return accessor(row, column);
}

function DownloadCSVButton({
  config: { where, dateRange },
  extraFields,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  extraFields: string[];
}) {
  const [downloading, setDownloading] = useState(false);

  const { data: searchResultsPages, isFetching: isSearchResultsFetching } =
    api.useLogBatch(
      {
        q: where,
        startDate: dateRange?.[0] ?? new Date(),
        endDate: dateRange?.[1] ?? new Date(),
        extraFields,
        order: null,
        limit: 4000,
      },
      {
        enabled: downloading,
        refetchOnWindowFocus: false,
        getNextPageParam: (lastPage: any, allPages) => {
          if (lastPage.rows === 0) return undefined;
          return allPages.flatMap(page => page.data).length;
        },
      },
    );

  const csvData = useMemo(() => {
    if (searchResultsPages == null) return [];
    return searchResultsPages.pages.flatMap(page =>
      page.data.map(
        ({
          _platform,
          _host,
          id,
          sort_key,
          type,
          timestamp,
          severity_text,
          _service,
          body,
          ...row
        }) => ({
          timestamp: timestamp,
          level: severity_text,
          service: _service,
          ...row,
          message: body,
        }),
      ),
    );
  }, [searchResultsPages]);

  return (
    <>
      {!downloading ? (
        <span>
          <Button size="sm" variant="dark" onClick={() => setDownloading(true)}>
            Download Search Results as CSV
          </Button>{' '}
          <span className="text-muted fs-7.5">(Max 4,000 events)</span>
        </span>
      ) : isSearchResultsFetching ? (
        <span>Fetching results...</span>
      ) : csvData.length > 0 ? (
        <CSVLink
          data={csvData}
          filename={`HyperDX_search_${where.replace(/[^a-zA-Z0-9]/g, '_')}`}
        >
          <Button size="sm" variant="success">
            Download CSV
          </Button>
        </CSVLink>
      ) : (
        <span>An error occurred.</span>
      )}
    </>
  );
}

function LogTableSettingsModal({
  show,
  onHide,
  onDone,
  initialAdditionalColumns,
  initialWrapLines,
  downloadCSVButton,
}: {
  initialAdditionalColumns: string[];
  initialWrapLines: boolean;
  show: boolean;
  onHide: () => void;
  onDone: (settings: {
    additionalColumns: string[];
    wrapLines: boolean;
  }) => void;
  downloadCSVButton: JSX.Element;
}) {
  const [additionalColumns, setAdditionalColumns] = useState<string[]>(
    initialAdditionalColumns,
  );
  const [wrapLines, setWrapLines] = useState(initialWrapLines);

  return (
    <Modal
      aria-labelledby="contained-modal-title-vcenter"
      centered
      onHide={onHide}
      show={show}
      size="lg"
    >
      <Modal.Body className="bg-hdx-dark rounded">
        <div className="fs-5 mb-4">Event Viewer Options</div>
        <div className="mb-2 text-muted">Display Additional Columns</div>
        <FieldMultiSelect
          values={additionalColumns}
          setValues={(values: string[]) => setAdditionalColumns(values)}
          types={['string', 'number', 'bool']}
        />
        <Checkbox
          id="wrap-lines"
          className="mt-4"
          labelClassName="fs-7"
          checked={wrapLines}
          onChange={() => setWrapLines(!wrapLines)}
          label="Wrap Lines"
        />
        <div className="mt-4 text-muted fs-8">
          UTC setting moved to User Preferences
        </div>
        <div className="mt-4">
          <div className="mb-2">Download Search Results</div>
          {downloadCSVButton}
        </div>
        <div className="mt-4 d-flex justify-content-between">
          <Button
            variant="outline-success"
            className="fs-7 text-muted-hover"
            onClick={() => {
              onDone({ additionalColumns, wrapLines });
              onHide();
            }}
          >
            Done
          </Button>
          <Button variant="dark" onClick={() => onHide()}>
            Cancel
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
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
    logs,
    onInstructionsClick,
    // onPropertySearchClick,
    onRowExpandClick,
    onScroll,
    onSettingsClick,
    onShowPatternsClick,
    wrapLines,
    columnNameMap,
    showServiceColumn = true,
  }: {
    wrapLines: boolean;
    displayedColumns: string[];
    onSettingsClick?: () => void;
    onInstructionsClick?: () => void;
    logs: {
      id: string;
      sort_key: string;
      _service?: string;
      severity_text: string;
      body: string;
      timestamp: string;
    }[];
    isLoading: boolean;
    fetchNextPage: () => any;
    onRowExpandClick: (id: string, sortKey: string) => void;
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
  }) => {
    const dedupLogs = useMemo(() => {
      const lIds = new Set();
      return logs.filter(l => {
        if (lIds.has(l.id)) {
          return false;
        }
        lIds.add(l.id);
        return true;
      });
    }, [logs]);

    const { width } = useWindowSize();
    const isSmallScreen = (width ?? 1000) < 900;
    const {
      userPreferences: { timeFormat, isUTC },
    } = useUserPreferences();
    const tsFormat = TIME_TOKENS[timeFormat];

    const [columnSizeStorage, setColumnSizeStorage] = useLocalStorage<
      Record<string, number>
    >(`${tableId}-column-sizes`, {});

    const tsShortFormat = 'HH:mm:ss';
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
                  'text-success': highlightedLineId === info.getValue(),
                  'text-muted-hover': highlightedLineId !== info.getValue(),
                })}
                onMouseDown={e => {
                  // For some reason this interfers with the onclick handler
                  // inside a dashboard tile
                  e.stopPropagation();
                }}
                onClick={() => {
                  const { id, sort_key } = info.row.original;
                  onRowExpandClick(id, sort_key);
                }}
              >
                <span className="bi bi-chevron-right" />
              </div>
            );
          },
          size: 8,
          enableResizing: false,
        },
        {
          accessorKey: 'timestamp',
          header: () =>
            isSmallScreen
              ? 'Time'
              : `Timestamp${isUTC ? ' (UTC)' : ' (Local)'}`,
          cell: info => {
            // FIXME: since original timestamp doesn't come with timezone info
            const date = new Date(info.getValue<string>());
            return (
              <span className="text-muted">
                {isUTC
                  ? formatInTimeZone(
                      date,
                      'Etc/UTC',
                      isSmallScreen ? tsShortFormat : tsFormat,
                    )
                  : format(date, isSmallScreen ? tsShortFormat : tsFormat)}
              </span>
            );
          },
          size: columnSizeStorage.timestamp ?? (isSmallScreen ? 75 : 180),
        },
        {
          accessorKey: 'severity_text',
          header: 'Level',
          cell: info => (
            <span
            // role="button"
            // onClick={() =>
            //   onPropertySearchClick('level', info.getValue<string>())
            // }
            >
              <LogLevel level={info.getValue<string>()} />
            </span>
          ),
          size: columnSizeStorage.severity_text ?? (isSmallScreen ? 50 : 100),
        },
        ...(showServiceColumn
          ? [
              {
                accessorKey: '_service',
                header: 'Service',
                cell: (info: CellContext<any, unknown>) => (
                  <span
                  // role="button"
                  // onClick={() =>
                  //   onPropertySearchClick('service', info.getValue<string>())
                  // }
                  >
                    {info.getValue<string>()}
                  </span>
                ),
                size: columnSizeStorage._service ?? (isSmallScreen ? 70 : 100),
              },
            ]
          : []),
        ...(displayedColumns.map(column => ({
          accessorFn: curry(retrieveColumnValue)(column), // Columns can contain '.' and will not work with accessorKey
          header: columnNameMap?.[column] ?? column,
          cell: info => {
            const value = info.getValue<string>();
            return (
              <span
                className={cx({
                  'text-muted': value === SPECIAL_VALUES.not_available,
                })}
              >
                {value}
              </span>
            );
          },
          size: columnSizeStorage[column] ?? 150,
        })) as ColumnDef<any>[]),
        {
          accessorKey: 'body',
          header: () => (
            <span>
              Message{' '}
              {onShowPatternsClick != null && !IS_LOCAL_MODE && (
                <span>
                  •{' '}
                  <Text
                    span
                    size="xs"
                    c="green"
                    onClick={onShowPatternsClick}
                    role="button"
                  >
                    <i className="bi bi-collection"></i> Group Similar Events
                  </Text>
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
        isUTC,
        highlightedLineId,
        onRowExpandClick,
        displayedColumns,
        onShowPatternsClick,
        isSmallScreen,
        columnSizeStorage,
        showServiceColumn,
        columnNameMap,
        tsFormat,
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
            fetchNextPage();
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
        data: dedupLogs,
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
    }, [columns, dedupLogs, tableId, columnSizeStorage, setColumnSizeStorage]);

    const table = useReactTable(reactTableProps);

    const { rows } = table.getRowModel();

    const rowVirtualizer = useVirtualizer({
      count: rows.length,
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

      const rowIdx = dedupLogs.findIndex(l => l.id === highlightedLineId);
      if (rowIdx == -1) {
        fetchNextPage();
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
      dedupLogs,
      highlightedLineId,
      fetchNextPage,
      rowVirtualizer,
      scrolledToHighlightedLine,
      // Needed to make sure we call this again when the log search loading
      // state is done to fetch next page
      isLoading,
    ]);

    const shiftHighlightedLineId = useCallback(
      (shift: number) => {
        if (highlightedLineId == null) {
          return;
        }

        const newIndex =
          dedupLogs.findIndex(l => l.id === highlightedLineId) + shift;

        if (newIndex < 0 || newIndex >= dedupLogs.length) {
          return;
        }

        const newLine = dedupLogs[newIndex];

        onRowExpandClick(newLine.id, newLine.sort_key);
      },
      [highlightedLineId, onRowExpandClick, dedupLogs],
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
        className="overflow-auto h-100 fs-8 bg-inherit mono"
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
              const row = rows[virtualRow.index] as TableRow<any>;
              return (
                <tr
                  onClick={() => {
                    onRowExpandClick(row.original.id, row.original.sort_key);
                  }}
                  role="button"
                  key={virtualRow.key}
                  className={cx(styles.tableRow, {
                    [styles.tableRow__selected]:
                      highlightedLineId === row.original.id,
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
                    dedupLogs.length > 0 ? (
                    <div className="my-3">End of Results</div>
                  ) : hasNextPage == false &&
                    isLoading == false &&
                    dedupLogs.length === 0 ? (
                    <div className="my-3">
                      No results found.
                      <div className="text-muted mt-3">
                        Try checking the query explainer in the search bar if
                        there are any search syntax issues.
                      </div>
                      {onInstructionsClick != null && (
                        <>
                          <div className="text-muted mt-3">
                            Add new data sources by setting up a HyperDX
                            integration.
                          </div>
                          <Button
                            variant="outline-success"
                            className="fs-7 mt-3"
                            onClick={() => onInstructionsClick()}
                          >
                            Install New HyperDX Integration
                          </Button>
                        </>
                      )}
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

export default function LogTable({
  config: { where: searchedQuery, dateRange: searchedTimeRange },
  highlightedLineId,
  onPropertySearchClick,
  onRowExpandClick,
  isLive,
  onScroll,
  onEnd,
  onShowPatternsClick,
  tableId,
  displayedColumns,
  setDisplayedColumns,
  columnNameMap,
  showServiceColumn,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  highlightedLineId: undefined | string;
  onPropertySearchClick: (
    property: string,
    value: string | number | boolean,
  ) => void;
  onRowExpandClick: (logId: string, sortKey: string) => void;
  onScroll: (scrollTop: number) => void;
  isLive: boolean;
  onEnd?: () => void;
  onShowPatternsClick?: () => void;
  tableId?: string;
  displayedColumns: string[];
  setDisplayedColumns: (columns: string[]) => void;
  columnNameMap?: Record<string, string>;
  showServiceColumn?: boolean;
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);

  const prevQueryConfig = usePrevious({ searchedQuery, isLive });

  const resultsKey = [searchedQuery, displayedColumns, isLive].join(':');

  const {
    userPreferences: { isUTC },
  } = useUserPreferences();

  const {
    results: searchResults,
    resultsKey: searchResultsKey,
    fetchNextPage,
    isFetching: isSearchResultsFetching,
    hasNextPage,
  } = useSearchEventStream(
    {
      apiUrlPath: '/logs/stream',
      q: searchedQuery,
      startDate: searchedTimeRange?.[0] ?? new Date(),
      endDate: searchedTimeRange?.[1] ?? new Date(),
      extraFields: displayedColumns,
      order: 'desc',
      onEnd,
      resultsKey,
    },
    {
      enabled: searchedTimeRange != null,
      keepPreviousData:
        isLive && prevQueryConfig?.searchedQuery === searchedQuery,
      // If we're in live mode, we shouldn't abort the previous request
      // as a slow live search will always result in an aborted request
      // unless the user has changed their query (without leaving live mode)
      // If we're not in live mode, we should abort as the user is requesting a new search
      // We need to look at prev state to make sure we abort if transitioning from live to not live
      shouldAbortPendingRequest:
        !(isLive && prevQueryConfig?.isLive) ||
        prevQueryConfig?.searchedQuery !== searchedQuery,
    },
  );

  // Check if live tail is enabled, if so, we need to compare the search results
  // key to see if the data we're showing is stale relative to the query we're trying to show.
  // otherwise, we just need to check if the search results are fetching
  const isLoading =
    isLive && prevQueryConfig != null && prevQueryConfig.isLive
      ? searchResultsKey !== resultsKey && isSearchResultsFetching
      : isSearchResultsFetching;

  const hasNextPageWhenNotLive =
    prevQueryConfig?.searchedQuery === searchedQuery &&
    isLive &&
    prevQueryConfig.isLive
      ? false
      : hasNextPage ?? true;

  return (
    <>
      <InstallInstructionsModal
        show={instructionsOpen}
        onHide={() => setInstructionsOpen(false)}
      />
      <LogTableSettingsModal
        key={`${isUTC} ${displayedColumns} ${wrapLines}`}
        show={settingsOpen}
        initialAdditionalColumns={displayedColumns}
        initialWrapLines={wrapLines}
        onHide={() => setSettingsOpen(false)}
        onDone={({ additionalColumns, wrapLines }) => {
          setDisplayedColumns(additionalColumns);
          setWrapLines(wrapLines);
        }}
        downloadCSVButton={
          <DownloadCSVButton
            config={{
              where: searchedQuery,
              dateRange: searchedTimeRange,
            }}
            extraFields={displayedColumns}
          />
        }
      />
      <RawLogTable
        tableId={tableId}
        isLive={isLive}
        wrapLines={wrapLines}
        displayedColumns={displayedColumns}
        onSettingsClick={useCallback(
          () => setSettingsOpen(true),
          [setSettingsOpen],
        )}
        onInstructionsClick={useCallback(
          () => setInstructionsOpen(true),
          [setInstructionsOpen],
        )}
        highlightedLineId={highlightedLineId}
        logs={searchResults ?? []}
        isLoading={isLoading}
        fetchNextPage={useCallback(
          () => fetchNextPage({ limit: 200 }),
          [fetchNextPage],
        )}
        // onPropertySearchClick={onPropertySearchClick}
        hasNextPage={hasNextPageWhenNotLive}
        onRowExpandClick={onRowExpandClick}
        onScroll={onScroll}
        onShowPatternsClick={onShowPatternsClick}
        columnNameMap={columnNameMap}
        showServiceColumn={showServiceColumn}
      />
    </>
  );
}
