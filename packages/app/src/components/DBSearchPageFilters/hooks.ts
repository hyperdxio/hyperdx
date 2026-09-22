import { useCallback, useEffect, useMemo, useState } from 'react';
import produce from 'immer';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  isMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';

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

/* The maximum number of matched fields a filter-name search fetches values for */
const SEARCH_MAX_KEYS = 50;

/* Shorter than this matches most of the schema, so it isn't worth a query */
const MIN_SEARCH_LENGTH = 2;

/* Free-text bodies and the timestamp are never useful as faceted filters */
const NON_FACET_PATHS = ['body', 'timestamp', '_hdx_body'];

/**
 * Decide which table key-value discovery reads from.
 *
 * The source stays authoritative whenever we have one, so its metadata
 * materialized views keep serving discovery. `fallback` — the table connection
 * a caller passes — is consulted in the two cases the source can't answer:
 *
 *  - No source id is provided
 *  - A metric source, in which case the fallback provides the metric type's table name
 */
export function resolveTableConnection(
  source: TSource | undefined,
  fallback: TableConnection | undefined,
): TableConnection {
  const isFallbackUsable =
    !!fallback?.databaseName && !!fallback.tableName && !!fallback.connectionId;
  if (!source) {
    return isFallbackUsable ? fallback : tcFromSource(undefined);
  }
  if (isMetricSource(source) && isFallbackUsable) {
    return fallback;
  }
  return tcFromSource(source);
}

