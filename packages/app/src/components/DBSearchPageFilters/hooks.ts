import { useCallback, useEffect, useMemo, useState } from 'react';
import produce from 'immer';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  Facet,
  useAllFields,
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

function useFacets({
  chartConfig,
  sourceId,
  mode,
  dateRange,
  filterState,
  showMoreFields,
  enabled,
  deferLoadingKeyValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  mode: 'all' | 'exact';
  dateRange: [Date, Date];
  filterState?: FilterState;
  showMoreFields?: boolean;
  enabled?: boolean;
  deferLoadingKeyValues?: boolean;
}) {
  const { data: source } = useSource({
    id: sourceId,
  });
  const tableConnection = useMemo(() => tcFromSource(source), [source]);
  const { data: columns, isLoading: isColumnsLoading } =
    useColumns(tableConnection);
  const dateTimeColumns = useDateTimeColumns(columns);
  const knownColumns = useMemo(
    () => (columns ? new Set(columns.map(c => c.name)) : new Set<string>()),
    [columns],
  );
  const { data: jsonColumns } = useJsonColumns(tableConnection);
  const { data: mapColumns } = useMapColumns(tableConnection);

  const {
    data: allFields,
    error: allFieldsError,
    isLoading: isAllFieldsLoading,
  } = useAllFields(tableConnection, {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
    enabled,
  });

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

  const { data: rawExactFacets, ...rest } = useGetKeyValues(
    {
      chartConfig: facetsChartConfig,
      limit: INITIAL_LOAD_LIMIT,
      keys: escapedKeysToFetch,
      mode,
    },
    { enabled: enabled && !deferLoadingKeyValues },
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
        if (mode === 'exact') {
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
        } else {
          if (!source)
            throw new Error('loadMoreFacetsForKey: source must be defined');
          const newKeyVals = await metadata.getAllKeyValues({
            databaseName: source.from.databaseName,
            tableName: source.from.tableName,
            connectionId: source.connection,
            metadataMVs: tableConnection.metadataMVs,
            keyExpressions: [sqlKey],
            maxValuesPerKey: LOAD_MORE_LOAD_LIMIT,
            dateRange,
            timestampValueExpression: source?.timestampValueExpression,
          });
          return {
            key,
            value:
              newKeyVals.length > 0
                ? (newKeyVals[0].value?.map(val => val.toString()) ?? [])
                : [],
          };
        }
      } catch (error) {
        console.error('failed to fetch more keys', error);
      }
      return undefined;
    },
    [
      tableConnection,
      mode,
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
    data: { keys: allFields, keyValues: exactFacets },
    isLoading: isAllFieldsLoading || rest.isLoading,
    loadMoreFacetsForKey,
  };
}

export function useFetchFacets({
  chartConfig,
  sourceId,
  dateRange,
  mode,
  filterState,
  showMoreFields,
  deferLoadingKeyValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  dateRange: [Date, Date];
  mode: 'all' | 'exact';
  filterState?: FilterState;
  showMoreFields?: boolean;
  deferLoadingKeyValues?: boolean;
}) {
  // Exact pipeline: fetch values for discovered keys
  const facetsQuery = useFacets({
    chartConfig,
    sourceId,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    enabled: true,
    deferLoadingKeyValues,
  });

  const [extraFacets, setExtraFacets] = useState<Facet[] | null>(null);
  const facets = useMemo(() => {
    const facets = facetsQuery.data.keyValues ?? [];
    if (!extraFacets || extraFacets.length === 0) return facets;
    const seenFacets = new Set();
    const output: Facet[] = [];
    for (const facet of facets) {
      seenFacets.add(facet.key);
      const extraFacet = extraFacets.find(ef => ef.key === facet.key);
      if (extraFacet) {
        // Union values: primary is query-scoped and must not be overridden;
        // extras from "Load More" only append (see PR #2329, commit 8938b05ef).
        const seenValues = new Set(facet.value);
        const merged = [...facet.value];
        for (const v of extraFacet.value) {
          if (!seenValues.has(v)) {
            seenValues.add(v);
            merged.push(v);
          }
        }
        output.push({ key: facet.key, value: merged });
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
  }, [facetsQuery.data, extraFacets]);

  const [extraFacetKeys, setExtraFacetKeys] = useState<Set<string>>(new Set());
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    new Set(),
  );
  const areExtraFacetsLoading = loadMoreLoadingKeys.size > 0;
  const loadMoreFacetsForKey = useCallback(
    async (key: string) => {
      const strategy = facetsQuery.loadMoreFacetsForKey;
      setLoadMoreLoadingKeys(prev =>
        produce(prev, draft => {
          draft.add(key);
        }),
      );
      const newFacet = await strategy(key);
      if (newFacet) {
        setExtraFacets(prev => [...(prev ?? []), newFacet]);
        setExtraFacetKeys(prev =>
          produce(prev, draft => {
            draft.add(key);
          }),
        );
      }
      setLoadMoreLoadingKeys(prev =>
        produce(prev, draft => {
          draft.delete(key);
        }),
      );
    },
    [facetsQuery.loadMoreFacetsForKey],
  );

  // Clear extras when the query scope that produced them changes; otherwise
  // they'd persist against a query they were never fetched for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExtraFacets(null);
    setExtraFacetKeys(new Set());
  }, [
    sourceId,
    dateRange,
    mode,
    filterState,
    chartConfig.where,
    chartConfig.whereLanguage,
  ]);

  return {
    ...facetsQuery,
    data: { keys: facetsQuery.data?.keys, keyValues: facets },
    loadMoreFacetsForKey,
    areExtraFacetsLoading,
    loadMoreLoadingKeys,
    extraFacetKeys,
  };
}
