import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Group,
  Paper,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconX } from '@tabler/icons-react';

import { isElementClickable } from '@/utils';

interface HighlightTextSettings {
  isCurrentMatch: boolean;
  textColor: string;
  backgroundColor: string;
  currentMatchBackgroundColor: string;
}

/**
 * Helper function to highlight text matching a search query within the text of
 * a TextNode.
 *
 * @param text - The text (part of the TextNode) to highlight within
 * @param query - The query to highlight
 * @param isCurrentMatch - Whether the text is the current match. Current match is
 * highlighted with an orange background.
 * @returns The text node with the matching query highlighted.
 */
export const highlightText = (
  text: string,
  query: string,
  settings: Partial<HighlightTextSettings> = {},
): React.ReactNode => {
  if (!query.trim()) return text;

  const backgroundColor = settings.isCurrentMatch
    ? settings.currentMatchBackgroundColor || 'var(--mantine-color-orange-5)'
    : settings.backgroundColor || 'var(--mantine-color-yellow-3)';

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);

  while (index !== -1) {
    // Add text before match
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    // Add highlighted match - use orange for current match, yellow for others
    parts.push(
      <mark
        key={`${index}-${lastIndex}`}
        style={{
          backgroundColor,
          color: settings.textColor || 'var(--color-text-inverted)',
          padding: 0,
        }}
      >
        {text.slice(index, index + query.length)}
      </mark>,
    );
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
};

interface TableSearchInputProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  matchIndices: number[];
  currentMatchIndex: number;
  onPreviousMatch: () => void;
  onNextMatch: () => void;
  /**
   * Control visibility from parent
   */
  isVisible?: boolean;
  /**
   * Called when visibility changes
   */
  onVisibilityChange?: (visible: boolean) => void;
  /**
   * Reference to a container element to check if it's clickable (not obscured by modal/drawer)
   */
  containerRef?: HTMLElement | null;
}

/**
 * A search input component that handles Cmd+F/Ctrl+F keyboard shortcuts.
 * The parent is responsible for performing the actual search and managing match state.
 */
export const TableSearchInput = ({
  searchQuery,
  onSearchChange,
  matchIndices,
  currentMatchIndex,
  onPreviousMatch,
  onNextMatch,
  isVisible: externalIsVisible,
  onVisibilityChange,
  containerRef,
}: TableSearchInputProps) => {
  const [internalIsVisible, setInternalIsVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use external visibility if provided, otherwise use internal state
  const isVisible = externalIsVisible ?? internalIsVisible;

  const handleClose = useCallback(() => {
    if (externalIsVisible !== undefined) {
      onVisibilityChange?.(false);
    } else {
      setInternalIsVisible(false);
    }
    onSearchChange('');
  }, [externalIsVisible, onSearchChange, onVisibilityChange]);

  const handleShow = useCallback(() => {
    if (externalIsVisible !== undefined) {
      onVisibilityChange?.(true);
    } else {
      setInternalIsVisible(true);
    }
    // Focus the input after a brief delay to ensure it's rendered
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }, [externalIsVisible, onVisibilityChange]);

  // Handle keyboard shortcuts (Cmd+F, Escape)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Detect Cmd+F (Mac) or Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // if container exists, verify it's actually clickable
        if (containerRef && !isElementClickable(containerRef)) return;

        e.preventDefault();
        handleShow();
      }
      // Close search on Escape
      if (e.key === 'Escape' && isVisible) {
        handleClose();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isVisible, handleClose, handleShow],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && matchIndices.length > 0) {
        if (e.shiftKey) {
          // Shift+Enter: previous match
          onPreviousMatch();
        } else {
          // Enter: next match
          onNextMatch();
        }
        e.preventDefault();
      }
    },
    [matchIndices.length, onPreviousMatch, onNextMatch],
  );

  if (!isVisible) {
    return null;
  }
  return (
    <Paper
      p="xs"
      withBorder
      shadow="md"
      pos="absolute"
      top={8}
      right={8}
      style={{ zIndex: 2 }}
      miw={400}
      maw={500}
      role="search"
      aria-label="Table search"
    >
      <Group gap="xs" align="center" wrap="nowrap">
        <TextInput
          ref={searchInputRef}
          placeholder="Find in table..."
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Search table contents"
          aria-describedby={
            matchIndices.length > 0 ? 'search-match-count' : undefined
          }
          rightSection={
            searchQuery ? (
              <UnstyledButton
                onClick={() => onSearchChange('')}
                display="flex"
                style={{ alignItems: 'center' }}
                title="Clear search"
                aria-label="Clear search"
              >
                <IconX size={14} />
              </UnstyledButton>
            ) : null
          }
        />
        {matchIndices.length > 0 ? (
          <>
            <Text
              id="search-match-count"
              size="xs"
              c="dimmed"
              style={{ whiteSpace: 'nowrap' }}
              aria-live="polite"
            >
              {currentMatchIndex + 1} of {matchIndices.length}
            </Text>
            <Group gap={4}>
              <UnstyledButton
                onClick={onPreviousMatch}
                display="flex"
                style={{ alignItems: 'center' }}
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
              >
                <IconArrowUp size={16} />
              </UnstyledButton>
              <UnstyledButton
                onClick={onNextMatch}
                display="flex"
                style={{ alignItems: 'center' }}
                title="Next match (Enter)"
                aria-label="Next match"
              >
                <IconArrowDown size={16} />
              </UnstyledButton>
            </Group>
          </>
        ) : searchQuery ? (
          <Text
            size="xs"
            c="dimmed"
            style={{ whiteSpace: 'nowrap' }}
            role="status"
            aria-live="polite"
          >
            No matches
          </Text>
        ) : null}
        <UnstyledButton
          onClick={handleClose}
          display="flex"
          style={{ alignItems: 'center' }}
          title="Close search (Esc)"
          aria-label="Close search"
        >
          <IconX size={16} />
        </UnstyledButton>
      </Group>
    </Paper>
  );
};

