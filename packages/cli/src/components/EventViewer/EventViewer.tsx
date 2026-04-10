import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Box, useStdout } from 'ink';

import type { TimeRange } from '@/utils/editor';

import type { EventViewerProps, SwitchItem } from './types';
import { getColumns, getDynamicColumns, formatDynamicRow } from './utils';
import {
  Header,
  TabBar,
  SearchBar,
  Footer,
  HelpScreen,
  SqlPreviewScreen,
} from './SubComponents';
import { TableView } from './TableView';
import { DetailPanel } from './DetailPanel';
import { useEventData } from './useEventData';
import { useKeybindings } from './useKeybindings';

export default function EventViewer({
  clickhouseClient,
  metadata,
  source,
  sources,
  savedSearches,
  onSavedSearchSelect,
  onOpenAlerts,
  initialQuery = '',
  follow = true,
}: EventViewerProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const maxRows = Math.max(1, termHeight - 8);
  // Fixed height for Event Details in Trace tab (about 1/3 of terminal)
  const detailMaxRows = Math.max(5, Math.floor(termHeight / 3));
  // Full-screen height for Overview/Column Values tabs
  // (termHeight minus header, body preview, tab bar, separator, footer)
  const fullDetailMaxRows = Math.max(5, termHeight - 9);

  // ---- UI state ----------------------------------------------------

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [isFollowing, setIsFollowing] = useState(follow);
  const wasFollowingRef = useRef(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [focusSearch, setFocusSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [sqlScrollOffset, setSqlScrollOffset] = useState(0);
  const [traceChSql, setTraceChSql] = useState<{
    sql: string;
    params: Record<string, unknown>;
  } | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const [customSelectMap, setCustomSelectMap] = useState<
    Record<string, string>
  >({});
  const customSelect = customSelectMap[source.id] as string | undefined;
  const [selectedRow, setSelectedRow] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'columns' | 'trace'>(
    'overview',
  );
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [focusDetailSearch, setFocusDetailSearch] = useState(false);
  const [traceDetailScrollOffset, setTraceDetailScrollOffset] = useState(0);
  const [columnValuesScrollOffset, setColumnValuesScrollOffset] = useState(0);
  const [traceSelectedIndex, setTraceSelectedIndex] = useState<number | null>(
    null,
  );
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const now = new Date();
    return { start: new Date(now.getTime() - 60 * 60 * 1000), end: now };
  });

  // ---- Data fetching -----------------------------------------------

  const {
    events,
    loading,
    error,
    hasMore,
    loadingMore,
    paginationError,
    expandedRowData,
    expandedRowLoading,
    expandedRowError,
    expandedTraceId,
    expandedSpanId,
    lastChSql,
    lastExpandedChSql,
    fetchNextPage,
  } = useEventData({
    clickhouseClient,
    metadata,
    source,
    customSelect,
    submittedQuery,
    timeRange,
    isFollowing,
    setTimeRange,
    expandedRow,
  });

  // ---- Derived values ----------------------------------------------

  const columns = useMemo(
    () => (events.length > 0 ? getDynamicColumns(events) : getColumns(source)),
    [source, events],
  );

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
  const visibleRowCount = Math.min(events.length - scrollOffset, maxRows);

  // Determine which SQL to show based on current context
  const activeChSql = useMemo(() => {
    if (expandedRow === null) return lastChSql;
    if (detailTab === 'trace') return traceChSql;
    // overview / columns tabs use the expanded row SELECT * query
    return lastExpandedChSql;
  }, [expandedRow, detailTab, lastChSql, lastExpandedChSql, traceChSql]);

  // ---- Keybindings -------------------------------------------------

  useKeybindings({
    focusSearch,
    focusDetailSearch,
    showHelp,
    showSql,
    expandedRow,
    detailTab,
    selectedRow,
    scrollOffset,
    isFollowing,
    hasMore,
    events,
    maxRows,
    visibleRowCount,
    source,
    timeRange,
    customSelect,
    detailMaxRows,
    fullDetailMaxRows,
    switchItems,
    findActiveIndex,
    onSavedSearchSelect,
    onOpenAlerts,
    setFocusSearch,
    setFocusDetailSearch,
    setShowHelp,
    setShowSql,
    setSqlScrollOffset,
    setSelectedRow,
    setScrollOffset,
    setExpandedRow,
    setDetailTab,
    setIsFollowing,
    setWrapLines,
    setDetailSearchQuery,
    setTraceSelectedIndex,
    setTraceDetailScrollOffset,
    setColumnValuesScrollOffset,
    setTimeRange,
    setCustomSelectMap,
    wasFollowingRef,
    fetchNextPage,
  });

  // ---- Pre-format visible rows -------------------------------------

  const visibleRows = useMemo(() => {
    return events.slice(scrollOffset, scrollOffset + maxRows).map(row => ({
      ...formatDynamicRow(row, columns),
      raw: row,
    }));
  }, [events, scrollOffset, maxRows, columns]);

  // ---- Render ------------------------------------------------------

  // Reserve lines for header, padding, footer hint in SQL preview
  const sqlMaxRows = Math.max(5, termHeight - 6);

  // Overlays (help, SQL preview) hide the main content via display="none"
  // instead of unmounting it, so hooks keep running and cached data
  // (e.g. trace tab results) is preserved.
  const overlay = showHelp ? 'help' : showSql ? 'sql' : null;

  return (
    <Box flexDirection="column" height={termHeight}>
      {overlay === 'help' && (
        <Box flexDirection="column" paddingX={1} height={termHeight}>
          <HelpScreen />
        </Box>
      )}
      {overlay === 'sql' && (
        <Box flexDirection="column" paddingX={1} height={termHeight}>
          <SqlPreviewScreen
            chSql={activeChSql}
            scrollOffset={sqlScrollOffset}
            maxRows={sqlMaxRows}
          />
        </Box>
      )}
      <Box
        flexDirection="column"
        paddingX={1}
        display={overlay ? 'none' : 'flex'}
      >
        <Header
          sourceName={source.name}
          dbName={source.from.databaseName}
          tableName={source.from.tableName}
          isFollowing={isFollowing}
          loading={loading}
          timeRange={timeRange}
        />
        {expandedRow === null && (
          <>
            <TabBar items={switchItems} activeIdx={activeIdx} />
            <SearchBar
              focused={focusSearch}
              query={searchQuery}
              onChange={setSearchQuery}
              onSubmit={() => {
                setSubmittedQuery(searchQuery);
                setScrollOffset(0);
                setFocusSearch(false);
              }}
            />
          </>
        )}

        {expandedRow !== null ? (
          <DetailPanel
            source={source}
            sources={sources}
            clickhouseClient={clickhouseClient}
            detailTab={detailTab}
            expandedRowData={expandedRowData}
            expandedRowLoading={expandedRowLoading}
            expandedRowError={expandedRowError}
            expandedTraceId={expandedTraceId}
            expandedSpanId={expandedSpanId}
            traceSelectedIndex={traceSelectedIndex}
            onTraceSelectedIndexChange={setTraceSelectedIndex}
            detailSearchQuery={detailSearchQuery}
            focusDetailSearch={focusDetailSearch}
            onDetailSearchQueryChange={setDetailSearchQuery}
            onDetailSearchSubmit={() => setFocusDetailSearch(false)}
            wrapLines={wrapLines}
            termHeight={termHeight}
            fullDetailMaxRows={fullDetailMaxRows}
            detailMaxRows={detailMaxRows}
            columnValuesScrollOffset={columnValuesScrollOffset}
            traceDetailScrollOffset={traceDetailScrollOffset}
            expandedFormattedRow={visibleRows.find(
              (_, i) => scrollOffset + i === expandedRow,
            )}
            scrollOffset={scrollOffset}
            expandedRow={expandedRow}
            onTraceChSqlChange={setTraceChSql}
          />
        ) : (
          <TableView
            columns={columns}
            visibleRows={visibleRows}
            selectedRow={selectedRow}
            focusSearch={focusSearch}
            wrapLines={wrapLines}
            maxRows={maxRows}
            error={error}
            searchQuery={submittedQuery}
            loading={loading}
          />
        )}

        <Footer
          rowCount={events.length}
          cursorPos={scrollOffset + selectedRow + 1}
          wrapLines={wrapLines}
          isFollowing={isFollowing}
          loadingMore={loadingMore}
          paginationError={paginationError}
          scrollInfo={expandedRow !== null ? `Ctrl+D/U to scroll` : undefined}
        />
      </Box>
    </Box>
  );
}
