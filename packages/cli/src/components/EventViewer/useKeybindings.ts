import { useCallback } from 'react';
import { useInput } from 'ink';

import type { SourceResponse, SavedSearchResponse } from '@/api/client';
import {
  openEditorForSelect,
  openEditorForTimeRange,
  type TimeRange,
} from '@/utils/editor';

import type { EventRow, SwitchItem } from './types';

// ---- Types ---------------------------------------------------------

export interface KeybindingParams {
  // State values
  focusSearch: boolean;
  focusDetailSearch: boolean;
  showHelp: boolean;
  showSql: boolean;
  expandedRow: number | null;
  detailTab: 'overview' | 'columns' | 'trace';
  selectedRow: number;
  scrollOffset: number;
  isFollowing: boolean;
  hasMore: boolean;
  events: EventRow[];
  maxRows: number;
  visibleRowCount: number;
  source: SourceResponse;
  timeRange: TimeRange;
  customSelect: string | undefined;
  detailMaxRows: number;
  fullDetailMaxRows: number;

  // Tab switching
  switchItems: SwitchItem[];
  findActiveIndex: () => number;
  onSavedSearchSelect: (search: SavedSearchResponse) => void;

  // Navigation
  onOpenAlerts?: () => void;

  // State setters
  setFocusSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setFocusDetailSearch: React.Dispatch<React.SetStateAction<boolean>>;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSql: React.Dispatch<React.SetStateAction<boolean>>;
  setSqlScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setSelectedRow: React.Dispatch<React.SetStateAction<number>>;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setExpandedRow: React.Dispatch<React.SetStateAction<number | null>>;
  setDetailTab: React.Dispatch<
    React.SetStateAction<'overview' | 'columns' | 'trace'>
  >;
  setIsFollowing: React.Dispatch<React.SetStateAction<boolean>>;
  setWrapLines: React.Dispatch<React.SetStateAction<boolean>>;

  setDetailSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setTraceSelectedIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setTraceDetailScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setColumnValuesScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  setCustomSelectMap: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;

  // Refs
  wasFollowingRef: React.MutableRefObject<boolean>;

  // Callbacks
  fetchNextPage: () => Promise<void>;
}

// ---- Hook ----------------------------------------------------------

export function useKeybindings(params: KeybindingParams): void {
  const {
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
  } = params;

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

    // When SQL preview is showing, D/Esc close it, Ctrl+D/U scroll
    if (showSql) {
      if (input === 'D' || key.escape) {
        setShowSql(false);
        setSqlScrollOffset(0);
        return;
      }
      if (key.ctrl && input === 'd') {
        setSqlScrollOffset(prev => prev + 5);
        return;
      }
      if (key.ctrl && input === 'u') {
        setSqlScrollOffset(prev => Math.max(0, prev - 5));
        return;
      }
      if (input === 'q') process.exit(0);
      return;
    }

    if (focusDetailSearch) {
      if (key.escape || key.return) {
        setFocusDetailSearch(false);
        return;
      }
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
    // j/k in Trace tab: navigate spans/log events in the waterfall
    // Ctrl+D/U: scroll Event Details section
    if (expandedRow !== null && detailTab === 'trace') {
      if (input === 'j' || key.downArrow) {
        setTraceSelectedIndex(prev => (prev === null ? 0 : prev + 1));
        setTraceDetailScrollOffset(0); // reset detail scroll on span change
        return;
      }
      if (input === 'k' || key.upArrow) {
        setTraceSelectedIndex(prev =>
          prev === null ? 0 : Math.max(0, prev - 1),
        );
        setTraceDetailScrollOffset(0); // reset detail scroll on span change
        return;
      }
      const detailHalfPage = Math.max(1, Math.floor(detailMaxRows / 2));
      if (key.ctrl && input === 'd') {
        setTraceDetailScrollOffset(prev => prev + detailHalfPage);
        return;
      }
      if (key.ctrl && input === 'u') {
        setTraceDetailScrollOffset(prev => Math.max(0, prev - detailHalfPage));
        return;
      }
    }
    // Ctrl+D/U in Column Values / Overview tab: scroll the detail view
    if (
      expandedRow !== null &&
      (detailTab === 'columns' || detailTab === 'overview')
    ) {
      const detailHalfPage = Math.max(1, Math.floor(fullDetailMaxRows / 2));
      if (key.ctrl && input === 'd') {
        setColumnValuesScrollOffset(prev => prev + detailHalfPage);
        return;
      }
      if (key.ctrl && input === 'u') {
        setColumnValuesScrollOffset(prev => Math.max(0, prev - detailHalfPage));
        return;
      }
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
        setDetailTab('overview');
        setDetailSearchQuery('');
        setFocusDetailSearch(false);
        setColumnValuesScrollOffset(0);
        // Pause follow mode while detail panel is open
        wasFollowingRef.current = isFollowing;
        setIsFollowing(false);
      }
      return;
    }
    if (key.escape || input === 'h') {
      if (focusDetailSearch) {
        setFocusDetailSearch(false);
        return;
      }
      if (expandedRow !== null) {
        setExpandedRow(null);
        setDetailTab('columns');
        // Restore follow mode if it was active before expanding
        if (wasFollowingRef.current) {
          setIsFollowing(true);
        }
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
      // When detail panel is open, Tab cycles through detail tabs
      if (expandedRow !== null) {
        const hasTrace =
          source.kind === 'trace' ||
          (source.kind === 'log' && source.traceSourceId);
        const tabs: Array<'overview' | 'columns' | 'trace'> = hasTrace
          ? ['overview', 'columns', 'trace']
          : ['overview', 'columns'];
        setTraceSelectedIndex(null);
        setTraceDetailScrollOffset(0);
        setColumnValuesScrollOffset(0);
        setDetailTab(prev => {
          const idx = tabs.indexOf(prev);
          const dir = key.shift ? -1 : 1;
          return tabs[(idx + dir + tabs.length) % tabs.length];
        });
        return;
      }
      handleTabSwitch(key.shift ? -1 : 1);
      return;
    }
    if (input === 'A' && onOpenAlerts) {
      onOpenAlerts();
      return;
    }
    if (input === 'w') setWrapLines(w => !w);
    // f = toggle follow mode (disabled in detail panel — follow is
    // automatically paused on expand and restored on close)
    if (input === 'f' && expandedRow === null) {
      setIsFollowing(prev => !prev);
    }
    // D = show generated SQL
    if (input === 'D') {
      setShowSql(true);
      setSqlScrollOffset(0);
      return;
    }
    if (input === '/') {
      if (expandedRow !== null) {
        setFocusDetailSearch(true);
      } else {
        setFocusSearch(true);
      }
    }
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
    // s = edit select clause in $EDITOR
    if (input === 's') {
      setTimeout(() => {
        const currentSelect =
          customSelect ?? source.defaultTableSelectExpression ?? '';
        const result = openEditorForSelect(currentSelect);
        if (result != null) {
          setCustomSelectMap(prev => ({
            ...prev,
            [source.id]: result,
          }));
          setScrollOffset(0);
          setSelectedRow(0);
        }
      }, 50);
      return;
    }
    if (input === 'q') process.exit(0);
  });
}
