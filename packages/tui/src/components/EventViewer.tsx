import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type {
  SourceResponse,
  SavedSearchResponse,
  ProxyClickhouseClient,
} from '@/api/client';
import { buildEventSearchQuery, buildFullRowSql } from '@/api/eventQuery';
import { openEditorForTimeRange, type TimeRange } from '@/utils/editor';

interface EventViewerProps {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  sources: SourceResponse[];
  savedSearches: SavedSearchResponse[];
  onSavedSearchSelect: (search: SavedSearchResponse) => void;
  initialQuery?: string;
  follow?: boolean;
}

interface EventRow {
  [key: string]: string | number;
}

const TAIL_INTERVAL_MS = 2000;

// ---- Column definitions per source kind ----------------------------

interface Column {
  header: string;
  /** Width as percentage string, e.g. "20%" */
  width: string;
}

function getColumns(source: SourceResponse): Column[] {
  if (source.kind === 'trace') {
    return [
      { header: 'Timestamp', width: '22%' },
      { header: 'Service', width: '15%' },
      { header: 'Span', width: '25%' },
      { header: 'Duration', width: '10%' },
      { header: 'Status', width: '8%' },
      { header: 'Trace ID', width: '20%' },
    ];
  }
  // Log source
  return [
    { header: 'Timestamp', width: '22%' },
    { header: 'Severity', width: '8%' },
    { header: 'Body', width: '70%' },
  ];
}

interface FormattedRow {
  cells: string[];
  severityColor?: 'red' | 'yellow' | 'blue' | 'gray';
}

