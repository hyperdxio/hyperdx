import { useCallback, useEffect, useMemo, useState } from 'react';
import produce from 'immer';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import {
  DEFAULT_FILTER_KEYS_FETCH_LIMIT,
  DEFAULT_FILTER_KEYS_FETCH_LIMIT_WITH_MVS,
} from '@/defaults';
import {
  Facet,
  useAllFields,
  useAllFieldsAndValues,
  useColumns,
  useDateTimeColumns,
  useGetKeyValues,
  useJsonColumns,
  useMapColumns,
  useMetadataWithSettings,
} from '@/hooks/useMetadata';
import { escapeFilterStateKeys, usePinnedFilters } from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath } from '@/utils';

import { toQuotedClickHouseKeyExpression } from './utils';

const INITIAL_LOAD_LIMIT = 20;

/* The maximum number of values per filter to load when "Load More" is clicked */
const LOAD_MORE_LOAD_LIMIT = 10000;

function useFacetsFromRawTables({
  chartConfig,
  sourceId,
  mode,
  dateRange,
  filterState,
  showMoreFields,
  enabled,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  mode: 'all' | 'exact';
  dateRange: [Date, Date];
  filterState?: FilterState;
  showMoreFields?: boolean;
  enabled?: boolean;
}) {
  const { data: source } = useSource({
    id: sourceId,
  });
  const tableConnection = tcFromSource(source);
  const { data: columns, isLoading: isColumnsLoading } =
    useColumns(tableConnection);
  const dateTimeColumns = useDateTimeColumns(columns);
  const knownColumns = useMemo(
    () => (columns ? new Set(columns.map(c => c.name)) : new Set<string>()),
    [columns],
  );
  const { data: jsonColumns } = useJsonColumns(tableConnection);
  const { data: mapColumns } = useMapColumns(tableConnection);

  const { data: allFields, error: allFieldsError } = useAllFields(
    tableConnection,
    {
      dateRange,
      timestampValueExpression: source?.timestampValueExpression,
      enabled,
    },
  );

  const { isFieldPinned, isSharedFieldPinned } = usePinnedFilters(
    sourceId ?? null,
  );

  const keysToFetch = useMemo(() => {
    if (!allFields) {
      return [];
    }

    const strings = allFields
      .sort((a, b) => {
        // First show low cardinality fields
        const isLowCardinality = (type: string) =>
          type.includes('LowCardinality');
        return isLowCardinality(a.type) && !isLowCardinality(b.type) ? -1 : 1;
      })
      .filter(
        field => field.jsType && ['string'].includes(field.jsType),
        // todo: add number type with sliders :D
      )
      .map(({ path, type }) => {
        return {
          type,
          path: mergePath(path, jsonColumns ?? [], mapColumns ?? []),
          isMapSubField: path.length > 1,
        };
      })
      .filter(
        field =>
          showMoreFields ||
          field.type.includes('LowCardinality') || // query only low cardinality fields by default
          field.isMapSubField || // always include Map/JSON sub-fields (e.g. LogAttributes, ResourceAttributes keys)
          (filterState && Object.keys(filterState).includes(field.path)) || // keep selected fields
          isFieldPinned(field.path) || // keep personally pinned fields
          isSharedFieldPinned(field.path), // keep team-shared fields
      )
      .map(({ path }) => path)
      .filter(
        path =>
          !['body', 'timestamp', '_hdx_body'].includes(path.toLowerCase()),
      );
    return strings;
  }, [
    allFields,
    jsonColumns,
    mapColumns,
    filterState,
    showMoreFields,
    isFieldPinned,
    isSharedFieldPinned,
  ]);

  const { escapedKeysToFetch, sqlKeyToUiKey } = useMemo(() => {
    // Don't fetch any keys until the column list is loaded,
    // since we need the real column names to escape correctly.
    if (isColumnsLoading) {
      return { escapedKeysToFetch: [], sqlKeyToUiKey: new Map() };
    }

    const sqlKeyToUiKey = new Map<string, string>();
    const escapedKeysToFetch = keysToFetch.map(key => {
      const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns);
      sqlKeyToUiKey.set(sqlKey, key);
      return sqlKey;
    });
    return { escapedKeysToFetch, sqlKeyToUiKey };
  }, [isColumnsLoading, keysToFetch, knownColumns]);

  const facetsChartConfig = useMemo(
    () =>
      mode === 'all'
        ? { ...chartConfig, dateRange, where: '', filters: [] }
        : { ...chartConfig, dateRange },
    [chartConfig, dateRange, mode],
  );

  // Exact pipeline step 2: fetch values for discovered keys
  const { data: rawExactFacets, ...rest } = useGetKeyValues(
    {
      chartConfig: facetsChartConfig,
      limit: INITIAL_LOAD_LIMIT,
      keys: escapedKeysToFetch,
    },
    { enabled },
  );

  // Map the (escaped) result keys back to the original UI keys.
  const exactFacets = useMemo<Facet[] | undefined>(
    () =>
      rawExactFacets?.map(f => ({
        ...f,
        key: sqlKeyToUiKey.get(f.key) ?? f.key,
      })),
    [rawExactFacets, sqlKeyToUiKey],
  );

  const metadata = useMetadataWithSettings();
  const loadMoreFacetsForKey = useCallback(
    async (key: string): Promise<Facet | undefined> => {
      try {
        const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns);
        const strippedFilterState: FilterState = { ...filterState };
        delete strippedFilterState[key];
        if (sqlKey !== key) delete strippedFilterState[sqlKey];
        const newKeyVals = await metadata.getKeyValuesWithMVs({
          chartConfig: {
            ...chartConfig,
            dateRange,
            filters: filtersToQuery(
              escapeFilterStateKeys(strippedFilterState, knownColumns),
              { dateTimeColumns },
            ),
          },
          keys: [sqlKey],
          limit: LOAD_MORE_LOAD_LIMIT,
          disableRowLimit: true,
          source,
        });
        return {
          key,
          value: newKeyVals[0].value?.map(val => val.toString()) ?? [],
        };
      } catch (error) {
        console.error('failed to fetch more keys', error);
      }
      return undefined;
    },
    [
      metadata,
      chartConfig,
      dateRange,
      knownColumns,
      source,
      filterState,
      dateTimeColumns,
    ],
  );

  return {
    ...rest,
    error: allFieldsError ?? rest.error,
    data: exactFacets,
    loadMoreFacetsForKey,
  };
}