interface TableSearchMatchIndicatorProps {
  searchQuery: string;
  matchIndices: number[];
  currentMatchIndex: number;
  dedupedRows: Record<string, any>[];
  tableRows: any[];
  getRowId: (row: Record<string, any>) => string;
  onMatchClick: (index: number) => void;
}

/**
 * Visual indicators on the scrollbar showing where search matches are located.
 * Renders as a vertical strip on the right side of the table with clickable markers.
 */
export const TableSearchMatchIndicator = ({
  searchQuery,
  matchIndices,
  currentMatchIndex,
  dedupedRows,
  tableRows,
  getRowId,
  onMatchClick,
}: TableSearchMatchIndicatorProps) => {
  if (!searchQuery || matchIndices.length === 0 || tableRows.length === 0) {
    return null;
  }

  return (
    <Box
      pos="absolute"
      right={0}
      top={0}
      bottom={0}
      w={8}
      style={{ pointerEvents: 'none', zIndex: 1 }}
    >
      {matchIndices.map((matchIndex, i) => {
        const matchRow = dedupedRows[matchIndex];
        if (!matchRow) return null;

        const tableRowIndex = tableRows.findIndex(
          row => getRowId(row.original) === getRowId(matchRow),
        );

        if (tableRowIndex === -1) return null;

        // Calculate position as percentage of total rows
        const percentage = (tableRowIndex / tableRows.length) * 100;
        // Calculate height based on number of rows (each indicator represents 1/n of the scrollbar)
        const heightPercentage = 100 / tableRows.length;
        const isCurrentMatchIndicator = i === currentMatchIndex;

        return (
          <Box
            key={`match-indicator-${matchIndex}`}
            pos="absolute"
            top={`${percentage}%`}
            right={0}
            w="100%"
            h={`${heightPercentage}%`}
            bg={
              isCurrentMatchIndicator
                ? 'var(--mantine-color-orange-5)'
                : 'var(--mantine-color-yellow-5)'
            }
            style={{
              cursor: 'pointer',
              pointerEvents: 'auto',
              minHeight: 1,
              maxHeight: 4,
            }}
            onClick={() => onMatchClick(i)}
            title={`Match ${i + 1} of ${matchIndices.length}`}
          />
        );
      })}
    </Box>
  );
};
