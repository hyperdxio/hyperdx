import { SourceKind } from '@hyperdx/common-utils/dist/types';
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
    describe('should handle', () => {
      const testCases = [
        {
          sortingKey: undefined,
          expected: 'Timestamp DESC',
        },
        {
          sortingKey: '',
          expected: 'Timestamp DESC',
        },
        {
          sortingKey: 'ServiceName, SpanName, toDateTime(Timestamp)',
          expected: '(toDateTime(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey:
            'toStartOfHour(Timestamp), ServiceName, SpanName, toDateTime(Timestamp)',
          expected:
            '(toStartOfHour(Timestamp), toDateTime(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey:
            'toStartOfHour(Timestamp), ServiceName, SpanName, toDateTime(Timestamp)',
          expected:
            '(toStartOfHour(Timestamp), toDateTime(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toDateTime(Timestamp), ServiceName, SpanName, Timestamp',
          expected: '(toDateTime(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toDateTime(Timestamp), ServiceName, SpanName',
          expected: '(toDateTime(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfHour(Timestamp), other_column, Timestamp',
          expected: '(toStartOfHour(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'Timestamp, other_column',
          expected: 'Timestamp DESC',
        },
        {
          sortingKey: 'user_id, toStartOfHour(Timestamp), status, Timestamp',
          expected: '(toStartOfHour(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey:
            'toStartOfMinute(Timestamp), user_id, status, toUnixTimestamp(Timestamp)',
          expected:
            '(toStartOfMinute(Timestamp), toUnixTimestamp(Timestamp), Timestamp) DESC',
        },
        {
          // test variation of toUnixTimestamp
          sortingKey:
            'toStartOfMinute(Timestamp), user_id, status, toUnixTimestamp64Nano(Timestamp)',
          expected:
            '(toStartOfMinute(Timestamp), toUnixTimestamp64Nano(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey:
            'toUnixTimestamp(toStartOfMinute(Timestamp)), user_id, status, Timestamp',
          expected:
            '(toUnixTimestamp(toStartOfMinute(Timestamp)), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfMinute(Timestamp), user_id, status, Timestamp',
          timestampValueExpression: 'Timestamp, toStartOfMinute(Timestamp)',
          expected: '(toStartOfMinute(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfMinute(Timestamp), user_id, status, Timestamp',
          timestampValueExpression: 'toStartOfMinute(Timestamp), Timestamp',
          expected: '(toStartOfMinute(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfMinute(Timestamp), user_id, status, Timestamp',
          expected: '(toStartOfMinute(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfMinute(Timestamp), user_id, status',
          expected: '(toStartOfMinute(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'toStartOfMinute(Timestamp), user_id, status',
          timestampValueExpression: 'toStartOfMinute(Timestamp), Timestamp',
          expected: '(toStartOfMinute(Timestamp), Timestamp) DESC',
        },
        {
          sortingKey: 'Timestamp',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey: 'Timestamp',
          displayedTimestampValueExpression: 'Timestamp64 ',
          expected: '(Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey: 'Timestamp',
          expected: 'Timestamp DESC',
        },
        {
          sortingKey: 'Timestamp',
          displayedTimestampValueExpression: '',
          expected: 'Timestamp DESC',
        },
        {
          sortingKey: 'Timestamp, ServiceName, Timestamp64',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey:
            'toStartOfMinute(Timestamp), Timestamp, ServiceName, Timestamp64',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(toStartOfMinute(Timestamp), Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey:
            'toStartOfMinute(Timestamp), Timestamp64, ServiceName, Timestamp',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(toStartOfMinute(Timestamp), Timestamp64, Timestamp) DESC',
        },
        {
          sortingKey: 'SomeOtherTimeColumn',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey: '',
          displayedTimestampValueExpression: 'Timestamp64',
          expected: '(Timestamp, Timestamp64) DESC',
        },
        {
          sortingKey: 'ServiceName, TimestampTime, Timestamp',
          timestampValueExpression: 'TimestampTime, Timestamp',
          expected: '(TimestampTime, Timestamp) DESC',
        },
        {
          sortingKey: 'ServiceName, TimestampTime, Timestamp',
          timestampValueExpression: 'Timestamp, TimestampTime',
          expected: '(TimestampTime, Timestamp) DESC',
        },
        {
          sortingKey: 'ServiceName, TimestampTime, Timestamp',
          expected: '(TimestampTime, Timestamp) DESC',
        },
      ];
      for (const testCase of testCases) {
        it(`${testCase.sortingKey}`, () => {
          const mockSource = {
            kind: SourceKind.Log,
            timestampValueExpression:
              testCase.timestampValueExpression || 'Timestamp',
            displayedTimestampValueExpression:
              testCase.displayedTimestampValueExpression,
          };

          const mockTableMetadata = {
            sorting_key: testCase.sortingKey,
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

          expect(result.current).toBe(testCase.expected);
        });
      }
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

      expect(result.current).toBe(undefined);
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

      expect(result.current).toBe(undefined);
    });

    it('should return orderByExpression when set on the source', () => {
      const mockSource = {
        kind: SourceKind.Log,
        timestampValueExpression: 'Timestamp',
        orderByExpression: 'Timestamp ASC',
      };

      const mockTableMetadata = {
        sorting_key: 'toStartOfMinute(Timestamp), Timestamp',
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

      expect(result.current).toBe('Timestamp ASC');
    });

    it('should fall back to optimized order when orderByExpression is empty', () => {
      const mockSource = {
        kind: SourceKind.Log,
        timestampValueExpression: 'Timestamp',
        orderByExpression: '',
      };

      const mockTableMetadata = {
        sorting_key: 'toStartOfHour(Timestamp), Timestamp',
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

    it('should fall back to optimized order when orderByExpression is undefined', () => {
      const mockSource = {
        kind: SourceKind.Log,
        timestampValueExpression: 'Timestamp',
      };

      const mockTableMetadata = {
        sorting_key: 'toStartOfHour(Timestamp), Timestamp',
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

    it('should handle complex Timestamp expressions', () => {
      const mockSource = {
        kind: SourceKind.Log,
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