function useAllFacetsFromMVs({
  sourceId,
  dateRange,
  enabled,
}: {
  sourceId: string | null;
  dateRange: [Date, Date];
  enabled?: boolean;
}) {
  const { data: source } = useSource({
    id: sourceId,
  });
  const tableConnection = tcFromSource(source);
  const hasMVs = tableConnection && !!tableConnection.metadataMVs;
  const { data: me } = api.useMe();
  const defaultLimit = hasMVs
    ? DEFAULT_FILTER_KEYS_FETCH_LIMIT_WITH_MVS
    : DEFAULT_FILTER_KEYS_FETCH_LIMIT;
  const maxKeys = me?.team?.filterKeysFetchLimit ?? defaultLimit;
  const { data: columns } = useColumns(tableConnection);
  const knownColumns = useMemo(
    () => (columns ? new Set(columns.map(c => c.name)) : new Set<string>()),
    [columns],
  );

  const metadata = useMetadataWithSettings();
  const loadMoreFacetsForKey = useCallback(
    async (key: string) => {
      try {
        const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns);
        const results = await metadata.getAllKeyValues({
          databaseName: tableConnection.databaseName,
          tableName: tableConnection.tableName,
          connectionId: tableConnection.connectionId,
          keyExpressions: [sqlKey],
          maxValuesPerKey: LOAD_MORE_LOAD_LIMIT,
          metadataMVs: tableConnection.metadataMVs,
          dateRange,
          timestampValueExpression: source?.timestampValueExpression,
        });
        const newValues = results[0] ? results[0].value : [];
        return { key, value: newValues };
      } catch (error) {
        console.error('failed to fetch more keys via MV facets', error);
      }
    },
    [knownColumns, dateRange, metadata, tableConnection, source],
  );

  const queryRes = useAllFieldsAndValues(
    {
      ...tableConnection,
      dateRange,
      maxKeys,
    },
    { enabled },
  );
  return { ...queryRes, loadMoreFacetsForKey };
}

