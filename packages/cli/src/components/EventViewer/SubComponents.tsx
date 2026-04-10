import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';

import ErrorDisplay from '@/components/ErrorDisplay';
import type { TimeRange } from '@/utils/editor';

import type { Column, SwitchItem } from './types';
import { formatShortDate } from './utils';

// ---- Header --------------------------------------------------------

type HeaderProps = {
  sourceName: string;
  dbName: string;
  tableName: string;
  isFollowing: boolean;
  loading: boolean;
  timeRange: TimeRange;
};

export const Header = React.memo(function Header({
  sourceName,
  dbName,
  tableName,
  isFollowing,
  loading,
  timeRange,
}: HeaderProps) {
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

// ---- TabBar --------------------------------------------------------

type TabBarProps = {
  items: SwitchItem[];
  activeIdx: number;
};

export const TabBar = React.memo(function TabBar({
  items,
  activeIdx,
}: TabBarProps) {
  if (items.length <= 1) return null;
  return (
    <Box height={1} overflowX="hidden" overflowY="hidden">
      {items.map((item, i) => (
        <Box key={`${item.type}-${i}`} marginRight={2}>
          <Text
            color={i === activeIdx ? 'cyan' : undefined}
            bold={i === activeIdx}
            dimColor={i !== activeIdx}
            wrap="truncate"
          >
            {i === activeIdx ? '▸ ' : '  '}
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

// ---- SearchBar -----------------------------------------------------

type SearchBarProps = {
  focused: boolean;
  query: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
};

export const SearchBar = React.memo(function SearchBar({
  focused,
  query,
  onChange,
  onSubmit,
}: SearchBarProps) {
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

// ---- Footer --------------------------------------------------------

type FooterProps = {
  rowCount: number;
  cursorPos: number;
  wrapLines: boolean;
  isFollowing: boolean;
  loadingMore: boolean;
  paginationError?: Error | null;
  scrollInfo?: string;
};

export const Footer = React.memo(function Footer({
  rowCount,
  cursorPos,
  wrapLines,
  isFollowing,
  loadingMore,
  paginationError,
  scrollInfo,
}: FooterProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {paginationError && (
        <ErrorDisplay
          error={paginationError}
          severity="warning"
          detail="Failed to load more results."
          compact
        />
      )}
      <Box justifyContent="space-between">
        <Text dimColor>
          {isFollowing ? '[FOLLOWING] ' : ''}
          {wrapLines ? '[WRAP] ' : ''}
          {loadingMore ? '[LOADING…] ' : ''}?=help q=quit
        </Text>
        <Text dimColor>
          {scrollInfo ? `${scrollInfo}  ` : ''}
          {cursorPos}/{rowCount}
        </Text>
      </Box>
    </Box>
  );
});

// ---- HelpScreen ----------------------------------------------------

export const HelpScreen = React.memo(function HelpScreen() {
  const keys: Array<[string, string]> = [
    ['j / ↓', 'Move selection down'],
    ['k / ↑', 'Move selection up'],
    ['l / Enter', 'Expand row detail (SELECT *)'],
    ['h / Esc', 'Close row detail'],
    ['Tab (detail)', 'Switch Column Values / Trace'],
    ['G', 'Jump to last item'],
    ['g', 'Jump to first item'],
    ['Ctrl+D', 'Page down (half page)'],
    ['Ctrl+U', 'Page up (half page)'],
    ['/', 'Search (global or detail filter)'],
    ['Esc', 'Blur search bar'],
    ['Tab', 'Next source / saved search'],
    ['Shift+Tab', 'Previous source / saved search'],
    ['t', 'Edit time range in $EDITOR'],
    ['s', 'Edit select clause in $EDITOR'],
    ['D', 'Show generated SQL'],
    ['f', 'Toggle follow mode (live tail)'],
    ['w', 'Toggle line wrap'],
    ['Ctrl+K', 'Open spotlight (quick navigation)'],
    ['A (Shift+A)', 'Open alerts page'],
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

// ---- TableHeader ---------------------------------------------------

type TableHeaderProps = {
  columns: Column[];
};

export const TableHeader = React.memo(function TableHeader({
  columns,
}: TableHeaderProps) {
  return (
    <Box overflowX="hidden">
      {columns.map((col, i) => (
        <Box key={i} width={col.width} overflowX="hidden">
          <Text bold dimColor wrap="truncate">
            {col.header}
          </Text>
        </Box>
      ))}
    </Box>
  );
});

// ---- SqlPreviewScreen ----------------------------------------------

type SqlPreviewScreenProps = {
  chSql: { sql: string; params: Record<string, unknown> } | null;
  scrollOffset: number;
  maxRows: number;
};

export const SqlPreviewScreen = React.memo(function SqlPreviewScreen({
  chSql,
  scrollOffset,
  maxRows,
}: SqlPreviewScreenProps) {
  let resolvedSql = '';
  if (chSql) {
    try {
      resolvedSql = parameterizedQueryToSql({
        sql: chSql.sql,
        params: chSql.params,
      });
    } catch {
      // Fall back to the raw parameterized SQL if resolution fails
      resolvedSql = chSql.sql;
    }
  }

  const lines = resolvedSql ? resolvedSql.split('\n') : [];
  const visibleLines = lines.slice(scrollOffset, scrollOffset + maxRows);
  const totalLines = lines.length;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        Generated SQL
      </Text>
      <Text> </Text>
      {resolvedSql ? (
        visibleLines.map((line, i) => (
          <Text key={i} wrap="wrap">
            {line}
          </Text>
        ))
      ) : (
        <Text dimColor>No query has been executed yet.</Text>
      )}
      {totalLines > maxRows && (
        <>
          <Text> </Text>
          <Text dimColor>
            Lines {scrollOffset + 1}–
            {Math.min(scrollOffset + maxRows, totalLines)} of {totalLines}{' '}
            (Ctrl+D/U to scroll)
          </Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor>Press D or Esc to close</Text>
    </Box>
  );
});
