import { renderHook } from '@testing-library/react';

import * as sourceModule from '@/source';

import { useDefaultOrderBy } from '../DBSearchPage';
import * as metadataModule from '../hooks/useMetadata';

// Mock the dependencies
jest.mock('@/layout', () => ({
  withAppNav: (component: any) => component,
}));

describe('useDefaultOrderBy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('optimizeOrderBy function', () => {
    it('should return fallback order by when tableMetadata is not available', () => {
      const mockSource = {
        timestampValueExpression: 'Timestamp',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe('Timestamp DESC');
    });

    it('should handle empty Timestamp expression ungracefully', () => {
      const mockSource = {
        timestampValueExpression: '',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe(' DESC');
    });

    it('should return optimized order by when Timestamp is not first in sorting key', () => {
      const mockSource = {
        timestampValueExpression: 'Timestamp',
      };

      const mockTableMetadata = {
        sorting_key: 'toStartOfHour(Timestamp), other_column, Timestamp',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: mockTableMetadata,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe('(toStartOfHour(Timestamp), Timestamp) DESC');
    });

    it('should return fallback when Timestamp is first in sorting key', () => {
      const mockSource = {
        timestampValueExpression: 'Timestamp',
      };

      const mockTableMetadata = {
        sorting_key: 'Timestamp, other_column',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: mockTableMetadata,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe('Timestamp DESC');
    });

    it('should ignore non-toStartOf columns before Timestamp', () => {
      const mockSource = {
        timestampValueExpression: 'Timestamp',
      };

      const mockTableMetadata = {
        sorting_key: 'user_id, toStartOfHour(Timestamp), status, Timestamp',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: mockTableMetadata,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe('(toStartOfHour(Timestamp), Timestamp) DESC');
    });

    it('should handle null source ungracefully', () => {
      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy(null));

      expect(result.current).toBe(' DESC');
    });

    it('should handle undefined sourceID ungracefully', () => {
      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy(undefined));

      expect(result.current).toBe(' DESC');
    });

    it('should handle complex Timestamp expressions', () => {
      const mockSource = {
        timestampValueExpression: 'toDateTime(timestamp_ms / 1000)',
      };

      const mockTableMetadata = {
        sorting_key:
          'toStartOfHour(toDateTime(timestamp_ms / 1000)), toDateTime(timestamp_ms / 1000)',
      };

      jest.spyOn(sourceModule, 'useSource').mockReturnValue({
        data: mockSource,
        isLoading: false,
        error: null,
      } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: mockTableMetadata,
        isLoading: false,
        error: null,
      } as any);

      const { result } = renderHook(() => useDefaultOrderBy('source-id'));

      expect(result.current).toBe(
        '(toStartOfHour(toDateTime(timestamp_ms / 1000)), toDateTime(timestamp_ms / 1000)) DESC',
      );
    });

    it('should memoize result correctly when dependencies change', () => {
      const mockSource1 = {
        timestampValueExpression: 'timestamp1',
      };

      const mockSource2 = {
        timestampValueExpression: 'timestamp2',
      };

      const useSourceSpy = jest
        .spyOn(sourceModule, 'useSource')
        .mockReturnValue({
          data: mockSource1,
          isLoading: false,
          error: null,
        } as any);

      jest.spyOn(metadataModule, 'useTableMetadata').mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      } as any);

      const { result, rerender } = renderHook(() =>
        useDefaultOrderBy('source-id'),
      );

      expect(result.current).toBe('timestamp1 DESC');

      // Update the mock to return different data
      useSourceSpy.mockReturnValue({
        data: mockSource2,
        isLoading: false,
        error: null,
      } as any);

      rerender();

      expect(result.current).toBe('timestamp2 DESC');
    });
  });
});
