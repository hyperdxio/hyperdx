import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  getJSONColumnNames,
  getMapColumnNames,
  useRowData,
} from '@/components/DBRowDataPanel';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;

describe('DBRowDataPanel', () => {
  const source: TLogSource = {
    id: 'source-id',
    kind: SourceKind.Log,
    name: 'logs',
    connection: 'conn-id',
    from: { databaseName: 'default', tableName: 'logs' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
    bodyExpression: 'Body',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [],
        meta: [],
        rows: 0,
        isComplete: true,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
    });
  });

  describe('getJSONColumnNames', () => {
    it('should return JSON column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'col2', type: 'JSON' },
        { name: 'col3', type: 'JSON(1)' },
      ];
      const result = getJSONColumnNames(meta);
      expect(result).toEqual(['col2', 'col3']);
    });
  });

  it('selects `*` when the source has no Known Columns List', () => {
    renderHook(() => useRowData({ source, rowId: "id='abc123'" }));

    const [config] = mockUseQueriedChartConfig.mock.calls[0];
    expect(config.select[0]).toEqual({ valueExpression: '*' });
  });

  it('selects the Known Columns List instead of `*` when set', () => {
    const sourceWithKnownColumns: TLogSource = {
      ...source,
      knownColumnsListExpression: 'Timestamp, Body, ServiceName',
    };

    renderHook(() =>
      useRowData({ source: sourceWithKnownColumns, rowId: "id='abc123'" }),
    );

    const [config] = mockUseQueriedChartConfig.mock.calls[0];
    expect(config.select[0]).toEqual({
      valueExpression: 'Timestamp, Body, ServiceName',
    });
    expect(config.select).not.toContainEqual({ valueExpression: '*' });
  });

  describe('time filtering', () => {
    // A row id synthesized from ids alone (e.g. "View Trace" builds
    // TraceId + SpanId) has no timestamp of its own, so without a dateRange the
    // lookup scans every part.
    it('omits the time filter when no dateRange is given', () => {
      renderHook(() => useRowData({ source, rowId: "id='abc123'" }));

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(config.dateRange).toBeUndefined();
      expect(config.timestampValueExpression).toBeUndefined();
    });

    it('filters on timestampValueExpression when a dateRange is given', () => {
      const dateRange: [Date, Date] = [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T02:00:00Z'),
      ];

      renderHook(() => useRowData({ source, rowId: "id='abc123'", dateRange }));

      const [config, options] = mockUseQueriedChartConfig.mock.calls[0];
      expect(config.dateRange).toBe(dateRange);
      expect(config.timestampValueExpression).toBe('Timestamp');
      // Filtered and unfiltered lookups for the same row must not share a
      // cache entry.
      expect(options.queryKey).toContain(dateRange);
    });

    // The filter has to cover every timestamp column in the sort key, so the
    // multi-column expression is passed through whole rather than truncated to
    // its first token.
    it('passes a multi-column timestampValueExpression through to the filter', () => {
      const multiColumnSource: TLogSource = {
        ...source,
        timestampValueExpression: 'EventDate, EventTime',
      };

      renderHook(() =>
        useRowData({
          source: multiColumnSource,
          rowId: "id='abc123'",
          dateRange: [
            new Date('2024-01-01T00:00:00Z'),
            new Date('2024-01-01T02:00:00Z'),
          ],
        }),
      );

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(config.timestampValueExpression).toBe('EventDate, EventTime');
    });

    // renderChartConfig needs both halves to emit a filter, so a source with no
    // usable timestamp expression must not contribute a lone dateRange.
    it('omits the filter when the source has no timestamp expression', () => {
      const sourceWithoutTimestamp: TLogSource = {
        ...source,
        timestampValueExpression: '   ',
      };

      renderHook(() =>
        useRowData({
          source: sourceWithoutTimestamp,
          rowId: "id='abc123'",
          dateRange: [
            new Date('2024-01-01T00:00:00Z'),
            new Date('2024-01-01T02:00:00Z'),
          ],
        }),
      );

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(config.dateRange).toBeUndefined();
      expect(config.timestampValueExpression).toBeUndefined();
    });

    it('gives bounded and unbounded lookups of the same row different query keys', () => {
      renderHook(() =>
        useRowData({
          source,
          rowId: "id='abc123'",
          dateRange: [
            new Date('2024-01-01T00:00:00Z'),
            new Date('2024-01-01T02:00:00Z'),
          ],
        }),
      );

      const [, boundedOptions] = mockUseQueriedChartConfig.mock.calls[0];
      const [, fallbackOptions] = mockUseQueriedChartConfig.mock.calls[1];
      expect(boundedOptions.queryKey).not.toEqual(fallbackOptions.queryKey);
    });
  });

  // A window derived from the origin row's instant but filtered against the
  // destination's timestamp can exclude the row being looked up — a long span
  // starts before a window centered on a log it emitted late in its life. Zero
  // rows is a query success, so the lookup has to retry unbounded rather than
  // report the row as missing.
  describe('unbounded fallback', () => {
    const DATE_RANGE: [Date, Date] = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T02:00:00Z'),
    ];
    const ROW = { __hdx_timestamp: '2024-01-01T01:00:00Z' };

    function lookupResult(overrides: Record<string, unknown> = {}) {
      return {
        data: { data: [], meta: [], rows: 0, isComplete: true },
        isLoading: false,
        isPending: false,
        isError: false,
        isSuccess: true,
        ...overrides,
      };
    }

    // Dispatch on the query key rather than a call counter, so the mock is
    // indifferent to how many times the hook renders. The unbounded lookup is
    // the one whose key ends in `undefined` instead of the window.
    function mockLookups({
      bounded,
      fallback,
    }: {
      bounded: ReturnType<typeof lookupResult>;
      fallback: ReturnType<typeof lookupResult>;
    }) {
      mockUseQueriedChartConfig.mockImplementation((_config, options) =>
        options.queryKey[options.queryKey.length - 1] === undefined
          ? fallback
          : bounded,
      );
    }

    function renderLookup(dateRange?: [Date, Date]) {
      return renderHook(() =>
        useRowData({ source, rowId: "id='abc123'", dateRange }),
      );
    }

    function enabledFlags() {
      const [, boundedOptions] = mockUseQueriedChartConfig.mock.calls[0];
      const [, fallbackOptions] = mockUseQueriedChartConfig.mock.calls[1];
      return {
        bounded: boundedOptions.enabled,
        fallback: fallbackOptions.enabled,
      };
    }

    it('does not run when the bounded lookup finds the row', () => {
      mockLookups({
        bounded: lookupResult({
          data: { data: [ROW], meta: [], rows: 1, isComplete: true },
        }),
        fallback: lookupResult(),
      });

      const { result } = renderLookup(DATE_RANGE);

      expect(enabledFlags()).toEqual({ bounded: true, fallback: false });
      expect(result.current.data?.data).toEqual([ROW]);
    });

    it('runs when the bounded lookup comes back empty', () => {
      mockLookups({ bounded: lookupResult(), fallback: lookupResult() });

      renderLookup(DATE_RANGE);

      expect(enabledFlags()).toEqual({ bounded: true, fallback: true });
    });

    it('serves the row the bounded lookup missed', () => {
      mockLookups({
        bounded: lookupResult(),
        fallback: lookupResult({
          data: { data: [ROW], meta: [], rows: 1, isComplete: true },
        }),
      });

      const { result } = renderLookup(DATE_RANGE);

      expect(result.current.data?.data).toEqual([ROW]);
    });

    // An error isn't evidence the row is outside the window, and retrying
    // unbounded would hide it from `DBRowSidePanelErrorState`.
    it('does not run when the bounded lookup errors', () => {
      const error = new Error('boom');
      mockLookups({
        bounded: lookupResult({
          data: undefined,
          isSuccess: false,
          isError: true,
          error,
        }),
        fallback: lookupResult(),
      });

      const { result } = renderLookup(DATE_RANGE);

      expect(enabledFlags()).toEqual({ bounded: true, fallback: false });
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBe(error);
    });

    it('is the only lookup that runs when there is no window', () => {
      mockLookups({ bounded: lookupResult(), fallback: lookupResult() });

      renderLookup();

      expect(enabledFlags()).toEqual({ bounded: false, fallback: true });
    });

    // Otherwise the panel would flash an absent row between the bounded lookup
    // settling empty and the retry resolving.
    it('reports loading while in flight', () => {
      mockLookups({
        bounded: lookupResult(),
        fallback: lookupResult({
          data: undefined,
          isSuccess: false,
          isLoading: false,
          isPending: true,
        }),
      });

      const { result } = renderLookup(DATE_RANGE);

      expect(result.current.isLoading).toBe(true);
    });

    // A chunked query publishes partial results as successes, so an empty
    // first chunk must not read as "no such row".
    it('does not run on an incomplete bounded result', () => {
      mockLookups({
        bounded: lookupResult({
          data: { data: [], meta: [], rows: 0, isComplete: false },
        }),
        fallback: lookupResult(),
      });

      renderLookup(DATE_RANGE);

      expect(enabledFlags()).toEqual({ bounded: true, fallback: false });
    });
  });

  describe('__hdx_timestamp_value_<i>', () => {
    function timestampValueSelects(config: {
      select: { alias?: string }[];
    }): { alias?: string }[] {
      return config.select.filter(s =>
        s.alias?.startsWith('__hdx_timestamp_value_'),
      );
    }

    it("selects the source's timestampValueExpression, not the displayed one", () => {
      const sourceWithDisplayedTimestamp: TLogSource = {
        ...source,
        displayedTimestampValueExpression: 'ObservedTimestamp',
      };

      renderHook(() =>
        useRowData({
          source: sourceWithDisplayedTimestamp,
          rowId: "id='abc123'",
        }),
      );

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(config.select).toContainEqual({
        valueExpression: 'ObservedTimestamp',
        alias: '__hdx_timestamp',
      });
      expect(timestampValueSelects(config)).toEqual([
        { valueExpression: 'Timestamp', alias: '__hdx_timestamp_value_0' },
      ]);
    });

    // Every column is projected so the anchor can be resolved from the
    // highest-precision one at read time; picking the first token here would
    // pin the anchor to `EventDate`'s midnight.
    it('selects every column of a multi-column timestamp expression', () => {
      const multiColumnSource: TLogSource = {
        ...source,
        timestampValueExpression: 'EventDate, EventTime',
      };

      renderHook(() =>
        useRowData({ source: multiColumnSource, rowId: "id='abc123'" }),
      );

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(timestampValueSelects(config)).toEqual([
        { valueExpression: 'EventDate', alias: '__hdx_timestamp_value_0' },
        { valueExpression: 'EventTime', alias: '__hdx_timestamp_value_1' },
      ]);
    });

    it('is not selected when the source has no timestamp expression', () => {
      const sourceWithoutTimestamp: TLogSource = {
        ...source,
        timestampValueExpression: '   ',
      };

      renderHook(() =>
        useRowData({ source: sourceWithoutTimestamp, rowId: "id='abc123'" }),
      );

      const [config] = mockUseQueriedChartConfig.mock.calls[0];
      expect(timestampValueSelects(config)).toEqual([]);
    });
  });

  // Regression test for the OSS #2357 conflict-resolution merge. The
  // composed result wraps `Event Attributes` in a length check from
  // origin/main AND passes `mapColumns={mapColumns}` through to the
  // DBRowJsonViewer from HEAD. Both branches are wired through
  // `getMapColumnNames`, which is the symbol the resolution
  // introduces from HEAD and that origin/main otherwise lacks. A
  // regression in either compose direction would either drop the
  // helper or change its semantics; this test pins both.
  describe('getMapColumnNames', () => {
    it('returns Map column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'LogAttributes', type: 'Map(String, String)' },
        { name: 'ResourceAttributes', type: 'Map(String, String)' },
        { name: 'col4', type: 'JSON' },
      ];
      expect(getMapColumnNames(meta)).toEqual([
        'LogAttributes',
        'ResourceAttributes',
      ]);
    });

    it('matches the bare Map type as well as Map(K, V)', () => {
      const meta = [
        { name: 'bareMap', type: 'Map' },
        { name: 'typedMap', type: 'Map(String, UInt8)' },
        { name: 'notMap', type: 'String' },
      ];
      expect(getMapColumnNames(meta)).toEqual(['bareMap', 'typedMap']);
    });

    it('returns an empty array when meta is undefined', () => {
      expect(getMapColumnNames(undefined)).toEqual([]);
    });

    it('does not classify JSON columns as Map columns', () => {
      const meta = [{ name: 'BodyJson', type: 'JSON' }];
      expect(getMapColumnNames(meta)).toEqual([]);
    });
  });
});
