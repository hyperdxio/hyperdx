import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';

interface UseTableSearchOptions {
  /**
   * The rows to search through
   */
  rows: Record<string, any>[];
  /**
   * The columns to search in
   */
  searchableColumns: string[];
  /**
   * Debounce delay in milliseconds
   * @default 300
   */
  debounceMs?: number;
  /**
   * Called when search visibility changes
   */
  onVisibilityChange?: (visible: boolean) => void;
}

interface UseTableSearchReturn {
  searchQuery: string;
  inputValue: string;
  setInputValue: (query: string) => void;
  matchIndices: number[];
  currentMatchIndex: number;
  isSearchVisible: boolean;
  setIsSearchVisible: (visible: boolean) => void;
  shouldScrollToMatch: boolean;
  clearShouldScrollToMatch: () => void;
  handlePreviousMatch: () => void;
  handleNextMatch: () => void;
  handleMatchClick: (index: number) => void;
  handleSearchChange: (value: string) => void;
  resetSearch: () => void;
}

/**
 * Custom hook to manage table search functionality with debouncing.
 * Handles search state, match tracking, and navigation between matches.
 */
export function useTableSearch({
  rows,
  searchableColumns,
  debounceMs = 300,
  onVisibilityChange,
}: UseTableSearchOptions): UseTableSearchReturn {
  const [inputValue, setInputValue] = useState('');
  const [debouncedSearchQuery] = useDebouncedValue(inputValue, debounceMs);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchIndices, setMatchIndices] = useState<number[]>([]);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const shouldScrollToMatchRef = useRef(false);

  // Search through all rows when debounced query changes
  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      setMatchIndices([]);
      setCurrentMatchIndex(0);
      return;
    }

    const query = debouncedSearchQuery.toLowerCase();
    const foundMatches: number[] = [];

    rows.forEach((row, index) => {
      // Search through all searchable columns
      const rowText = searchableColumns
        .map(col => {
          const value = (row as Record<string, any>)[col];
          return value != null ? String(value).toLowerCase() : '';
        })
        .join(' ');

      if (rowText.includes(query)) {
        foundMatches.push(index);
      }
    });

    const previousMatchCount = matchIndices.length;
    setMatchIndices(foundMatches);

    // Only reset to first match if this is a new search (not just loading more data)
    // If we had matches before and still have matches, try to stay on the same match
    if (previousMatchCount === 0 && foundMatches.length > 0) {
      setCurrentMatchIndex(0);
      shouldScrollToMatchRef.current = true;
    } else if (
      foundMatches.length > 0 &&
      currentMatchIndex >= foundMatches.length
    ) {
      // If current match is now out of bounds, go to last match
      setCurrentMatchIndex(foundMatches.length - 1);
      shouldScrollToMatchRef.current = true;
    }
    // Otherwise keep the current match index as is (loading more data shouldn't change position)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, rows, searchableColumns]);

  // Handle visibility changes
  useEffect(() => {
    onVisibilityChange?.(isSearchVisible);
  }, [isSearchVisible, onVisibilityChange]);

  const handleSearchChange = useCallback((value: string) => {
    setInputValue(value);
    // Reset match state when query is cleared
    if (!value) {
      setMatchIndices([]);
      setCurrentMatchIndex(0);
      shouldScrollToMatchRef.current = false;
    }
  }, []);

  const handlePreviousMatch = useCallback(() => {
    shouldScrollToMatchRef.current = true;
    setCurrentMatchIndex(prev =>
      prev > 0 ? prev - 1 : matchIndices.length - 1,
    );
  }, [matchIndices.length]);

  const handleNextMatch = useCallback(() => {
    shouldScrollToMatchRef.current = true;
    setCurrentMatchIndex(prev =>
      prev < matchIndices.length - 1 ? prev + 1 : 0,
    );
  }, [matchIndices.length]);

  const handleMatchClick = useCallback((index: number) => {
    shouldScrollToMatchRef.current = true;
    setCurrentMatchIndex(index);
  }, []);

  const resetSearch = useCallback(() => {
    setInputValue('');
    setMatchIndices([]);
    setCurrentMatchIndex(0);
    shouldScrollToMatchRef.current = false;
    setIsSearchVisible(false);
  }, []);

  const clearShouldScrollToMatch = useCallback(() => {
    shouldScrollToMatchRef.current = false;
  }, []);

  return {
    searchQuery: debouncedSearchQuery,
    inputValue,
    setInputValue,
    matchIndices,
    currentMatchIndex,
    isSearchVisible,
    setIsSearchVisible,
    shouldScrollToMatch: shouldScrollToMatchRef.current,
    clearShouldScrollToMatch,
    handlePreviousMatch,
    handleNextMatch,
    handleMatchClick,
    handleSearchChange,
    resetSearch,
  };
}