export function useFetchFacets({
  chartConfig,
  sourceId,
  dateRange,
  mode,
  filterState,
  showMoreFields,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  dateRange: [Date, Date];
  mode: 'all' | 'exact';
  filterState?: FilterState;
  showMoreFields?: boolean;
}) {
  const { data: source } = useSource({
    id: sourceId,
  });
  const tableConnection = tcFromSource(source);
  const hasMVs = !!tableConnection.metadataMVs;
  const useRawTablePipeline = !hasMVs || mode === 'exact';

  const fromMVs = useAllFacetsFromMVs({
    sourceId,
    dateRange,
    enabled: !useRawTablePipeline,
  });

  // Exact pipeline: fetch values for discovered keys
  const fromRawTables = useFacetsFromRawTables({
    chartConfig,
    sourceId,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    enabled: useRawTablePipeline,
  });

  const [extraFacets, setExtraFacets] = useState<Facet[] | null>(null);
  const facets = useMemo(() => {
    const facets = useRawTablePipeline ? fromRawTables.data : fromMVs.data;
    if (!facets) return undefined;
    if (!extraFacets || extraFacets.length === 0) return facets;
    const seenFacets = new Set();
    const output: Facet[] = [];
    for (const facet of facets) {
      seenFacets.add(facet.key);
      const extraFacet = extraFacets.find(ef => ef.key === facet.key);
      if (extraFacet) {
        output.push(extraFacet);
      } else {
        output.push(facet);
      }
    }
    for (const extraFacet of extraFacets) {
      if (!seenFacets.has(extraFacet.key)) {
        output.push(extraFacet);
      }
    }
    return output;
  }, [fromMVs.data, fromRawTables.data, useRawTablePipeline, extraFacets]);

  const [extraFacetKeys, setExtraFacetKeys] = useState<Set<string>>(new Set());
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const extraFacetsLoading = loadMoreLoadingKeys.size > 0;
  const loadMoreFacetsForKey = useCallback(
    async (key: string) => {
      const strategy = useRawTablePipeline
        ? fromRawTables.loadMoreFacetsForKey
        : fromMVs.loadMoreFacetsForKey;
      setLoadMoreLoadingKeys(prev =>
        produce(prev, draft => {
          draft.add(key);
        }),
      );
      const newFacet = await strategy(key);
      if (newFacet) {
        setExtraFacets(prev => [...(prev ?? []), newFacet]);
      }
      setLoadMoreLoadingKeys(prev =>
        produce(prev, draft => {
          draft.delete(key);
        }),
      );
      setExtraFacetKeys(prev =>
        produce(prev, draft => {
          draft.add(key);
        }),
      );
    },
    [
      fromRawTables.loadMoreFacetsForKey,
      fromMVs.loadMoreFacetsForKey,
      useRawTablePipeline,
    ],
  );

  // Clear extra facets (from "load more") when switching sources or new date range
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExtraFacets(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExtraFacetKeys(new Set());
  }, [sourceId, dateRange]);

  const output = useMemo(() => {
    return {
      ...(useRawTablePipeline ? fromRawTables : fromMVs),
      data: facets,
      loadMoreFacetsForKey: loadMoreFacetsForKey,
      areExtraFacetsLoading: extraFacetsLoading,
      loadMoreLoadingKeys,
      extraFacetKeys,
    };
  }, [
    useRawTablePipeline,
    fromMVs,
    fromRawTables,
    facets,
    loadMoreFacetsForKey,
    extraFacetsLoading,
    loadMoreLoadingKeys,
    extraFacetKeys,
  ]);

  return output;
}
