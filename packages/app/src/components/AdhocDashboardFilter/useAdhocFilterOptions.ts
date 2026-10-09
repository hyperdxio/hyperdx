import { useCallback, useMemo } from 'react';
import {
  ColumnMeta,
  filterColumnMetaByType,
  JSDataType,
  QueryAttribution,
} from '@hyperdx/common-utils/dist/clickhouse';
import { Field, tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { getAdhocFilterSourceKinds } from '@hyperdx/common-utils/dist/filters';
import {
  AdhocDashboardFilter,
  isPromqlSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQueries,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';

import api from '@/api';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import {
  fetchPromqlLabelNames,
  fetchPromqlLabelValues,
  toPromqlSeconds,
} from '@/hooks/usePromqlMetadata';
import { useMetadataQueryAttribution } from '@/queryAttribution';
import { pickSourceConfigFields } from '@/ServicesDashboardPage/helpers';
import { useSources } from '@/source';
import { mergePath } from '@/utils';

const STALE_TIME_MS = 1000 * 60 * 5;
const VALUES_LIMIT = 100;

/** Columns that hold structure rather than a filterable value. */
const NON_SCALAR_TYPES = [
  JSDataType.Map,
  JSDataType.JSON,
  JSDataType.Array,
  JSDataType.Tuple,
];

const unionSorted = (lists: (string[] | undefined)[]) =>
  Array.from(new Set(lists.flatMap(list => list ?? []))).sort();

const promqlLookupParams = (
  source: TSource,
  dateRange: [Date, Date],
  attribution: QueryAttribution,
) => ({
  connectionId: source.connection,
  database: source.from.databaseName,
  table: source.from.tableName,
  ...toPromqlSeconds(dateRange),
  attribution,
});

/**
 * A SQL source's filterable keys, in the search sidebar's key format: scalar
 * columns, and the keys inside its map and JSON columns.
 */
export function getSqlSourceKeys(fields: Field[], columns: ColumnMeta[]) {
  const columnNames = (types: JSDataType[]) =>
    filterColumnMetaByType(columns, types)?.map(column => column.name) ?? [];
  const jsonColumns = columnNames([JSDataType.JSON]);
  const mapColumns = columnNames([JSDataType.Map]);
  return fields
    .filter(
      field =>
        field.path.length > 1 ||
        field.jsType == null ||
        !NON_SCALAR_TYPES.includes(field.jsType),
    )
    .map(field => mergePath(field.path, jsonColumns, mapColumns));
}

/**
 * The sources to look up `key`'s values in: those known to have it, so a source
 * without the column doesn't fail its query, or every source when none are
 * known to (a key typed by hand).
 */
export function getSourcesWithKey<T extends { id: string }>(
  sources: T[],
  keysBySourceId: ReadonlyMap<string, string[]>,
  key: string,
) {
  const withKey = sources.filter(source =>
    keysBySourceId.get(source.id)?.includes(key),
  );
  return withKey.length > 0 ? withKey : sources;
}

/** The filter's sources, limited to the kinds its source type reads. */
export function useAdhocFilterSources(filter: AdhocDashboardFilter) {
  const { data: allSources } = useSources();
  return useMemo(() => {
    const kinds = getAdhocFilterSourceKinds(filter.sourceType);
    return (allSources ?? []).filter(
      source =>
        filter.sources.includes(source.id) && kinds.includes(source.kind),
    );
  }, [allSources, filter.sources, filter.sourceType]);
}

/**
 * Keys offered by an ad hoc filter: columns and map / JSON keys of its SQL
 * sources, in the search sidebar's key format, or label names of its PromQL
 * sources. Deduplicated across sources.
 */
export function useAdhocFilterKeys(
  filter: AdhocDashboardFilter,
  dateRange: [Date, Date],
) {
  const metadata = useMetadataWithSettings();
  const attribution = useMetadataQueryAttribution();
  const { data: me, isFetched: isMeFetched } = api.useMe();
  const isFieldMetadataDisabled = !!me?.team?.fieldMetadataDisabled;
  const sources = useAdhocFilterSources(filter);
  const { start, end } = toPromqlSeconds(dateRange);

  const fetchKeys = async (source: TSource): Promise<string[]> => {
    if (isPromqlSource(source)) {
      const labels = await fetchPromqlLabelNames(
        promqlLookupParams(source, dateRange, attribution),
      );
      return labels.filter(label => label !== '__name__');
    }

    const tc = tcFromSource(source);
    const columns = await metadata.getColumns(tc);
    if (isFieldMetadataDisabled) {
      return columns.map(column => column.name);
    }
    const fields = await metadata.getAllFields({ ...tc, dateRange });
    return getSqlSourceKeys(fields, columns);
  };

  // A stable `combine` keeps the result referentially stable across renders
  // until a query's data changes.
  const combineKeys = useCallback(
    (results: UseQueryResult<string[]>[]) => {
      const keysBySourceId = new Map<string, string[]>();
      sources.forEach((source, index) => {
        const keys = results[index]?.data;
        if (keys) keysBySourceId.set(source.id, keys);
      });
      return {
        data: unionSorted(results.map(result => result.data)),
        keysBySourceId,
        isLoading: results.some(result => result.isLoading),
        isError: results.some(result => result.isError),
      };
    },
    [sources],
  );

  return useQueries({
    queries: sources.map(
      (source): UseQueryOptions<string[]> => ({
        queryKey: [
          'adhoc-filter-keys',
          source.id,
          start,
          end,
          isFieldMetadataDisabled,
        ],
        queryFn: () => fetchKeys(source),
        enabled: isMeFetched,
        staleTime: STALE_TIME_MS,
        placeholderData: keepPreviousData,
      }),
    ),
    combine: combineKeys,
  });
}

/** Values observed for `key` across an ad hoc filter's sources, deduplicated. */
export function useAdhocFilterValues(
  filter: AdhocDashboardFilter,
  key: string,
  dateRange: [Date, Date],
  keysBySourceId: ReadonlyMap<string, string[]>,
) {
  const metadata = useMetadataWithSettings();
  const attribution = useMetadataQueryAttribution();
  const sources = useAdhocFilterSources(filter);
  const { start, end } = toPromqlSeconds(dateRange);

  const sourcesWithKey = useMemo(
    () => getSourcesWithKey(sources, keysBySourceId, key),
    [sources, keysBySourceId, key],
  );

  const fetchValues = async (
    source: TSource,
    signal: AbortSignal,
  ): Promise<string[]> => {
    if (isPromqlSource(source)) {
      return fetchPromqlLabelValues({
        label: key,
        ...promqlLookupParams(source, dateRange, attribution),
      });
    }
    const keyValues = await metadata.getKeyValuesWithMVs({
      chartConfig: {
        ...pickSourceConfigFields(source),
        dateRange,
        source: source.id,
        select: '',
        where: '',
        whereLanguage: 'sql',
      },
      keys: [key],
      limit: VALUES_LIMIT,
      source,
      signal,
    });
    return keyValues.flatMap(({ value }) => value.map(String));
  };

  const combineValues = useCallback(
    (results: UseQueryResult<string[]>[]) => ({
      data: unionSorted(results.map(result => result.data)),
      isLoading: !!key && results.some(result => result.isFetching),
      isError: !!key && results.some(result => result.isError),
    }),
    [key],
  );

  return useQueries({
    queries: sourcesWithKey.map(
      (source): UseQueryOptions<string[]> => ({
        queryKey: ['adhoc-filter-values', source.id, key, start, end],
        queryFn: ({ signal }) => fetchValues(source, signal),
        enabled: !!key,
        staleTime: STALE_TIME_MS,
        retry: false,
      }),
    ),
    combine: combineValues,
  });
}
