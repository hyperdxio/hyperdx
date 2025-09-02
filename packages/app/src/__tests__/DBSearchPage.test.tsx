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
      const mockSource = {
        timestampValueExpression: 'Timestamp',
      };

      const testCases = [
        {
          input: undefined,
          expected: 'Timestamp DESC',
        },
        {
          input: '',
          expected: 'Timestamp DESC',
        },
        {
          // Traces Table
          input: 'ServiceName, SpanName, toDateTime(Timestamp)',
          expected: 'Timestamp DESC',
        },
        {
          // Optimized Traces Table
          input:
            'toStartOfHour(Timestamp), ServiceName, SpanName, toDateTime(Timestamp)',
          expected: '(toStartOfHour(Timestamp), toDateTime(Timestamp)) DESC',
        },
        {
          // Unsupported for now as it's not a great sort key, want to just
          // use default behavior for this
          input: 'toDateTime(Timestamp), ServiceName, SpanName, Timestamp',
          expected: 'Timestamp DESC',
        },
        {
          // Unsupported prefix sort key
          input: 'toDateTime(Timestamp), ServiceName, SpanName',
          expected: 'Timestamp DESC',
        },
        {
          // Inverted sort key order, we should not try to optimize this
          input:
            'ServiceName, toDateTime(Timestamp), SeverityText, toStartOfHour(Timestamp)',
          expected: 'Timestamp DESC',
        },
        {
          input: 'toStartOfHour(Timestamp), other_column, Timestamp',
          expected: '(toStartOfHour(Timestamp), Timestamp) DESC',
        },
        {
          input: 'Timestamp, other_column',
          expected: 'Timestamp DESC',
        },
        {
          input: 'user_id, toStartOfHour(Timestamp), status, Timestamp',
          expected: '(toStartOfHour(Timestamp), Timestamp) DESC',
        },
        {
          input:
            'toStartOfMinute(Timestamp), user_id, status, toUnixTimestamp(Timestamp)',
          expected:
            '(toStartOfMinute(Timestamp), toUnixTimestamp(Timestamp)) DESC',
        },
        {
          // test variation of toUnixTimestamp
          input:
            'toStartOfMinute(Timestamp), user_id, status, toUnixTimestamp64Nano(Timestamp)',
          expected:
            '(toStartOfMinute(Timestamp), toUnixTimestamp64Nano(Timestamp)) DESC',
        },
        {
          input:
            'toUnixTimestamp(toStartOfMinute(Timestamp)), user_id, status, Timestamp',
          expected:
            '(toUnixTimestamp(toStartOfMinute(Timestamp)), Timestamp) DESC',
        },
      ];
      for (const testCase of testCases) {
        it(`${testCase.input}`, () => {
          const mockTableMetadata = { sorting_key: testCase.input };

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