function flatten(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getSeverityColor(
  sev: string,
): 'red' | 'yellow' | 'blue' | 'gray' | undefined {
  const s = sev.toLowerCase();
  if (s === 'error' || s === 'fatal' || s === 'critical') return 'red';
  if (s === 'warn' || s === 'warning') return 'yellow';
  if (s === 'info') return 'blue';
  if (s === 'debug' || s === 'trace') return 'gray';
  return undefined;
}

function formatEventRow(row: EventRow, source: SourceResponse): FormattedRow {
  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const timestamp = String(row[tsExpr] ?? row['Timestamp'] ?? '');

  if (source.kind === 'trace') {
    return formatTraceRow(row, source, timestamp);
  }

  const bodyExpr = source.bodyExpression ?? 'Body';
  const sevExpr = source.severityTextExpression ?? 'SeverityText';
  const rawBody = String(row[bodyExpr] ?? JSON.stringify(row));
  const severity = String(row[sevExpr] ?? '');

  return {
    cells: [timestamp, severity, flatten(rawBody)],
    severityColor: getSeverityColor(severity),
  };
}

function formatTraceRow(
  row: EventRow,
  source: SourceResponse,
  timestamp: string,
): FormattedRow {
  const spanName = source.spanNameExpression
    ? String(row[source.spanNameExpression] ?? '')
    : '';
  const service = source.serviceNameExpression
    ? String(row[source.serviceNameExpression] ?? '')
    : '';
  const durationRaw = source.durationExpression
    ? String(row[source.durationExpression] ?? '')
    : '';
  const statusCode = source.statusCodeExpression
    ? String(row[source.statusCodeExpression] ?? '')
    : '';
  const traceId = source.traceIdExpression
    ? String(row[source.traceIdExpression] ?? '')
    : '';

  let durationStr = '';
  if (durationRaw) {
    const dur = Number(durationRaw);
    const precision = source.durationPrecision ?? 3;
    if (precision === 9) {
      durationStr = `${(dur / 1_000_000).toFixed(1)}ms`;
    } else if (precision === 6) {
      durationStr = `${(dur / 1_000).toFixed(1)}ms`;
    } else {
      durationStr = `${dur.toFixed(1)}ms`;
    }
  }

  const statusLabel =
    statusCode === '2' ? 'ERROR' : statusCode === '1' ? 'WARN' : 'OK';
  const color =
    statusCode === '2'
      ? ('red' as const)
      : statusCode === '1'
        ? ('yellow' as const)
        : undefined;

  return {
    cells: [
      timestamp,
      service,
      spanName,
      durationStr,
      statusLabel,
      traceId.slice(0, 16),
    ],
    severityColor: color,
  };
}

// ---- Memoized sub-components ---------------------------------------

function formatShortDate(d: Date): string {
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}

const Header = React.memo(function Header({
  sourceName,
  dbName,
  tableName,
  isFollowing,
  loading,
  timeRange,
}: {
  sourceName: string;
  dbName: string;
  tableName: string;
  isFollowing: boolean;
  loading: boolean;
  timeRange: TimeRange;
}) {
  return (
    <Box>
      <Text bold color="cyan">
        HyperDX
      </Text>
      <Text> — </Text>
      <Text color="green">{sourceName}</Text>
      <Text dimColor>
        {' '}
        ({dbName}.{tableName})
      </Text>
      <Text dimColor>
        {' '}
        {formatShortDate(timeRange.start)} → {formatShortDate(timeRange.end)}
      </Text>
      {isFollowing && <Text color="yellow"> [FOLLOWING]</Text>}
      {loading && (
        <Text>
          {' '}
          <Spinner type="dots" />
        </Text>
      )}
    </Box>
  );
});

interface SwitchItem {
  type: 'saved' | 'source';
  label: string;
  search?: SavedSearchResponse;
  source?: SourceResponse;
}

const TabBar = React.memo(function TabBar({
  items,
  activeIdx,
}: {
  items: SwitchItem[];
  activeIdx: number;
}) {
  if (items.length <= 1) return null;
  return (
    <Box>
      {items.map((item, i) => (
        <Box key={`${item.type}-${i}`} marginRight={1}>
          <Text
            color={i === activeIdx ? 'cyan' : undefined}
            bold={i === activeIdx}
            dimColor={i !== activeIdx}
          >
            {i === activeIdx ? '▸ ' : '  '}
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

const SearchBar = React.memo(function SearchBar({
  focused,
  query,
  onChange,
  onSubmit,
}: {
  focused: boolean;
  query: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Box>
      <Text color={focused ? 'cyan' : 'gray'}>Search: </Text>
      {focused ? (
        <TextInput
          value={query}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="Lucene query…"
        />
      ) : (
        <Text dimColor>{query || '(empty)'}</Text>
      )}
    </Box>
  );
});

const Footer = React.memo(function Footer({
  rowCount,
  cursorPos,
  wrapLines,
  isFollowing,
  loadingMore,
}: {
  rowCount: number;
  cursorPos: number;
  wrapLines: boolean;
  isFollowing: boolean;
  loadingMore: boolean;
}) {
  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>
        {isFollowing ? '[FOLLOWING] ' : ''}
        {wrapLines ? '[WRAP] ' : ''}
        {loadingMore ? '[LOADING…] ' : ''}?=help q=quit
      </Text>
      <Text dimColor>
        {cursorPos}/{rowCount}
      </Text>
    </Box>
  );
});

const HelpScreen = React.memo(function HelpScreen() {
  const keys: Array<[string, string]> = [
    ['j / ↓', 'Move selection down'],
    ['k / ↑', 'Move selection up'],
    ['l / Enter', 'Expand row detail (SELECT *)'],
    ['h / Esc', 'Close row detail'],
    ['G', 'Jump to last item'],
    ['g', 'Jump to first item'],
    ['Ctrl+D', 'Page down (half page)'],
    ['Ctrl+U', 'Page up (half page)'],
    ['/', 'Focus search bar'],
    ['Esc', 'Blur search bar'],
    ['Tab', 'Next source / saved search'],
    ['Shift+Tab', 'Previous source / saved search'],
    ['t', 'Edit time range in $EDITOR'],
    ['f', 'Toggle follow mode'],
    ['w', 'Toggle line wrap'],
    ['?', 'Toggle this help'],
    ['q', 'Quit'],
  ];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        Keybindings
      </Text>
      <Text> </Text>
      {keys.map(([key, desc]) => (
        <Box key={key}>
          <Box width={20}>
            <Text bold color="yellow">
              {key}
            </Text>
          </Box>
          <Text>{desc}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>Press ? or Esc to close</Text>
    </Box>
  );
});

// ---- Table header row ----------------------------------------------

const TableHeader = React.memo(function TableHeader({
  columns,
}: {
  columns: Column[];
}) {
  return (
    <Box>
      {columns.map((col, i) => (
        <Box key={i} width={col.width}>
          <Text bold dimColor>
            {col.header}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

// ---- Main EventViewer ----------------------------------------------

export default function EventViewer({
  clickhouseClient,
  metadata,
  source,
  sources,
  savedSearches,
  onSavedSearchSelect,
  initialQuery = '',
  follow = false,
}: EventViewerProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  // Reserve: header(1) + tabbar(1) + search(1) + table-header(1) + margin(1) + footer(2) = 8
  const maxRows = Math.max(1, termHeight - 8);

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(follow);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [focusSearch, setFocusSearch] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [selectedRow, setSelectedRow] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandedRowData, setExpandedRowData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [expandedRowLoading, setExpandedRowLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const now = new Date();
    return { start: new Date(now.getTime() - 60 * 60 * 1000), end: now };
  });
  const lastTimestampRef = useRef<string | null>(null);
  const dateRangeRef = useRef<{ start: Date; end: Date } | null>(null);

  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const columns = useMemo(() => getColumns(source), [source]);

  // Build switchable items list
  const switchItems = useMemo<SwitchItem[]>(() => {
    const items: SwitchItem[] = [];
    for (const ss of savedSearches) {
      const src = sources.find(s => s.id === ss.source || s._id === ss.source);
      items.push({
        type: 'saved',
        label: `${ss.name}${src ? ` (${src.name})` : ''}`,
        search: ss,
      });
    }
    for (const src of sources) {
      items.push({ type: 'source', label: src.name, source: src });
    }
    return items;
  }, [savedSearches, sources]);

  const findActiveIndex = useCallback(() => {
    const ssIdx = switchItems.findIndex(
      item =>
        item.type === 'saved' &&
        item.search &&
        (item.search.source === source.id ||
          item.search.source === source._id) &&
        item.search.where === submittedQuery,
    );
    if (ssIdx >= 0) return ssIdx;
    const srcIdx = switchItems.findIndex(
      item =>
        item.type === 'source' &&
        item.source &&
        (item.source.id === source.id || item.source._id === source._id),
    );
    return srcIdx >= 0 ? srcIdx : 0;
  }, [switchItems, source, submittedQuery]);

  const activeIdx = findActiveIndex();
  const PAGE_SIZE = 200;

  const fetchEvents = useCallback(
    async (
      query: string,
      startTime: Date,
      endTime: Date,
      mode: 'replace' | 'prepend' = 'replace',
    ) => {
      setLoading(true);
      setError(null);
      try {
        const chSql = await buildEventSearchQuery(
          { source, searchQuery: query, startTime, endTime, limit: PAGE_SIZE },
          metadata,
        );
        const resultSet = await clickhouseClient.query({
          query: chSql.sql,
          query_params: chSql.params,
          format: 'JSON',
          connectionId: source.connection,
        });
        const json = await resultSet.json<EventRow>();
        const rows = (json.data ?? []) as EventRow[];

        if (mode === 'prepend' && rows.length > 0) {
          setEvents(prev => [...rows, ...prev]);
        } else {
          setEvents(rows);
          setHasMore(rows.length >= PAGE_SIZE);
          dateRangeRef.current = { start: startTime, end: endTime };
        }
        if (rows.length > 0) {
          const ts = rows[0][tsExpr];
          if (ts) lastTimestampRef.current = String(ts);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [clickhouseClient, metadata, source, tsExpr],
  );

  const fetchNextPage = useCallback(async () => {
    if (!hasMore || loadingMore || !dateRangeRef.current) return;
    setLoadingMore(true);
    try {
      const { start, end } = dateRangeRef.current;
      const chSql = await buildEventSearchQuery(
        {
          source,
          searchQuery: submittedQuery,
          startTime: start,
          endTime: end,
          limit: PAGE_SIZE,
          offset: events.length,
        },
        metadata,
      );
      const resultSet = await clickhouseClient.query({
        query: chSql.sql,
        query_params: chSql.params,
        format: 'JSON',
        connectionId: source.connection,
      });
      const json = await resultSet.json<EventRow>();
      const rows = (json.data ?? []) as EventRow[];

      if (rows.length > 0) {
        setEvents(prev => [...prev, ...rows]);
      }
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      // Non-fatal — just stop pagination
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [
    hasMore,
    loadingMore,
    events.length,
    submittedQuery,
    source,
    metadata,
    clickhouseClient,
  ]);

  useEffect(() => {
    fetchEvents(submittedQuery, timeRange.start, timeRange.end, 'replace');
  }, [submittedQuery, timeRange, fetchEvents]);

  useEffect(() => {
    if (!isFollowing) return;
    const interval = setInterval(() => {
      const now = new Date();
      const since = lastTimestampRef.current
        ? new Date(lastTimestampRef.current)
        : new Date(now.getTime() - 10_000);
      fetchEvents(submittedQuery, since, now, 'prepend');
    }, TAIL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isFollowing, submittedQuery, fetchEvents]);

  // Fetch full row data when a row is expanded (SELECT *)
  useEffect(() => {
    if (expandedRow === null) {
      setExpandedRowData(null);
      return;
    }
    const row = events[expandedRow];
    if (!row) return;

    let cancelled = false;
    setExpandedRowLoading(true);

    (async () => {
      try {
        const { sql, connectionId } = buildFullRowSql({
          source,
          row: row as Record<string, unknown>,
        });
        const resultSet = await clickhouseClient.query({
          query: sql,
          format: 'JSON',
          connectionId,
        });
        const json = await resultSet.json<Record<string, unknown>>();
        const fullRow = (json.data as Record<string, unknown>[])?.[0];
        if (!cancelled) {
          // Use full row if found, otherwise fall back to partial
          setExpandedRowData(fullRow ?? (row as Record<string, unknown>));
        }
      } catch (err) {
        // Non-fatal — fall back to partial row data, but include error
        if (!cancelled) {
          setExpandedRowData({
            ...(row as Record<string, unknown>),
            __fetch_error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setExpandedRowLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expandedRow, events, source, metadata, clickhouseClient]);

  const handleSubmitSearch = useCallback(() => {
    setSubmittedQuery(searchQuery);
    setScrollOffset(0);
    setFocusSearch(false);
    lastTimestampRef.current = null;
  }, [searchQuery]);

  const handleTabSwitch = useCallback(
    (direction: 1 | -1) => {
      if (switchItems.length === 0) return;
      const currentIdx = findActiveIndex();
      const nextIdx =
        (currentIdx + direction + switchItems.length) % switchItems.length;
      const item = switchItems[nextIdx];
      if (item.type === 'saved' && item.search) {
        onSavedSearchSelect(item.search);
      } else if (item.type === 'source' && item.source) {
        onSavedSearchSelect({
          id: '',
          _id: '',
          name: item.source.name,
          select: '',
          where: '',
          whereLanguage: 'lucene',
          source: item.source.id,
          tags: [],
        });
      }
    },
    [switchItems, findActiveIndex, onSavedSearchSelect],
  );

  const visibleRowCount = Math.min(events.length - scrollOffset, maxRows);

  useInput((input, key) => {
    // ? toggles help from anywhere (except search input)
    if (input === '?' && !focusSearch) {
      setShowHelp(s => !s);
      return;
    }
    // When help is showing, any key closes it
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    if (focusSearch) {
      if (key.tab) {
        handleTabSwitch(key.shift ? -1 : 1);
        return;
      }
      if (key.escape) {
        setFocusSearch(false);
        return;
      }
      return;
    }
    // j/k move selection cursor within visible rows
    if (input === 'j' || key.downArrow) {
      const absPos = scrollOffset + selectedRow;
      // If at the very last event and more pages available, fetch next page
      if (absPos >= events.length - 1 && hasMore) {
        fetchNextPage();
        return;
      }
      setSelectedRow(r => {
        const next = r + 1;
        if (next >= maxRows) {
          setScrollOffset(o =>
            Math.min(o + 1, Math.max(0, events.length - maxRows)),
          );
          return r;
        }
        return Math.min(next, visibleRowCount - 1);
      });
    }
    if (input === 'k' || key.upArrow) {
      setSelectedRow(r => {
        const next = r - 1;
        if (next < 0) {
          setScrollOffset(o => Math.max(0, o - 1));
          return 0;
        }
        return next;
      });
    }
    if (key.return || input === 'l') {
      if (expandedRow === null) {
        setExpandedRow(scrollOffset + selectedRow);
      }
      return;
    }
    if (key.escape || input === 'h') {
      if (expandedRow !== null) {
        setExpandedRow(null);
        return;
      }
    }
    // G = jump to last item (end of list), fetch more if available
    if (input === 'G') {
      if (hasMore) fetchNextPage();
      const maxOffset = Math.max(0, events.length - maxRows);
      setScrollOffset(maxOffset);
      setSelectedRow(Math.min(events.length - 1, maxRows - 1));
    }
    // g = jump to first item (top of list)
    if (input === 'g') {
      setScrollOffset(0);
      setSelectedRow(0);
    }
    // Ctrl+D = page down, Ctrl+U = page up (half-page scroll like vim)
    if (key.ctrl && input === 'd') {
      const half = Math.floor(maxRows / 2);
      const maxOffset = Math.max(0, events.length - maxRows);
      const newOffset = Math.min(scrollOffset + half, maxOffset);
      // If scrolling near the end and more data available, fetch next page
      if (newOffset >= maxOffset - half && hasMore) {
        fetchNextPage();
      }
      setScrollOffset(newOffset);
    }
    if (key.ctrl && input === 'u') {
      const half = Math.floor(maxRows / 2);
      setScrollOffset(o => Math.max(0, o - half));
    }
    if (key.tab) {
      handleTabSwitch(key.shift ? -1 : 1);
      return;
    }
    if (input === 'w') setWrapLines(w => !w);
    if (input === 'f') setIsFollowing(f => !f);
    if (input === '/') setFocusSearch(true);
    // t = edit time range in $EDITOR
    if (input === 't') {
      // Use setTimeout to let Ink finish the current render cycle
      // before we hand stdin/stdout to the editor
      setTimeout(() => {
        const result = openEditorForTimeRange(timeRange);
        if (result) {
          setTimeRange(result);
          setScrollOffset(0);
          setSelectedRow(0);
        }
      }, 50);
      return;
    }
    if (input === 'q') process.exit(0);
  });

  // Pre-format visible rows (keep raw data for expanded view)
  const visibleRows = useMemo(() => {
    return events.slice(scrollOffset, scrollOffset + maxRows).map(row => ({
      ...formatEventRow(row, source),
      raw: row,
    }));
  }, [events, scrollOffset, maxRows, source]);

  const errorLine = error ? error.slice(0, 200) : '';

  if (showHelp) {
    return (
      <Box flexDirection="column" paddingX={1} height={termHeight}>
        <HelpScreen />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} height={termHeight}>
      <Header
        sourceName={source.name}
        dbName={source.from.databaseName}
        tableName={source.from.tableName}
        isFollowing={isFollowing}
        loading={loading}
        timeRange={timeRange}
      />
      <TabBar items={switchItems} activeIdx={activeIdx} />
      <SearchBar
        focused={focusSearch}
        query={searchQuery}
        onChange={setSearchQuery}
        onSubmit={handleSubmitSearch}
      />

      {expandedRow !== null ? (
        /* ---- Detail panel (replaces table when a row is expanded) ---- */
        <Box
          flexDirection="column"
          marginTop={1}
          flexGrow={1}
          overflowY="hidden"
        >
          {/* Back hint */}
          <Text dimColor>esc=back to table</Text>
          {/* Summary header */}
          <Box marginTop={1} marginBottom={1}>
            <Text color="cyan" bold>
              {(() => {
                const eRow = visibleRows.find(
                  (_, i) => scrollOffset + i === expandedRow,
                );
                if (!eRow) return '';
                return source.kind === 'trace'
                  ? `${eRow.cells[1] || ''} > ${eRow.cells[2] || ''}`
                  : flatten(
                      String(eRow.raw[source.bodyExpression ?? 'Body'] ?? ''),
                    ).slice(0, 200);
              })()}
            </Text>
          </Box>
          <Text dimColor>{'─'.repeat(80)}</Text>
          {/* Column values — from full row fetch (SELECT *) */}
          {expandedRowLoading ? (
            <Text>
              <Spinner type="dots" /> Loading all fields…
            </Text>
          ) : (
            <Box flexDirection="column">
              {Object.entries(expandedRowData ?? {}).map(([key, value]) => {
                // Handle objects/arrays that ClickHouse returns as parsed JSON
                let strVal: string;
                if (value != null && typeof value === 'object') {
                  strVal = JSON.stringify(value, null, 2);
                } else {
                  strVal = String(value ?? '');
                }
                let displayVal: string;
                if (strVal.startsWith('{') || strVal.startsWith('[')) {
                  try {
                    displayVal = JSON.stringify(JSON.parse(strVal), null, 2);
                  } catch {
                    displayVal = strVal;
                  }
                } else {
                  displayVal = strVal;
                }
                return (
                  <Box key={key}>
                    <Box width={35} flexShrink={0}>
                      <Text color="cyan" wrap="truncate">
                        {key}
                      </Text>
                    </Box>
                    <Box flexGrow={1}>
                      <Text wrap={wrapLines ? 'wrap' : 'truncate'}>
                        {wrapLines ? displayVal : flatten(displayVal)}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      ) : (
        /* ---- Table view ---- */
        <Box flexDirection="column" marginTop={1} height={maxRows + 1}>
          <TableHeader columns={columns} />

          {errorLine ? (
            <Text color="red" wrap="truncate">
              {errorLine}
            </Text>
          ) : visibleRows.length === 0 && !loading ? (
            <Text dimColor>No events found.</Text>
          ) : null}

          {visibleRows.map((row, i) => {
            const isSelected = i === selectedRow && !focusSearch;
            return (
              <Box key={i}>
                <Box width={2}>
                  <Text color="cyan" bold>
                    {isSelected ? '▸' : ' '}
                  </Text>
                </Box>
                {row.cells.map((cell, ci) => (
                  <Box key={ci} width={columns[ci]?.width ?? '10%'}>
                    <Text
                      wrap={wrapLines ? 'wrap' : 'truncate'}
                      color={
                        isSelected
                          ? 'cyan'
                          : ci === 0
                            ? 'gray'
                            : row.severityColor && ci === 1
                              ? row.severityColor
                              : undefined
                      }
                      bold={(ci === 1 && !!row.severityColor) || isSelected}
                      dimColor={ci === 0 && !isSelected}
                      inverse={isSelected}
                    >
                      {cell}
                    </Text>
                  </Box>
                ))}
              </Box>
            );
          })}

          {visibleRows.length < maxRows &&
            Array.from({ length: maxRows - visibleRows.length }).map((_, i) => (
              <Text key={`pad-${i}`}> </Text>
            ))}
        </Box>
      )}

      <Footer
        rowCount={events.length}
        cursorPos={scrollOffset + selectedRow + 1}
        wrapLines={wrapLines}
        isFollowing={isFollowing}
        loadingMore={loadingMore}
      />
    </Box>
  );
}
