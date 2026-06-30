import { useMemo } from 'react';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import api from '@/api';
import {
  DEFAULT_FILTER_KEYS_FETCH_LIMIT,
  DEFAULT_FILTER_KEYS_FETCH_LIMIT_WITH_MVS,
} from '@/defaults';
import {
  useAllFields,
  useAllFieldsAndValues,
  useColumns,
  useGetKeyValues,
  useJsonColumns,
  useMapColumns,
} from '@/hooks/useMetadata';
import { usePinnedFilters } from '@/searchFilters';
import { useSource } from '@/source';
import { mergePath } from '@/utils';

import { toQuotedClickHouseKeyExpression } from './utils';

const INITIAL_LOAD_LIMIT = 20;

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
  // Conditionally backtick-quote facet keys that contain special characters and
  // match known column names, so they can be used in the ClickHouse query to get
  // key values.
  const knownColumns = useMemo(
    () => (columns ? new Set(columns.map(c => c.name)) : new Set<string>()),
    [columns],
  );
  const { data: jsonColumns } = useJsonColumns(tableConnection);
  const { data: mapColumns } = useMapColumns(tableConnection);

  const { data: allFields } = useAllFields(tableConnection, {
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
  const exactFacets = useMemo(
    () =>
      rawExactFacets?.map(f => ({
        ...f,
        key: sqlKeyToUiKey.get(f.key) ?? f.key,
      })),
    [rawExactFacets, sqlKeyToUiKey],
  );

  return { data: exactFacets, ...rest };
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

  return useAllFieldsAndValues(
    {
      ...tableConnection,
      dateRange,
      maxKeys,
    },
    { enabled },
  );
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

  const mvFilterRes = useAllFacetsFromMVs({
    sourceId,
    dateRange,
    enabled: !useRawTablePipeline,
  });

  // Exact pipeline: fetch values for discovered keys
  const rawFilterRes = useFacetsFromRawTables({
    chartConfig,
    sourceId,
    mode,
    dateRange,
    filterState,
    showMoreFields,
    enabled: useRawTablePipeline,
  });

  return useRawTablePipeline ? rawFilterRes : mvFilterRes;
}