function useFacets({
  chartConfig,
  sourceId,
  tableConnection: tableConnectionFallback,
  mode,
  dateRange,
  filterState,
  showMoreFields,
  searchQuery,
  enabled,
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  /**
   * A table where keys and values are discovered. Used when sourceId
   * is not provided or references a metrics source.
   */
  tableConnection?: TableConnection;
  mode: 'all' | 'exact';
  dateRange: [Date, Date];
  filterState?: FilterState;
  showMoreFields?: boolean;
  /** Debounced filter-name search; fetches values for fields matching it. */
  searchQuery?: string;
  enabled?: boolean;
  disableValues?: boolean;
}) {
  const { data: source } = useSource({
    id: sourceId,
  });
  const tableConnection = useMemo(
    () => resolveTableConnection(source, tableConnectionFallback),
    [source, tableConnectionFallback],
  );
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
      .filter(path => !NON_FACET_PATHS.includes(path.toLowerCase()));
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

  // Searched over every string field rather than `keysToFetch`, which is the
  // point: the browse list deliberately omits high-cardinality columns, and
  // those are exactly the filters a user resorts to searching for.
  const searchKeysToFetch = useMemo(() => {
    const needle = searchQuery?.trim().toLowerCase() ?? '';
    if (!allFields || needle.length < MIN_SEARCH_LENGTH) {
      return [];
    }
    return allFields
      .filter(field => field.jsType === 'string')
      .map(({ path }) => {
        const merged = mergePath(path, jsonColumns ?? [], mapColumns ?? []);
        return {
          path: merged,
          // JSON sub-paths arrive backtick-quoted (Body.`user`.`id`), which no
          // one types. Matched against the bare text the sidebar displays.
          haystack: merged.toLowerCase().replaceAll('`', ''),
        };
      })
      .filter(
        ({ path, haystack }) =>
          !NON_FACET_PATHS.includes(path.toLowerCase()) &&
          haystack.includes(needle),
      )
      .sort((a, b) => {
        // SEARCH_MAX_KEYS is a hard cutoff, so this order decides which matches
        // get values at all — prefix matches are the likelier intent.
        const aPrefix = a.haystack.startsWith(needle);
        const bPrefix = b.haystack.startsWith(needle);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
        return a.path.localeCompare(b.path);
      })
      .slice(0, SEARCH_MAX_KEYS)
      .map(({ path }) => path);
  }, [allFields, jsonColumns, mapColumns, searchQuery]);

  const { escapedKeysToFetch, escapedSearchMatches, sqlKeyToUiKey } =
    useMemo(() => {
      // Don't fetch any keys until the column list is loaded,
      // since we need the real column names to escape correctly.
      if (isColumnsLoading) {
        return {
          escapedKeysToFetch: [],
          escapedSearchMatches: [],
          sqlKeyToUiKey: new Map(),
        };
      }

      const sqlKeyToUiKey = new Map<string, string>();
      const escape = (key: string) => {
        const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns);
        sqlKeyToUiKey.set(sqlKey, key);
        return sqlKey;
      };
      return {
        escapedKeysToFetch: keysToFetch.map(escape),
        escapedSearchMatches: searchKeysToFetch.map(escape),
        sqlKeyToUiKey,
      };
    }, [isColumnsLoading, keysToFetch, searchKeysToFetch, knownColumns]);

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

  // Whatever browse already returned needs no second lookup — same keys, same
  // limit, same scope. Without this, searching for a field that is already on
  // screen costs a round trip that answers with what we are holding, which is
  // the most common search there is. Keyed off what came back rather than what
  // was asked for: the browse query truncates at `maxKeys`, so "we requested
  // it" does not mean "we have it".
  const browseKeys = useMemo(
    () => new Set((rawFacets ?? []).map(facet => facet.key)),
    [rawFacets],
  );
  const escapedSearchKeys = useMemo(
    () => escapedSearchMatches.filter(key => !browseKeys.has(key)),
    [escapedSearchMatches, browseKeys],
  );

  // A second query rather than widening the one above: the browse list must
  // survive typing untouched, so clearing the search costs nothing and each
  // search term caches on its own.
  const {
    data: lastSearchFacets,
    isFetching: isSearchFetching,
    error: searchError,
  } = useGetKeyValues(
    {
      chartConfig: facetsChartConfig,
      limit: INITIAL_LOAD_LIMIT,
      keys: escapedSearchKeys,
      mode,
    },
    { enabled: enabled && !disableValues && escapedSearchKeys.length > 0 },
  );

  // `keepPreviousData` keeps serving the last search's page even once the query
  // is disabled, which would leave fields the browse list never asked for
  // sitting in the sidebar after the search box is cleared.
  const rawSearchFacets =
    escapedSearchKeys.length > 0 ? lastSearchFacets : undefined;

  // Map the (escaped) result keys back to the original UI keys, and union the
  // search results in. Search and browse can ask for the same key, and while a
  // new search is in flight `rawSearchFacets` still holds the previous term's
  // page — harmless, since the caller filters by the typed text anyway.
  const facets = useMemo<Facet[] | undefined>(() => {
    if (rawFacets === undefined && rawSearchFacets === undefined) {
      return undefined;
    }
    const byKey = new Map<string, Facet>();
    for (const facet of [...(rawFacets ?? []), ...(rawSearchFacets ?? [])]) {
      const key = sqlKeyToUiKey.get(facet.key) ?? facet.key;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { key, value: [...facet.value] });
        continue;
      }
      const seen = new Set(existing.value);
      for (const value of facet.value) {
        if (!seen.has(value)) {
          seen.add(value);
          existing.value.push(value);
        }
      }
    }
    return [...byKey.values()];
  }, [rawFacets, rawSearchFacets, sqlKeyToUiKey]);

  const metadata = useMetadataWithSettings();
  const loadMoreFacetsForKey = useCallback(
    async (key: string): Promise<Facet | undefined> => {
      try {
        const sqlKey = toQuotedClickHouseKeyExpression(key, knownColumns);
        if (mode === 'exact') {
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
        }

        if (
          !tableConnection.databaseName ||
          !tableConnection.tableName ||
          !tableConnection.connectionId
        ) {
          throw new Error(
            'loadMoreFacetsForKey: a source or table connection must be defined',
          );
        }
        const newKeyVals = await metadata.getAllKeyValues({
          databaseName: tableConnection.databaseName,
          tableName: tableConnection.tableName,
          connectionId: tableConnection.connectionId,
          metadataMVs: tableConnection.metadataMVs,
          keyExpressions: [sqlKey],
          maxValuesPerKey: LOAD_MORE_LOAD_LIMIT,
          dateRange,
          timestampValueExpression:
            source?.timestampValueExpression ??
            chartConfig.timestampValueExpression ??
            '',
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
    ],
  );

  return {
    ...rest,
    // A failed search must not read as "no matching filters": the caller
    // reports this, so a field that exists but could not be looked up is
    // distinguishable from one that genuinely has no values.
    error: allFieldsError ?? rest.error ?? searchError,
    data: { keys: allFields, keyValues: facets },
    isLoading: isAllFieldsLoading || rest.isLoading,
    isSearchFetching,
    loadMoreFacetsForKey,
  };
}

export function useFetchFacets({
  chartConfig,
  sourceId,
  tableConnection,
  dateRange,
  mode,
  filterState,
  showMoreFields,
  searchQuery,
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  /**
   * A table where keys and values are discovered. Used when sourceId
   * is not provided or references a metrics source.
   */
  tableConnection?: TableConnection;
  dateRange: [Date, Date];
  mode: 'all' | 'exact';
  filterState?: FilterState;
  showMoreFields?: boolean;
  /** Debounced filter-name search; fetches values for fields matching it. */
  searchQuery?: string;
  disableValues?: boolean;
}) {
  const facetsQuery = useFacets({
    chartConfig,
    sourceId,
    tableConnection,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    searchQuery,
    enabled: true,
    disableValues,
  });

  const [extraFacets, setExtraFacets] = useState<Facet[] | null>(null);
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
    tableConnection?.databaseName,
    tableConnection?.tableName,
    tableConnection?.connectionId,
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
