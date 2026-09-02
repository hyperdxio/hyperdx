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
  useColumns,
  useDateTimeColumns,
  useGetKeyValues,
  useJsonColumns,
  useMapColumns,
  useMetadataWithSettings,
  useMultipleAllFields,
} from '@/hooks/useMetadata';
import { escapeFilterStateKeys, usePinnedFilters } from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath } from '@/utils';

import { toQuotedClickHouseKeyExpression } from './utils';

const INITIAL_LOAD_LIMIT = 20;

/* The maximum number of values per filter to load when "Load More" is clicked */
const LOAD_MORE_LOAD_LIMIT = 10000;

/**
 * Decide which table(s) key-value discovery reads from.
 *
 * The source stays authoritative whenever we have one, so its metadata
 * materialized views keep serving discovery. `fallbacks` — the table
 * connections a caller passes — are consulted in the two cases the source
 * cannot answer:
 *
 *  - No source id is provided
 *  - A metric source, whose `from.tableName` is empty because the real tables
 *    are per metric type; the caller resolves one per selected series
 *
 * More than one connection only arises for a metric source charting several
 * metric types at once. Field discovery intersects them, since a sidebar filter
 * applies to every series and offering a field only one table has would break
 * the others. Value lookups use the first instead: an intersected field exists
 * in all of them, so any one table can answer.
 */
export function resolveTableConnections(
  source: TSource | undefined,
  fallbacks: TableConnection[] | undefined,
): TableConnection[] {
  const usable = (fallbacks ?? []).filter(
    tc => !!tc.databaseName && !!tc.tableName && !!tc.connectionId,
  );
  if (!source) {
    return usable.length > 0 ? usable : [tcFromSource(undefined)];
  }
  if (isMetricSource(source) && usable.length > 0) {
    return usable;
  }
  return [tcFromSource(source)];
}

/** Single-table form of {@link resolveTableConnections}. */
export function resolveTableConnection(
  source: TSource | undefined,
  fallback: TableConnection | undefined,
): TableConnection {
  return resolveTableConnections(source, fallback ? [fallback] : [])[0];
}

function useFacets({
  chartConfig,
  sourceId,
  tableConnections: tableConnectionFallbacks,
  mode,
  dateRange,
  filterState,
  showMoreFields,
  enabled,
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  /**
   * Tables where keys and values are discovered. Used when sourceId is not
   * provided or references a metrics source. Memoize it — it keys the queries.
   */
  tableConnections?: TableConnection[];
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
  const tableConnections = useMemo(
    () => resolveTableConnections(source, tableConnectionFallbacks),
    [source, tableConnectionFallbacks],
  );
  const tableConnection = tableConnections[0];
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
  } = useMultipleAllFields(tableConnections, {
    dateRange,
    timestampValueExpression: source?.timestampValueExpression,
    enabled,
    intersect: tableConnections.length > 1,
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
    error: allFieldsError ?? rest.error,
    data: { keys: allFields, keyValues: facets },
    isLoading: isAllFieldsLoading || rest.isLoading,
    loadMoreFacetsForKey,
  };
}

export function useFetchFacets({
  chartConfig,
  sourceId,
  tableConnections,
  dateRange,
  mode,
  filterState,
  showMoreFields,
  disableValues,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  sourceId: string | null;
  /**
   * Tables where keys and values are discovered. Used when sourceId is not
   * provided or references a metrics source. Memoize it — it keys the queries.
   */
  tableConnections?: TableConnection[];
  dateRange: [Date, Date];
  mode: 'all' | 'exact';
  filterState?: FilterState;
  showMoreFields?: boolean;
  disableValues?: boolean;
}) {
  const facetsQuery = useFacets({
    chartConfig,
    sourceId,
    tableConnections,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    enabled: true,
    disableValues,
  });

  // Serialized, because callers pass this array inline. Keying the reset effect
  // below on its identity would fire it every render.
  const tableConnectionsKey = JSON.stringify(tableConnections ?? []);

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
    tableConnectionsKey,
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
