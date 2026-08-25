/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { enableMapSet } from 'immer';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import api from '@/api';
import * as useMetadataModule from '@/hooks/useMetadata';
import * as searchFiltersModule from '@/searchFilters';
import * as sourceModule from '@/source';

import { useFetchFacets } from './hooks';

enableMapSet();

/**
 * These tests focus on the two code paths inside `useFacets`:
 *
 *  1. Raw-tables pipeline: active when `mode === 'exact'`. Calls
 *     `useGetKeyValues({ mode: 'exact' })` and scopes "Load more" through
 *     `metadata.getKeyValuesWithMVs`.
 *  2. "All" pipeline: active when `mode === 'all'`. Calls
 *     `useGetKeyValues({ mode: 'all' })` — whose intelligent router picks
 *     MV/text-index/raw internally — and delegates "Load more" to
 *     `metadata.getAllKeyValues`.
 *
 * Both paths share a single `useGetKeyValues` call whose behavior is driven
 * entirely by the `mode` argument. Selection is mode-only; the presence or
 * absence of metadata materialized views on the source does not affect which
 * path runs.
 *
 * Plus the shared state layer that merges "load more" results into the
 * active path (union — primary values are preserved and never overridden by
 * extras) and resets that state whenever the query scope that produced the
 * extras changes (source, date range, mode, filter state, or the where
 * clause).
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

jest.mock('@/searchFilters', () => {
  const actual =
    jest.requireActual<typeof import('@/searchFilters')>('@/searchFilters');
  return {
    __esModule: true,
    ...actual,
    usePinnedFilters: jest.fn(),
    escapeFilterStateKeys: jest.fn(actual.escapeFilterStateKeys),
  };
});

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useMetadataWithSettings: jest.fn(),
  useColumns: jest.fn(),
  useDateTimeColumns: jest.fn(),
  useJsonColumnNames: jest.fn(),
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
const useJsonColumnNames = jest.mocked(useMetadataModule.useJsonColumnNames);
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

type SourceQueryResult = ReturnType<typeof sourceModule.useSource>;
type MetadataWithSettings = ReturnType<
  typeof useMetadataModule.useMetadataWithSettings
>;

const mockSourceQuery = (data: SourceQueryResult['data']) =>
  useSource.mockReturnValue({ data, isLoading: false } as SourceQueryResult);

const mockMetadata = (metadata: Partial<MetadataWithSettings>) =>
  useMetadataWithSettings.mockReturnValue(metadata as MetadataWithSettings);

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

  useDateTimeColumns.mockReturnValue(new Map([['Timestamp', 'DateTime']]));
  useJsonColumnNames.mockReturnValue([]);
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
    it('routes useGetKeyValues with mode="exact" when mode is exact', () => {
      setupDefaultMocks({ withMVs: false });
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

      const call = useGetKeyValues.mock.calls.at(-1);
      expect(call?.[0]?.mode).toBe('exact');
      expect(call?.[1]?.enabled).toBe(true);
    });

    it('routes useGetKeyValues with mode="all" when mode is all', () => {
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

      const call = useGetKeyValues.mock.calls.at(-1);
      expect(call?.[0]?.mode).toBe('all');
      expect(call?.[1]?.enabled).toBe(true);
    });

    it('passes JSON facets to metadata as raw keys', () => {
      setupDefaultMocks({ withMVs: false });
      useJsonColumnNames.mockReturnValue(['ResourceAttributes']);
      useColumns.mockReturnValue({
        data: [
          { name: 'Timestamp', type: 'DateTime' },
          {
            name: 'ResourceAttributes',
            type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
          },
        ],
        isLoading: false,
      } as ReturnType<typeof useMetadataModule.useColumns>);
      useAllFields.mockReturnValue({
        data: [
          {
            path: ['ResourceAttributes', 'k8s.namespace.name'],
            type: 'String',
            jsType: 'string',
          },
        ],
      } as ReturnType<typeof useMetadataModule.useAllFields>);
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

      expect(useGetKeyValues.mock.calls.at(-1)?.[0]?.keys).toEqual([
        "ResourceAttributes['k8s.namespace.name']",
      ]);
    });

    it('selection is mode-only: MV presence does not change which mode is passed', () => {
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

      const call = useGetKeyValues.mock.calls.at(-1);
      expect(call?.[0]?.mode).toBe('exact');
    });
  });

  // Autocomplete opts into `disableValues: true` so it can render
  // field-name suggestions from `data.keys` without triggering the values
  // query — only firing that query once the user is actively searching on
  // a fully-formed key. Guard against a regression that couples the two.
  describe('disableValues', () => {
    it('disables the useGetKeyValues query when disableValues is true', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper },
      );

      const call = useGetKeyValues.mock.calls.at(-1);
      expect(call?.[1]?.enabled).toBe(false);
    });

    it('enables the useGetKeyValues query when disableValues is false or omitted', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: false,
          }),
        { wrapper },
      );

      const call = useGetKeyValues.mock.calls.at(-1);
      expect(call?.[1]?.enabled).toBe(true);
    });

    it('does not defer the field metadata query — useAllFields stays enabled', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper },
      );

      const call = useAllFields.mock.calls.at(-1);
      expect(call?.[1]?.enabled).toBe(true);
    });

    it('still surfaces field metadata via data.keys even while deferring values', () => {
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper },
      );

      expect(result.current.data.keys).toEqual([
        {
          path: ['ServiceName'],
          type: 'LowCardinality(String)',
          jsType: 'string',
        },
      ]);
      expect(result.current.data.keyValues).toBeUndefined();
    });
  });

  describe('data selection', () => {
    // Route mock responses by the `mode` arg so each pipeline sees a
    // distinct fixture — that way an assertion against `data.keyValues`
    // actually proves the active pipeline's response is returned.
    function mockGetKeyValuesByMode(byMode: { exact: unknown; all: unknown }) {
      useGetKeyValues.mockImplementation(((args: { mode?: 'all' | 'exact' }) =>
        args?.mode === 'all' ? byMode.all : byMode.exact) as any);
    }

    it('returns data from the raw-tables pipeline when mode is exact', () => {
      setupDefaultMocks({ withMVs: false });
      mockGetKeyValuesByMode({
        exact: {
          data: [{ key: 'ServiceName', value: ['api', 'web'] }],
          isLoading: false,
          isFetching: false,
          error: null,
        },
        all: {
          data: [{ key: 'ShouldNotBeUsed', value: ['x'] }],
          isLoading: false,
          isFetching: false,
          error: null,
        },
      });

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

      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api', 'web'] },
      ]);
    });

    it('returns data from the "all" pipeline when mode is all', () => {
      setupDefaultMocks({ withMVs: true });
      mockGetKeyValuesByMode({
        exact: {
          data: [{ key: 'ShouldNotBeUsed', value: ['x'] }],
          isLoading: false,
          isFetching: false,
          error: null,
        },
        all: {
          data: [{ key: 'ServiceName', value: ['api', 'web'] }],
          isLoading: false,
          isFetching: false,
          error: null,
        },
      });

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

      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api', 'web'] },
      ]);
    });

    it('returns undefined keyValues when the active pipeline has no data yet', () => {
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

      // `data.keys` is field metadata (from `useAllFields`) and is
      // independent of the values query; it stays defined once metadata
      // loads. Only `keyValues` is gated on the active pipeline query.
      expect(result.current.data.keyValues).toBeUndefined();
    });
  });

  describe('loadMoreFacetsForKey (raw-tables pipeline)', () => {
    it("strips a JSON facet's own selection before escaping load-more filters", async () => {
      setupDefaultMocks({ withMVs: false });
      useJsonColumnNames.mockReturnValue(['ResourceAttributes']);
      useColumns.mockReturnValue({
        data: [
          { name: 'Timestamp', type: 'DateTime' },
          {
            name: 'ResourceAttributes',
            type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
          },
        ],
        isLoading: false,
      } as ReturnType<typeof useMetadataModule.useColumns>);
      useMetadataWithSettings.mockReturnValue({
        getKeyValuesWithMVs: jest.fn().mockResolvedValue([
          {
            key: "ResourceAttributes['k8s.namespace.name']",
            value: ['production'],
          },
        ]),
      } as any);
      const filterState: FilterState = {
        'ResourceAttributes.k8s.namespace.name': {
          included: new Set<string | boolean>(['production']),
          excluded: new Set<string | boolean>(),
        },
        'ResourceAttributes.service.name': {
          included: new Set<string | boolean>(['api']),
          excluded: new Set<string | boolean>(),
        },
      };

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            dateRange: DATE_RANGE,
            mode: 'exact',
            filterState,
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey(
          'toString(ResourceAttributes.`k8s`.`namespace`.`name`)',
        );
      });

      expect(searchFiltersModule.escapeFilterStateKeys).toHaveBeenCalledWith(
        {
          'ResourceAttributes.service.name': {
            included: new Set(['api']),
            excluded: new Set(),
          },
        },
        expect.any(Set),
        new Set(['ResourceAttributes']),
      );
      expect(
        useMetadataWithSettings.mock.results.at(-1)?.value.getKeyValuesWithMVs,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ["ResourceAttributes['k8s.namespace.name']"],
          chartConfig: expect.objectContaining({
            filters: [
              {
                type: 'sql',
                condition:
                  "toString(ResourceAttributes.`service`.`name`) IN ('api')",
              },
            ],
          }),
        }),
      );
    });

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

      expect(result.current.data.keyValues).toEqual([
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

      expect(result.current.data.keyValues).toEqual([
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

      expect(result.current.data.keyValues).toEqual([
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
      expect(result.current.data.keyValues).toEqual([
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
      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({ sourceId: 'source2' });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data.keyValues).toEqual([
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

      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({
        dateRange: [new Date('2024-02-01'), new Date('2024-02-02')],
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data.keyValues).toEqual([
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
      expect(result.current.data.keyValues).toEqual([
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
      expect(result.current.data.keyValues).toEqual([
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
      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api'] },
        { key: 'NewKey', value: ['n1'] },
      ]);

      rerender({
        chartConfig: { ...CHART_CONFIG, where: 'level = "error"' },
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
      expect(result.current.data.keyValues).toEqual([
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

  /**
   * `tableConnection` is a fallback, not an override: whenever a source is
   * available it wins, so its metadata materialized views keep serving key and
   * value discovery. Only two cases reach the fallback.
   *
   *  1. No source id. The dashboard-wide WHERE spans every tile, so no single
   *     source names its table. Deriving discovery from the source id alone
   *     left `tcFromSource(undefined)` returning an all-empty connection and
   *     `useAllFields`'s enabled guard rejecting it, so that input offered zero
   *     suggestions.
   *  2. A metric source, whose rows live in per-type tables its `from` doesn't
   *     name — KubernetesFilters always, and the tile editor and dashboard
   *     filters whenever a metric source is selected.
   *
   * Every other input passes a source id and never consults the fallback, even
   * though it still passes a connection.
   */
  describe('tableConnection fallback', () => {
    const FALLBACK_TC = {
      databaseName: 'other_db',
      tableName: 'other_table',
      connectionId: 'conn2',
    };

    const SOURCE_TC = expect.objectContaining({
      databaseName: 'db',
      tableName: 'logs',
      connectionId: 'conn1',
    });

    it('discovers fields from the connection when there is no sourceId', () => {
      setupDefaultMocks({ withMVs: false });
      mockSourceQuery(undefined);
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: null,
            tableConnection: FALLBACK_TC,
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper },
      );

      expect(useAllFields.mock.calls.at(-1)?.[0]).toEqual(FALLBACK_TC);
      expect(useColumns.mock.calls.at(-1)?.[0]).toEqual(FALLBACK_TC);
    });

    it('prefers the source over the connection, keeping its materialized views', () => {
      // Losing the source here would drop `metadataMVs`, sending Map-key
      // discovery to a raw table scan.
      setupDefaultMocks({ withMVs: true });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            tableConnection: FALLBACK_TC,
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      expect(useAllFields.mock.calls.at(-1)?.[0]).toEqual(SOURCE_TC);
      expect(useAllFields.mock.calls.at(-1)?.[0]?.metadataMVs).toBeDefined();
    });

    it('uses the connection for a metric source, whose from does not name a table', () => {
      // Metric rows live in per-type tables (gauge/sum/...). Only the caller
      // knows which one — and which metric — is in play.
      setupDefaultMocks({ withMVs: false });
      mockSourceQuery({
        id: 'source1',
        kind: SourceKind.Metric,
        name: 'metrics',
        connection: 'conn1',
        from: { databaseName: 'db', tableName: '' },
        timestampValueExpression: 'TimeUnix',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        resourceAttributesExpression: 'ResourceAttributes',
      });
      const { wrapper } = makeWrapper();

      const metricTc = { ...FALLBACK_TC, metricName: 'k8s.pod.cpu' };
      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            tableConnection: metricTc,
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      expect(useAllFields.mock.calls.at(-1)?.[0]).toEqual(metricTc);
    });

    it('ignores an incomplete connection', () => {
      // What a `tcFromSource` of a not-yet-loaded source looks like — using it
      // would disable the queries outright.
      setupDefaultMocks({ withMVs: false });
      const { wrapper } = makeWrapper();

      renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: 'source1',
            tableConnection: {
              databaseName: '',
              tableName: '',
              connectionId: '',
            },
            dateRange: DATE_RANGE,
            mode: 'all',
          }),
        { wrapper },
      );

      expect(useAllFields.mock.calls.at(-1)?.[0]).toEqual(SOURCE_TC);
    });

    it('loads more values from the connection when there is no source', async () => {
      setupDefaultMocks({ withMVs: false });
      mockSourceQuery(undefined);
      const getAllKeyValues = jest
        .fn()
        .mockResolvedValue([{ key: 'ServiceName', value: ['api'] }]);
      mockMetadata({
        getKeyValuesWithMVs: jest.fn(),
        getAllKeyValues,
      });

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: null,
            tableConnection: FALLBACK_TC,
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('ServiceName');
      });

      expect(getAllKeyValues).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseName: 'other_db',
          tableName: 'other_table',
          connectionId: 'conn2',
          keyExpressions: ['ServiceName'],
        }),
      );
      expect(result.current.data.keyValues).toEqual([
        { key: 'ServiceName', value: ['api'] },
      ]);
    });

    it('clears extraFacets when the connection changes', async () => {
      setupDefaultMocks({ withMVs: false });
      mockSourceQuery(undefined);
      mockMetadata({
        getKeyValuesWithMVs: jest.fn(),
        getAllKeyValues: jest
          .fn()
          .mockResolvedValue([{ key: 'NewKey', value: ['n1'] }]),
      });

      const { wrapper } = makeWrapper();
      const { result, rerender } = renderHook(
        (props: { tableConnection: typeof FALLBACK_TC }) =>
          useFetchFacets({
            chartConfig: CHART_CONFIG,
            sourceId: null,
            tableConnection: props.tableConnection,
            dateRange: DATE_RANGE,
            mode: 'all',
            disableValues: true,
          }),
        { wrapper, initialProps: { tableConnection: FALLBACK_TC } },
      );

      await act(async () => {
        await result.current.loadMoreFacetsForKey('NewKey');
      });

      expect(result.current.extraFacetKeys.has('NewKey')).toBe(true);

      rerender({
        tableConnection: { ...FALLBACK_TC, tableName: 'yet_another_table' },
      });

      expect(result.current.extraFacetKeys.size).toBe(0);
    });
  });
});
