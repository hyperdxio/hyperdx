import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  mode: 'all' | 'exact';
  dateRange: [Date, Date];
  filterState?: FilterState;
  showMoreFields?: boolean;
  enabled?: boolean;
  disableValues?: boolean;
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
        return (
          (isLowCardinality(b.type) ? 1 : 0) -
          (isLowCardinality(a.type) ? 1 : 0)
        );
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
      const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns, {
        jsonColumns: jsonColumns ?? [],
      });
      sqlKeyToUiKey.set(sqlKey, key);
      return sqlKey;
    });
    return { escapedKeysToFetch, sqlKeyToUiKey };
  }, [isColumnsLoading, jsonColumns, keysToFetch, knownColumns]);

  const facetsChartConfig = useMemo(
    () =>
      mode === 'all'
        ? { ...chartConfig, dateRange, where: '', filters: [] }
        : { ...chartConfig, dateRange },
    [chartConfig, dateRange, mode],
  );

  const { data: rawFacets, ...rest } = useGetKeyValues(
    {
      chartConfig: facetsChartConfig,
      limit: INITIAL_LOAD_LIMIT,
      keys: escapedKeysToFetch,
      mode,
    },
    { enabled: enabled && !disableValues },
  );

  // Map the (escaped) result keys back to the original UI keys.
  const facets = useMemo<Facet[] | undefined>(
    () =>
      rawFacets?.map(f => ({
        ...f,
        key: sqlKeyToUiKey.get(f.key) ?? f.key,
      })),
    [rawFacets, sqlKeyToUiKey],
  );

  const metadata = useMetadataWithSettings();
  const loadMoreFacetsForKey = useCallback(
    async (key: string): Promise<Facet | undefined> => {
      try {
        const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns, {
          jsonColumns: jsonColumns ?? [],
        });
        if (mode === 'exact') {
          const strippedFilterState: FilterState = { ...filterState };
          delete strippedFilterState[key];
          if (sqlKey !== key) delete strippedFilterState[sqlKey];
          const newKeyVals = await metadata.getKeyValuesWithMVs({
            chartConfig: {
              ...chartConfig,
              dateRange,
              filters: filtersToQuery(
                escapeFilterStateKeys(
                  strippedFilterState,
                  knownColumns,
                  jsonColumns ?? [],
                ),
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
        }

        if (!source) {
          throw new Error('loadMoreFacetsForKey: source must be defined');
        }
        const newKeyVals = await metadata.getAllKeyValues({
          databaseName: source.from.databaseName,
          tableName: source.from.tableName,
          connectionId: source.connection,
          metadataMVs: tableConnection.metadataMVs,
          keyExpressions: [sqlKey],
          maxValuesPerKey: LOAD_MORE_LOAD_LIMIT,
          dateRange,
          timestampValueExpression: source.timestampValueExpression,
        });
        return {
          key,
          value:
            newKeyVals.length > 0
              ? (newKeyVals[0].value?.map(val => val.toString()) ?? [])
              : [],
        };
      } catch (error) {
        console.error('failed to fetch more keys', error);
      }
      return undefined;
    },
    [
      mode,
      tableConnection,
      metadata,
      chartConfig,
      dateRange,
      knownColumns,
      source,
      filterState,
      dateTimeColumns,
      jsonColumns,
    ],
  );

  return {
    ...rest,
    error: allFieldsError ?? rest.error,
    data: { keys: allFields, keyValues: facets },
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
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  dateRange: [Date, Date];
  mode: 'all' | 'exact';
  filterState?: FilterState;
  showMoreFields?: boolean;
  disableValues?: boolean;
}) {
  const facetsQuery = useFacets({
    chartConfig,
    sourceId,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    enabled: true,
    disableValues,
  });

  const [extraFacets, setExtraFacets] = useState<Facet[] | null>(null);
  const loadMoreGenerationRef = useRef(0);
  const facets = useMemo<Facet[] | undefined>(() => {
    const base = facetsQuery.data.keyValues;
    const hasExtras = !!extraFacets && extraFacets.length > 0;

    if (base === undefined && !hasExtras) return undefined;
    if (!hasExtras) return base;
    if (base === undefined) return extraFacets ?? undefined;

    const seenFacets = new Set<string>();
    const output: Facet[] = [];
    for (const facet of base) {
      seenFacets.add(facet.key);
      const extraFacet = extraFacets!.find(ef => ef.key === facet.key);
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

  const [extraFacetKeys, setExtraFacetKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadMoreLoadingKeys, setLoadMoreLoadingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const areExtraFacetsLoading = loadMoreLoadingKeys.size > 0;
  const loadMoreFacetsForKey = useCallback(
    async (key: string) => {
      const requestGeneration = loadMoreGenerationRef.current;
      const strategy = facetsQuery.loadMoreFacetsForKey;
      setLoadMoreLoadingKeys(prev =>
        produce(prev, draft => {
          draft.add(key);
        }),
      );
      try {
        const newFacet = await strategy(key);
        if (newFacet && requestGeneration === loadMoreGenerationRef.current) {
          setExtraFacets(prev => [
            ...(prev ?? []).filter(facet => facet.key !== newFacet.key),
            newFacet,
          ]);
          setExtraFacetKeys(prev =>
            produce(prev, draft => {
              draft.add(key);
            }),
          );
        }
      } finally {
        if (requestGeneration === loadMoreGenerationRef.current) {
          setLoadMoreLoadingKeys(prev =>
            produce(prev, draft => {
              draft.delete(key);
            }),
          );
        }
      }
    },
    [facetsQuery.loadMoreFacetsForKey],
  );

  // Clear extras when the query scope that produced them changes; otherwise
  // they'd persist against a query they were never fetched for.
  useEffect(() => {
    loadMoreGenerationRef.current += 1;

    setExtraFacets(null);
    setExtraFacetKeys(new Set());

    setLoadMoreLoadingKeys(new Set());
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
    data: { keys: facetsQuery.data.keys, keyValues: facets },
    loadMoreFacetsForKey,
    areExtraFacetsLoading,
    loadMoreLoadingKeys,
    extraFacetKeys,
  };
}
