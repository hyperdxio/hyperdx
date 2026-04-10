import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';

import type { SourceResponse, SavedSearchResponse } from '@/api/client';

export interface SpotlightItem {
  id: string;
  type: 'source' | 'saved-search' | 'page';
  label: string;
  description?: string;
  source?: SourceResponse;
  search?: SavedSearchResponse;
  page?: string;
}

interface SpotlightProps {
  items: SpotlightItem[];
  onSelect: (item: SpotlightItem) => void;
  onClose: () => void;
}

export function buildSpotlightItems(
  sources: SourceResponse[],
  savedSearches: SavedSearchResponse[],
): SpotlightItem[] {
  const items: SpotlightItem[] = [];

  for (const source of sources) {
    items.push({
      id: `source-${source.id}`,
      type: 'source',
      label: source.name,
      description: `${source.from.databaseName}.${source.from.tableName}`,
      source,
    });
  }

  for (const ss of savedSearches) {
    const src = sources.find(s => s.id === ss.source || s._id === ss.source);
    items.push({
      id: `search-${ss.id || ss._id}`,
      type: 'saved-search',
      label: ss.name,
      description: src ? `${src.name} — ${ss.where || '(no filter)'}` : ss.where,
      search: ss,
    });
  }

  items.push({
    id: 'page-alerts',
    type: 'page',
    label: 'Alerts',
    description: 'View alert rules and recent history',
    page: 'alerts',
  });

  return items;
}

export default function Spotlight({ items, onSelect, onClose }: SpotlightProps) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const termWidth = stdout?.columns ?? 80;
  const maxVisible = Math.min(items.length, Math.max(5, termHeight - 8));

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        item.type.toLowerCase().includes(q),
    );
  }, [items, query]);

  const visibleItems = filtered.slice(0, maxVisible);
  const clampedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      if (filtered.length > 0) {
        onSelect(filtered[clampedIdx]);
      }
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setSelectedIdx(prev => Math.min(prev + 1, filtered.length - 1));
      return;
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setSelectedIdx(prev => Math.max(0, prev - 1));
      return;
    }
  });

  const boxWidth = Math.min(60, termWidth - 4);

  const typeLabel = (type: SpotlightItem['type']) => {
    switch (type) {
      case 'source':
        return 'Source';
      case 'saved-search':
        return 'Search';
      case 'page':
        return 'Page';
    }
  };

  const typeColor = (type: SpotlightItem['type']) => {
    switch (type) {
      case 'source':
        return 'green';
      case 'saved-search':
        return 'yellow';
      case 'page':
        return 'magenta';
    }
  };

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      width={boxWidth}
      borderStyle="round"
      borderColor="cyan"
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Go to…
        </Text>
        <Text dimColor> (Ctrl+K)</Text>
      </Box>

      <Box>
        <Text color="cyan">&gt; </Text>
        <TextInput
          value={query}
          onChange={v => {
            setQuery(v);
            setSelectedIdx(0);
          }}
          placeholder="Type to filter…"
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visibleItems.length === 0 ? (
          <Text dimColor>No results</Text>
        ) : (
          visibleItems.map((item, i) => {
            const isSelected = i === clampedIdx;
            return (
              <Box key={item.id}>
                <Text
                  color={isSelected ? 'cyan' : undefined}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {isSelected ? ' ▸ ' : '   '}
                  <Text color={typeColor(item.type)} bold={isSelected} inverse={isSelected}>
                    [{typeLabel(item.type)}]
                  </Text>
                  {' '}
                  {item.label}
                  {item.description ? (
                    <Text dimColor={!isSelected} inverse={isSelected}>
                      {' '}
                      — {item.description}
                    </Text>
                  ) : null}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {filtered.length > maxVisible && (
        <Box marginTop={1}>
          <Text dimColor>
            {filtered.length - maxVisible} more…
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  Enter select  Esc close</Text>
      </Box>
    </Box>
  );
}
