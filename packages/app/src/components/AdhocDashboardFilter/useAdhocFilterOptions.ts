import { useCallback, useMemo } from 'react';
import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  filterColumnMetaByType,
  isJSDataTypeScalar,
  JSDataType,
  QueryAttribution,
} from '@hyperdx/common-utils/dist/clickhouse';
import { Field, tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  getAdhocFilterSourceKinds,
  isAdhocComparableDataType,
} from '@hyperdx/common-utils/dist/filters';
import {
  AdhocDashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQueries,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';

import { toQuotedClickHouseKeyExpression } from '@/components/DBSearchPageFilters/utils';
import {
  Facet,
  SINGLE_KEY_VALUES_LIMIT,
  useMultipleAllFields,
  useMultipleGetKeyValues,
} from '@/hooks/useMetadata';
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
const NO_SOURCES: TSource[] = [];
const NO_COLUMNS: Set<string> = new Set();

const unionSorted = (lists: (string[] | undefined)[]) =>
  Array.from(new Set(lists.flatMap(list => list ?? []))).sort();

/**
 * Quote a column name that isn't a bare identifier (e.g. `log-attributes`), so
 * the stored key is SQL that broadcasting can use verbatim.
 */
const toQuotedKeys = (keys: string[], columns: ColumnMeta[]) => {
  const columnNames = new Set(columns.map(column => column.name));
  return keys.map(key => toQuotedClickHouseKeyExpression(key, columnNames));
};

/**
 * A SQL source's filterable keys, as SQL expressions in the search sidebar's
 * key format: scalar columns, and the keys inside its map and JSON columns.
 * `keepType` defaults to the ad hoc rule, which drops DateTime. Column and
 * sort pickers pass a predicate that keeps every type.
 */
export function getSqlSourceKeys(
  fields: Field[],
  columns: ColumnMeta[],
  keepType: (type: string) => boolean = isAdhocComparableDataType,
) {
  const columnNames = (types: JSDataType[]) =>
    filterColumnMetaByType(columns, types)?.map(column => column.name) ?? [];
  const jsonColumns = columnNames([JSDataType.JSON]);
  const mapColumns = columnNames([JSDataType.Map]);
  const keys = fields
    .filter(
      field =>
        (field.path.length > 1 || isJSDataTypeScalar(field.jsType)) &&
        keepType(field.type),
    )
    .map(field => mergePath(field.path, jsonColumns, mapColumns));
  return toQuotedKeys(keys, columns);
}

/** A SQL source's scalar columns, the only keys known without field metadata. */
export function getSqlSourceColumnKeys(
  columns: ColumnMeta[],
  keepType: (type: string) => boolean = isAdhocComparableDataType,
) {
  const keys = columns
    .filter(
      column =>
        isJSDataTypeScalar(convertCHDataTypeToJSType(column.type)) &&
        keepType(column.type),
    )
    .map(column => column.name);
  return toQuotedKeys(keys, columns);
}

/**
 * Suggestions from looked-up values. A key typed by hand can name a whole map
 * or JSON column, whose values are objects rather than suggestions.
 */
export function getValueSuggestions(facets: Facet[] | undefined) {
  return unionSorted(
    (facets ?? []).map(({ value }) =>
      value
        .filter((v: unknown) => v != null && typeof v !== 'object')
        .map(String),
    ),
  );
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
function useAdhocFilterSources(filter: AdhocDashboardFilter) {
  const { data: allSources } = useSources();
  return useMemo(() => {
    const kinds = getAdhocFilterSourceKinds(filter.sourceType);
    return (allSources ?? []).filter(
      source =>
        filter.sources.includes(source.id) && kinds.includes(source.kind),
    );
  }, [allSources, filter.sources, filter.sourceType]);
}

/** Suggestions for one input of the condition editor. */
type AdhocFilterSuggestions = {
  data: string[];
  isLoading: boolean;
  isError: boolean;
};

type AdhocFilterKeys = AdhocFilterSuggestions & {
  keysBySourceId: ReadonlyMap<string, string[]>;
  /** Top-level column names across SQL sources, for quoting keys in SQL. */
  columnNames: Set<string>;
};

function useSqlSourceKeys(
  sources: TSource[],
  dateRange: [Date, Date],
): AdhocFilterKeys {
  const tableConnections = useMemo(() => sources.map(tcFromSource), [sources]);
  const {
    fieldsByTableConnection,
    columnsByTableConnection,
    isFieldMetadataDisabled,
    isLoading,
    isError,
  } = useMultipleAllFields(tableConnections, { dateRange });

  return useMemo(() => {
    const keysBySourceId = new Map<string, string[]>();
    const columnNames = new Set<string>();
    sources.forEach((source, index) => {
      const columns = columnsByTableConnection.get(index);
      if (!columns) return;
      columns.forEach(column => columnNames.add(column.name));
      keysBySourceId.set(
        source.id,
        isFieldMetadataDisabled
          ? getSqlSourceColumnKeys(columns)
          : getSqlSourceKeys(fieldsByTableConnection.get(index) ?? [], columns),
      );
    });
    return {
      data: unionSorted([...keysBySourceId.values()]),
      keysBySourceId,
      columnNames,
      isLoading,
      isError,
    };
  }, [
    sources,
    fieldsByTableConnection,
    columnsByTableConnection,
    isFieldMetadataDisabled,
    isLoading,
    isError,
  ]);
}

const promqlLookupParams = (
  source: TSource,
  { start, end }: { start: number; end: number },
  attribution: QueryAttribution,
) => ({
  sourceId: source.id,
  start,
  end,
  attribution,
});

function usePromqlSourceKeys(
  sources: TSource[],
  dateRange: [Date, Date],
): AdhocFilterKeys {
  const attribution = useMetadataQueryAttribution();
  const seconds = toPromqlSeconds(dateRange);

  const combineKeys = useCallback(
    (results: UseQueryResult<string[]>[]) => {
      const keysBySourceId = new Map<string, string[]>();
      sources.forEach((source, index) => {
        const keys = results[index]?.data;
        if (keys) keysBySourceId.set(source.id, keys);
      });
      return {
        data: unionSorted([...keysBySourceId.values()]),
        keysBySourceId,
        columnNames: NO_COLUMNS,
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
          'adhoc-filter-promql-keys',
          source.id,
          seconds.start,
          seconds.end,
        ],
        queryFn: async () => {
          const labels = await fetchPromqlLabelNames(
            promqlLookupParams(source, seconds, attribution),
          );
          return labels.filter(label => label !== '__name__');
        },
        staleTime: STALE_TIME_MS,
        placeholderData: keepPreviousData,
      }),
    ),
    combine: combineKeys,
  });
}

