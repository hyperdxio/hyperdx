/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { enableMapSet } from 'immer';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import api from '@/api';
import * as useMetadataModule from '@/hooks/useMetadata';
import * as searchFiltersModule from '@/searchFilters';
import * as sourceModule from '@/source';

import { useFetchFacets } from './hooks';

enableMapSet();

/**
 * These tests focus on the two code paths inside `useFetchFacets`:
 *
 *  1. Raw-tables pipeline (`useFacetsFromRawTables`): triggered when the
 *     source has no metadata materialized views, OR when `mode === 'exact'`.
 *  2. Materialized-view pipeline (`useAllFacetsFromMVs`): triggered only when
 *     the source has metadata materialized views AND `mode === 'all'`.
 *
 * Plus the shared state layer that merges "load more" results into whichever
 * pipeline is active (union — primary values are preserved and never
 * overridden by extras) and resets that state whenever the query scope that
 * produced the extras changes (source, date range, mode, filter state, or
 * the where clause).
 */

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: jest.fn(),
}));

jest.mock('@/searchFilters', () => ({
  __esModule: true,
  usePinnedFilters: jest.fn(),
  escapeFilterStateKeys: jest.fn((state: unknown) => state),
}));

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useMetadataWithSettings: jest.fn(),
  useColumns: jest.fn(),
  useDateTimeColumns: jest.fn(),
  useJsonColumns: jest.fn(),
  useMapColumns: jest.fn(),
  useAllFields: jest.fn(),
  useGetKeyValues: jest.fn(),
}));

const useMe = jest.mocked(api.useMe);
const useSource = jest.mocked(sourceModule.useSource);
const usePinnedFilters = jest.mocked(searchFiltersModule.usePinnedFilters);
const useMetadataWithSettings = jest.mocked(
  useMetadataModule.useMetadataWithSettings,
);
const useColumns = jest.mocked(useMetadataModule.useColumns);
const useDateTimeColumns = jest.mocked(useMetadataModule.useDateTimeColumns);
const useJsonColumns = jest.mocked(useMetadataModule.useJsonColumns);
const useMapColumns = jest.mocked(useMetadataModule.useMapColumns);
const useAllFields = jest.mocked(useMetadataModule.useAllFields);
const useGetKeyValues = jest.mocked(useMetadataModule.useGetKeyValues);

const CHART_CONFIG: BuilderChartConfigWithDateRange = {
  connection: 'conn1',
  from: { databaseName: 'db', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  select: '',
  where: '',
  whereLanguage: 'sql',
  dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
};

const DATE_RANGE: [Date, Date] = [
  new Date('2024-01-01'),
  new Date('2024-01-02'),
];

const makeLogSource = (opts: { withMVs: boolean }) => ({
  id: 'source1',
  kind: 'log',
  name: 'logs',
  connection: 'conn1',
  from: { databaseName: 'db', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '*',
  ...(opts.withMVs
    ? {
        metadataMaterializedViews: {
          granularity: 'PT1H',
          keysAndValues: {
            databaseName: 'db',
            tableName: 'logs_mv',
          },
        },
      }
    : {}),
});

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

function setupDefaultMocks({ withMVs }: { withMVs: boolean }) {
  useMe.mockReturnValue({
    data: { team: { filterKeysFetchLimit: 100 } },
    isFetched: true,
  } as any);

  useSource.mockReturnValue({
    data: makeLogSource({ withMVs }),
    isLoading: false,
  } as any);

  useColumns.mockReturnValue({
    data: [
      { name: 'Timestamp', type: 'DateTime' },
      { name: 'ServiceName', type: 'String' },
    ],
    isLoading: false,
  } as any);

  useDateTimeColumns.mockReturnValue([
    { name: 'Timestamp', type: 'DateTime' },
  ] as any);
  useJsonColumns.mockReturnValue({ data: [] } as any);
  useMapColumns.mockReturnValue({ data: [] } as any);

  useAllFields.mockReturnValue({
    data: [
      {
        path: ['ServiceName'],
        type: 'LowCardinality(String)',
        jsType: 'string',
      },
    ],
  } as any);

  usePinnedFilters.mockReturnValue({
    isFieldPinned: jest.fn().mockReturnValue(false),
    isSharedFieldPinned: jest.fn().mockReturnValue(false),
  } as any);

  useMetadataWithSettings.mockReturnValue({
    getKeyValuesWithMVs: jest.fn(),
    getAllKeyValues: jest.fn(),
  } as any);

  useGetKeyValues.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  } as any);
}

