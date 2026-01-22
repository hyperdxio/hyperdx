import { act, renderHook, waitFor } from '@testing-library/react';

import { useTableSearch } from '../useTableSearch';

describe('useTableSearch', () => {
  // Realistic test data based on HyperDX logs
  const mockRows = [
    {
      timestamp: 'Jan 15 4:43:28.966 PM',
      ServiceName: 'hdx-oss-dev-app',
      StatusCode: 'Unset',
      SpanName: 'longtask',
      Duration: 69,
    },
    {
      timestamp: 'Jan 15 4:43:28.912 PM',
      ServiceName: 'hdx-oss-dev-app',
      StatusCode: 'Unset',
      SpanName: 'longtask',
      Duration: 54,
    },
    {
      timestamp: 'Jan 15 4:43:25.034 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'mongodb.update',
      Duration: 1,
    },
    {
      timestamp: 'Jan 15 4:43:25.021 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'dns.lookup',
      Duration: 0,
    },
    {
      timestamp: 'Jan 15 4:43:25.021 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'POST',
      Duration: 13,
    },
    {
      timestamp: 'Jan 15 4:43:25.020 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'router - /health',
      Duration: 0,
    },
    {
      timestamp: 'Jan 15 4:43:25.020 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'tcp.connect',
      Duration: 1,
    },
    {
      timestamp: 'Jan 15 4:43:25.020 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'middleware - isUserAuthenticated',
      Duration: 0,
    },
    {
      timestamp: 'Jan 15 4:43:25.019 PM',
      ServiceName: 'hdx-oss-dev-api',
      StatusCode: 'Unset',
      SpanName: 'middleware - corsMiddleware',
      Duration: 0,
    },
  ];

  const searchableColumns = ['ServiceName', 'SpanName', 'StatusCode'];

  describe('initialization', () => {
    it('should initialize with empty search state', () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0, // No debounce for tests
        }),
      );

      expect(result.current.inputValue).toBe('');
      expect(result.current.matchIndices).toEqual([]);
      expect(result.current.currentMatchIndex).toBe(0);
      expect(result.current.isSearchVisible).toBe(false);
      expect(result.current.shouldScrollToMatch).toBe(false);
    });
  });

  describe('search functionality', () => {
    it('should find matches for service name "hdx-oss-dev-api"', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('hdx-oss-dev-api');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(7);
      });

      expect(result.current.matchIndices).toEqual([2, 3, 4, 5, 6, 7, 8]);
    });

    it('should find matches for span name "mongodb"', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('mongodb');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      expect(result.current.matchIndices).toEqual([2]);
    });

    it('should find matches for "middleware" in span names', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      expect(result.current.matchIndices).toEqual([7, 8]);
    });

    it('should find matches for "longtask" in span names', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('longtask');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      expect(result.current.matchIndices).toEqual([0, 1]);
    });

    it('should perform case-insensitive search', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('MONGODB');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });
    });

    it('should find partial matches', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('dns');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      expect(result.current.matchIndices).toEqual([3]);
    });

    it('should return no matches for non-existent text', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('nonexistent');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(0);
      });
    });

    it('should search across multiple columns', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('Unset');
      });

      await waitFor(() => {
        // All rows have StatusCode: 'Unset'
        expect(result.current.matchIndices).toHaveLength(9);
      });
    });

    it('should clear matches when search is cleared', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('mongodb');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      act(() => {
        result.current.handleSearchChange('');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toEqual([]);
        expect(result.current.currentMatchIndex).toBe(0);
      });
    });

    it('should handle rows with null or undefined values', async () => {
      const rowsWithNulls = [
        ...mockRows,
        {
          timestamp: 'Jan 15 4:43:25.000 PM',
          ServiceName: null,
          StatusCode: undefined,
          SpanName: 'test',
          Duration: 0,
        },
      ];

      const { result } = renderHook(() =>
        useTableSearch({
          rows: rowsWithNulls,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('test');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      expect(result.current.matchIndices).toEqual([9]);
    });
  });

  describe('navigation between matches', () => {
    it('should navigate to next match', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      act(() => {
        result.current.handleNextMatch();
      });

      expect(result.current.currentMatchIndex).toBe(1);
      expect(result.current.shouldScrollToMatch).toBe(true);
    });

    it('should wrap to first match when navigating past the last match', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      // Navigate to last match
      act(() => {
        result.current.handleNextMatch();
      });

      expect(result.current.currentMatchIndex).toBe(1);

      // Navigate past last match should wrap to first
      act(() => {
        result.current.handleNextMatch();
      });

      expect(result.current.currentMatchIndex).toBe(0);
    });

    it('should navigate to previous match', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      // Navigate to second match
      act(() => {
        result.current.handleNextMatch();
      });

      expect(result.current.currentMatchIndex).toBe(1);

      // Navigate back to first match
      act(() => {
        result.current.handlePreviousMatch();
      });

      expect(result.current.currentMatchIndex).toBe(0);
    });

    it('should wrap to last match when navigating before the first match', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
        expect(result.current.currentMatchIndex).toBe(0);
      });

      // Navigate before first match should wrap to last
      act(() => {
        result.current.handlePreviousMatch();
      });

      expect(result.current.currentMatchIndex).toBe(1);
    });

    it('should handle match click to specific index', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('hdx-oss-dev-api');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(7);
      });

      act(() => {
        result.current.handleMatchClick(3);
      });

      expect(result.current.currentMatchIndex).toBe(3);
      expect(result.current.shouldScrollToMatch).toBe(true);
    });

    it('should set shouldScrollToMatch flag when performing search and navigating', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('middleware');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(2);
      });

      // Initial search sets the flag to true
      expect(result.current.shouldScrollToMatch).toBe(true);

      // Navigate to next match - flag should still be true
      act(() => {
        result.current.handleNextMatch();
      });

      expect(result.current.shouldScrollToMatch).toBe(true);
      expect(result.current.currentMatchIndex).toBe(1);
    });
  });

  describe('visibility management', () => {
    it('should toggle search visibility', () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      expect(result.current.isSearchVisible).toBe(false);

      act(() => {
        result.current.setIsSearchVisible(true);
      });

      expect(result.current.isSearchVisible).toBe(true);

      act(() => {
        result.current.setIsSearchVisible(false);
      });

      expect(result.current.isSearchVisible).toBe(false);
    });

    it('should call onVisibilityChange callback when visibility changes', () => {
      const onVisibilityChange = jest.fn();

      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
          onVisibilityChange,
        }),
      );

      act(() => {
        result.current.setIsSearchVisible(true);
      });

      expect(onVisibilityChange).toHaveBeenCalledWith(true);

      act(() => {
        result.current.setIsSearchVisible(false);
      });

      expect(onVisibilityChange).toHaveBeenCalledWith(false);
    });
  });

  describe('resetSearch', () => {
    it('should reset all search state', async () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      // Set up search state
      act(() => {
        result.current.setIsSearchVisible(true);
        result.current.handleSearchChange('mongodb');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      // Reset search
      act(() => {
        result.current.resetSearch();
      });

      expect(result.current.inputValue).toBe('');
      expect(result.current.matchIndices).toEqual([]);
      expect(result.current.currentMatchIndex).toBe(0);
      expect(result.current.shouldScrollToMatch).toBe(false);
      expect(result.current.isSearchVisible).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only search query', () => {
      const { result } = renderHook(() =>
        useTableSearch({
          rows: mockRows,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('   ');
      });

      expect(result.current.matchIndices).toEqual([]);
    });

    it('should handle special characters in search query', async () => {
      const rowsWithSpecialChars = [
        {
          ServiceName: 'test.service',
          SpanName: 'operation/action',
          StatusCode: 'OK',
        },
        {
          ServiceName: 'another-service',
          SpanName: 'route:/api/users',
          StatusCode: 'OK',
        },
      ];

      const { result } = renderHook(() =>
        useTableSearch({
          rows: rowsWithSpecialChars,
          searchableColumns,
          debounceMs: 0,
        }),
      );

      act(() => {
        result.current.handleSearchChange('/api/');
      });

      await waitFor(() => {
        expect(result.current.matchIndices).toHaveLength(1);
      });

      expect(result.current.matchIndices).toEqual([1]);
    });
  });
});