function useSqlSourceValues(
  sources: TSource[],
  key: string,
  dateRange: [Date, Date],
  columnNames: Set<string>,
): AdhocFilterSuggestions {
  const chartConfigs = useMemo(
    () =>
      sources.map(source => ({
        ...pickSourceConfigFields(source),
        dateRange,
        source: source.id,
        select: '',
        where: '',
        whereLanguage: 'sql' as const,
      })),
    [sources, dateRange],
  );
  // Quoted like the search sidebar does, so a column named e.g.
  // `log-attributes` isn't read as a subtraction.
  const keys = useMemo(
    () => (key ? [toQuotedClickHouseKeyExpression(key, columnNames)] : []),
    [key, columnNames],
  );
  const { data, isFetching, isError } = useMultipleGetKeyValues(
    { chartConfigs, keys, limit: SINGLE_KEY_VALUES_LIMIT },
    // The previous key's values aren't suggestions for this one.
    { placeholderData: undefined, retry: false, enabled: sources.length > 0 },
  );

  const values = useMemo(() => getValueSuggestions(data), [data]);
  return { data: values, isLoading: !!key && isFetching, isError };
}

const combineValues = (
  results: UseQueryResult<string[]>[],
): AdhocFilterSuggestions => ({
  data: unionSorted(results.map(result => result.data)),
  isLoading: results.some(result => result.isFetching),
  isError: results.some(result => result.isError),
});

function usePromqlSourceValues(
  sources: TSource[],
  key: string,
  dateRange: [Date, Date],
): AdhocFilterSuggestions {
  const attribution = useMetadataQueryAttribution();
  const seconds = toPromqlSeconds(dateRange);

  return useQueries({
    queries: sources.map(
      (source): UseQueryOptions<string[]> => ({
        queryKey: [
          'adhoc-filter-promql-values',
          source.id,
          key,
          seconds.start,
          seconds.end,
        ],
        queryFn: () =>
          fetchPromqlLabelValues({
            label: key,
            ...promqlLookupParams(source, seconds, attribution),
          }),
        enabled: !!key,
        staleTime: STALE_TIME_MS,
        retry: false,
      }),
    ),
    combine: combineValues,
  });
}

/**
 * Suggestions for an ad hoc filter's condition editor, deduplicated across its
 * sources. Keys are the columns and map / JSON keys of its SQL sources, in the
 * search sidebar's key format, or the label names of its PromQL sources.
 * Values are those observed for `key`.
 */
export function useAdhocFilterOptions(
  filter: AdhocDashboardFilter,
  key: string,
  dateRange: [Date, Date],
): { keys: AdhocFilterSuggestions; values: AdhocFilterSuggestions } {
  const sources = useAdhocFilterSources(filter);
  const isPromql = filter.sourceType === 'promql';
  const sqlKeys = useSqlSourceKeys(isPromql ? NO_SOURCES : sources, dateRange);
  const promqlKeys = usePromqlSourceKeys(
    isPromql ? sources : NO_SOURCES,
    dateRange,
  );
  const keys = isPromql ? promqlKeys : sqlKeys;

  // Until keys load, every source would be queried, then the sources known to
  // have `key` queried again.
  const lookupKey = keys.isLoading ? '' : key;
  const sourcesWithKey = useMemo(
    () => getSourcesWithKey(sources, keys.keysBySourceId, lookupKey),
    [sources, keys.keysBySourceId, lookupKey],
  );
  const sqlValues = useSqlSourceValues(
    isPromql ? NO_SOURCES : sourcesWithKey,
    lookupKey,
    dateRange,
    keys.columnNames,
  );
  const promqlValues = usePromqlSourceValues(
    isPromql ? sourcesWithKey : NO_SOURCES,
    lookupKey,
    dateRange,
  );
  const values = isPromql ? promqlValues : sqlValues;
  return {
    keys,
    values: key && keys.isLoading ? { ...values, isLoading: true } : values,
  };
}