describe('useFetchFacets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('pipeline selection', () => {
    it('uses the raw-tables pipeline when the source has no metadata materialized views', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      const rawCall = useGetKeyValues.mock.calls.at(-1);
      expect(rawCall?.[1]?.enabled).toBe(true);
    });

    it('uses the raw-tables pipeline when mode is exact, even if MVs are available', () => {
      setupDefaultMocks({ withMVs: true });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      const rawCall = useGetKeyValues.mock.calls.at(-1);
      expect(rawCall?.[1]?.enabled).toBe(true);
    });

    it('uses the MV pipeline when mode is all and MVs are available', () => {
      setupDefaultMocks({ withMVs: true });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      const rawCall = useGetKeyValues.mock.calls.at(-1);
      expect(rawCall?.[1]?.enabled).toBe(false);
    });
  });

  describe('data selection', () => {
    it('returns data from the raw-tables pipeline when that pipeline is active', () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api', 'web'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);

      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api', 'web'] },
      ]);
    });

    it('returns data from the MV pipeline when that pipeline is active', () => {
      setupDefaultMocks({ withMVs: true });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ShouldNotBeUsed', value: ['x'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);

      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api', 'web'] },
      ]);
    });

    it('returns undefined when the active pipeline has no data yet', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      expect(result.current.data).toBeUndefined();
    });
  });

  describe('loadMoreFacetsForKey (raw-tables pipeline)', () => {
    it('reports the key as loading while the fetch is in flight, then clears it', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);

      let resolveLoadMore: (val: unknown) => void = () => undefined;
      const loadMorePromise = new Promise(resolve => {
        resolveLoadMore = resolve;
      });
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest.fn().mockReturnValue(loadMorePromise),
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      let pending: Promise<unknown>;
      act(() => {
        pending = result.current.loadMoreFacetsForKey('ServiceName');
      });

      await waitFor(() => {
        expect(result.current.loadMoreLoadingKeys.has('ServiceName')).toBe(
          true,
        );
      });
      expect(result.current.areExtraFacetsLoading).toBe(true);

      await act(async () => {
        resolveLoadMore([{ key: 'ServiceName', value: ['api', 'web', 'db'] }]);
        await pending;
      });

      expect(result.current.loadMoreLoadingKeys.has('ServiceName')).toBe(false);
      expect(result.current.areExtraFacetsLoading).toBe(false);
    });

    it('adds the fetched key to extraFacetKeys after a successful load-more', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([
            { key: 'ServiceName', value: ['api', 'web', 'db'] },
          ]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('ServiceName');
      });

      expect(result.current.extraFacetKeys.has('ServiceName')).toBe(true);
    });

    it('unions extra facet values with primary values when keys match, preserving primary values and primary order', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [
          { key: 'ServiceName', value: ['api', 'primary-only'] },
          { key: 'HostName', value: ['h1'] },
        ],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest.fn().mockResolvedValue([
          {
            key: 'ServiceName',
            value: ['api', 'web', 'db'],
          },
        ]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('ServiceName');
      });

      expect(result.current.data).toEqual([
        {
          key: 'ServiceName',
          value: ['api', 'primary-only', 'web', 'db'],
        },
        { key: 'HostName', value: ['h1'] },
      ]);
    });

    it('appends extra facets that were not in the primary list', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1', 'n2'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1', 'n2'] },
      ]);
    });

    it('does not mutate state when the load-more strategy returns undefined (e.g. on error)', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      // Simulate the raw-tables path swallowing the error and returning undefined.
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest.fn().mockRejectedValue(new Error('boom')),
      } as any);
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('ServiceName');
      });

      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
      expect(result.current.loadMoreLoadingKeys.has('ServiceName')).toBe(false);
      expect(result.current.extraFacetKeys.has('ServiceName')).toBe(false);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('loadMoreFacetsForKey (MV pipeline)', () => {
    it('delegates to getAllKeyValues and merges the result', async () => {
      setupDefaultMocks({ withMVs: true });
      const getAllKeyValues = jest
        .fn()
        .mockResolvedValue([{ key: 'ServiceName', value: ['api', 'web'] }]);
      const getKeyValuesWithMVs = jest.fn();
      useMetadataWithSettings.mockReturnValue({
        getAllKeyValues,
        getKeyValuesWithMVs,
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('ServiceName');
      });

      expect(getAllKeyValues).toHaveBeenCalledTimes(1);
      expect(getKeyValuesWithMVs).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api', 'web'] },
      ]);
    });
  });

  describe('extraFacets reset on prop change', () => {
    it('clears extraFacets and extraFacetKeys when sourceId changes', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { sourceId: string }) =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: props.sourceId,
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper, initialProps: { sourceId: 'source1' } },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.extraFacetKeys.has('NewKey')).toBe(true);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({ sourceId: 'source2' });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
    });

    it('clears extraFacets when dateRange changes', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { dateRange: [Date, Date] }) =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: props.dateRange,
            mode: 'exact',
          }),
        { wrapper, initialProps: { dateRange: DATE_RANGE } },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({
        dateRange: [new Date('2024-02-01'), new Date('2024-02-02')],
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
    });

    it('clears extraFacets when filterState changes', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { filterState: FilterState }) =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
            filterState: props.filterState,
          }),
        {
          wrapper,
          initialProps: { filterState: {} as FilterState },
        },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.extraFacetKeys.has('NewKey')).toBe(true);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({
        filterState: {
          level: {
            included: new Set<string | boolean>(['error']),
            excluded: new Set<string | boolean>(),
          },
        },
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
    });

    it('clears extraFacets when chartConfig.where changes', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { chartConfig: BuilderChartConfigWithDateRange }) =>
          useFetchFacets({
            chartConfig: props.chartConfig,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
          }),
        { wrapper, initialProps: { chartConfig: CHART_CONFIG } },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.extraFacetKeys.has('NewKey')).toBe(true);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({
        chartConfig: { ...CHART_CONFIG, where: 'level = "error"' },
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
    });

    it('clears extraFacets when mode changes', async () => {
      setupDefaultMocks({ withMVs: false });
      useGetKeyValues.mockReturnValue({
        data: [{ key: 'ServiceName', value: ['api'] }],
        isLoading: false,
        isFetching: false,
        error: null,
      } as any);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      } as any);

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { mode: 'all' | 'exact' }) =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: props.mode,
          }),
        {
          wrapper,
          initialProps: { mode: 'exact' } as { mode: 'all' | 'exact' },
        },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.extraFacetKeys.has('NewKey')).toBe(true);

      rerender({ mode: 'all' });

      expect(result.current.extraFacetKeys.size).toBe(0);
    });
  });
});
