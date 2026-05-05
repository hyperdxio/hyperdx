import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import router from 'next/router';
import { parseAsInteger, useQueryState } from 'nuqs';
import { UseFormHandleSubmit } from 'react-hook-form';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  aliasMapToWithClauses,
  isBrowser,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isTraceSource,
  SavedSearchListApiResponse,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useDocumentVisibility } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useIsFetching } from '@tanstack/react-query';

import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import {
  getRelativeTimeOptionLabel,
  LIVE_TAIL_DURATION_MS,
} from '@/components/TimePicker/utils';
import { IS_LOCAL_MODE } from '@/config';
import { LOCAL_STORE_CONNECTIONS_KEY } from '@/connection';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { useTableMetadata } from '@/hooks/useMetadata';
import { Suggestion, useSqlSuggestions } from '@/hooks/useSqlSuggestions';
import { useDeleteSavedSearch, useUpdateSavedSearch } from '@/savedSearch';
import { useSource } from '@/source';
import { parseRelativeTimeQuery } from '@/timeQuery';
import { SearchConfig } from '@/types';
import { usePrevious } from '@/utils';
import {
  buildDirectTraceWhereClause,
  getDefaultDirectTraceDateRange,
} from '@/utils/directTrace';
import { parseAsStringEncoded } from '@/utils/queryParsers';

import {
  buildChartConfigFromSearchedConfig,
  buildHistogramTimeChartConfig,
  DEFAULT_REFRESH_FREQUENCY,
  optimizeDefaultOrderBy,
  SearchConfigFromSchema,
} from './utils';

type UseLiveUpdateArgs = {
  isLive: boolean;
  interval: number; // ms ago to refresh from
  refreshFrequency: number; // ms, how often to refresh
  onTimeRangeSelect: (
    start: Date,
    end: Date,
    displayedTimeInputValue?: string | null,
  ) => void;
  pause: boolean;
};

function useLiveUpdate({
  isLive,
  interval,
  refreshFrequency,
  onTimeRangeSelect,
  pause,
}: UseLiveUpdateArgs) {
  const documentState = useDocumentVisibility();
  const isDocumentVisible = documentState === 'visible';
  const [refreshOnVisible, setRefreshOnVisible] = useState(false);

  const refresh = useCallback(() => {
    // eslint-disable-next-line no-restricted-syntax
    onTimeRangeSelect(new Date(Date.now() - interval), new Date(), null);
  }, [onTimeRangeSelect, interval]);

  // When the user comes back to the app after switching tabs, we immediately refresh the list.
  useEffect(() => {
    if (refreshOnVisible && isDocumentVisible) {
      if (!pause) {
        refresh();
      }
      setRefreshOnVisible(false);
    }
  }, [refreshOnVisible, isDocumentVisible, pause, refresh]);

  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (isLive) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }

      // only start interval if no queries are fetching
      if (!pause) {
        intervalRef.current = window.setInterval(() => {
          if (isDocumentVisible) {
            refresh();
          } else {
            setRefreshOnVisible(true);
          }
        }, refreshFrequency);
      }
    } else {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [
    isLive,
    isDocumentVisible,
    onTimeRangeSelect,
    pause,
    refresh,
    refreshFrequency,
  ]);
}

/**
 * Takes in a input search config (user edited search config) and a default search config
 * (saved search or source default config) and returns a chart config.
 */
export function useSearchedConfigToChartConfig(
  { select, source, whereLanguage, where, filters, orderBy }: SearchConfig,
  defaultSearchConfig?: Partial<SearchConfig>,
): { data: SearchChartConfig | null; isLoading?: boolean } {
  const { data: sourceObj, isLoading } = useSource({
    id: source,
    kinds: [SourceKind.Log, SourceKind.Trace],
  });
  const defaultOrderBy = useDefaultOrderBy(source);

  return useMemo(() => {
    if (sourceObj != null) {
      const chartConfig = buildChartConfigFromSearchedConfig(
        sourceObj,
        { select, source, whereLanguage, where, filters, orderBy },
        defaultSearchConfig,
        defaultOrderBy,
      );
      return { data: chartConfig };
    }
    return { data: null, isLoading };
  }, [
    sourceObj,
    isLoading,
    select,
    source,
    filters,
    defaultSearchConfig,
    where,
    whereLanguage,
    defaultOrderBy,
    orderBy,
  ]);
}

export function useDefaultOrderBy(sourceID: string | undefined | null) {
  const { data: source } = useSource({
    id: sourceID,
    kinds: [SourceKind.Log, SourceKind.Trace],
  });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  // When source changes, make sure select and orderby fields are set to default
  return useMemo(() => {
    // If no source, return undefined so that the orderBy is not set incorrectly
    if (!source) return undefined;
    const trimmedOrderBy = source.orderByExpression?.trim();
    if (trimmedOrderBy) return trimmedOrderBy;
    return optimizeDefaultOrderBy(
      source?.timestampValueExpression ?? '',
      source.displayedTimestampValueExpression,
      tableMetadata?.sorting_key,
    );
  }, [source, tableMetadata]);
}

type SetSearchedConfig = (patch: SearchConfig) => void;

type UseDirectTraceControllerArgs = {
  searchedSource: TSource | undefined;
  searchedConfigSource: string | null | undefined;
  sources: TSource[] | undefined;
  searchedTimeRange: [Date, Date];
  isReady: boolean;
  setIsLive: (v: boolean) => void;
  setSearchedConfig: SetSearchedConfig;
  onTimeRangeSelect: (
    start: Date,
    end: Date,
    displayedTimeInputValue?: string | null,
  ) => void;
};

/**
 * Encapsulates the direct-trace mode (`?traceId=...`) flow:
 * - tracks the trace id query param
 * - applies a default 14-day date range when none is in the URL
 * - sets the WHERE clause once a valid trace source is selected
 * - exposes callbacks for the side panel to change source / close
 */
export function useDirectTraceController({
  searchedSource,
  searchedConfigSource,
  sources,
  searchedTimeRange,
  isReady,
  setIsLive,
  setSearchedConfig,
  onTimeRangeSelect,
}: UseDirectTraceControllerArgs) {
  const [directTraceId, setDirectTraceId] = useQueryState(
    'traceId',
    parseAsStringEncoded,
  );

  const directTraceSource =
    directTraceId != null && searchedSource?.kind === SourceKind.Trace
      ? searchedSource
      : undefined;

  // When direct-trace mode is active but the URL source isn't a trace source,
  // we surface an empty source id so the chart-config layer skips loading.
  const chartSourceId =
    directTraceId != null && !directTraceSource
      ? ''
      : (searchedConfigSource ?? '');

  const directTraceRangeAppliedRef = useRef<string | null>(null);
  const directTraceFilterAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady || !directTraceId) {
      directTraceRangeAppliedRef.current = null;
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('from') && searchParams.has('to')) {
      return;
    }

    if (directTraceRangeAppliedRef.current === directTraceId) {
      return;
    }

    directTraceRangeAppliedRef.current = directTraceId;
    setIsLive(false);
    const [start, end] = getDefaultDirectTraceDateRange();
    onTimeRangeSelect(start, end, null);
  }, [directTraceId, isReady, onTimeRangeSelect, setIsLive]);

  useEffect(() => {
    if (!directTraceId || !directTraceSource) {
      directTraceFilterAppliedRef.current = null;
      return;
    }

    const nextKey = `${directTraceSource.id}:${directTraceId}`;
    if (directTraceFilterAppliedRef.current === nextKey) {
      return;
    }

    directTraceFilterAppliedRef.current = nextKey;
    setIsLive(false);
    setSearchedConfig({
      source: directTraceSource.id,
      where: buildDirectTraceWhereClause(
        directTraceSource.traceIdExpression,
        directTraceId,
      ),
      whereLanguage: 'sql',
      filters: [],
    });
  }, [directTraceId, directTraceSource, setIsLive, setSearchedConfig]);

  const directTraceFocusDate = useMemo(
    () =>
      new Date(
        (searchedTimeRange[0].getTime() + searchedTimeRange[1].getTime()) / 2,
      ),
    [searchedTimeRange],
  );

  const onDirectTraceSourceChange = useCallback(
    (sourceId: string | null) => {
      setIsLive(false);
      if (sourceId == null) {
        directTraceFilterAppliedRef.current = null;
        setSearchedConfig({
          source: null,
          where: '',
          whereLanguage: getStoredLanguage() ?? 'lucene',
          filters: [],
        });
        return;
      }

      const nextSource = sources?.find(
        (source): source is Extract<TSource, { kind: SourceKind.Trace }> =>
          source.id === sourceId && isTraceSource(source),
      );
      if (!nextSource || !directTraceId) {
        return;
      }

      setSearchedConfig({
        source: nextSource.id,
        where: buildDirectTraceWhereClause(
          nextSource.traceIdExpression,
          directTraceId,
        ),
        whereLanguage: 'sql',
        filters: [],
      });
    },
    [directTraceId, setIsLive, setSearchedConfig, sources],
  );

  const closeDirectTraceSidePanel = useCallback(() => {
    setDirectTraceId(null);
  }, [setDirectTraceId]);

  return {
    directTraceId,
    setDirectTraceId,
    directTraceSource,
    chartSourceId,
    directTraceFocusDate,
    onDirectTraceSourceChange,
    closeDirectTraceSidePanel,
  };
}

type UseSavedSearchActionsArgs = {
  savedSearch: SavedSearchListApiResponse | undefined;
  searchedConfig: SearchConfig;
  handleSubmit: UseFormHandleSubmit<SearchConfigFromSchema>;
  onSubmit: () => void;
  contactSupportNode: ReactNode;
};

/**
 * Owns saved-search mutations and modal state for the page header / top bar:
 * create, update, delete, rename, tag editing, and the "save as new" flow.
 */
export function useSavedSearchActions({
  savedSearch,
  searchedConfig,
  handleSubmit,
  onSubmit,
  contactSupportNode,
}: UseSavedSearchActionsArgs) {
  const updateSavedSearch = useUpdateSavedSearch();
  const deleteSavedSearch = useDeleteSavedSearch();
  const [saveSearchModalState, setSaveSearchModalState] = useState<
    'create' | 'update' | undefined
  >(undefined);

  const onSaveSearch = useCallback(() => {
    if (savedSearch == null) {
      setSaveSearchModalState('create');
    } else {
      handleSubmit(s => {
        updateSavedSearch.mutate(
          {
            id: savedSearch.id,
            ...s,
          },
          {
            onSuccess: () => {
              // Make sure to run the query
              onSubmit();
            },
          },
        );
      })();
    }
  }, [savedSearch, updateSavedSearch, onSubmit, handleSubmit]);

  const handleUpdateTags = useCallback(
    (newTags: string[]) => {
      if (savedSearch?.id) {
        updateSavedSearch.mutate(
          {
            id: savedSearch.id,
            name: savedSearch.name,
            select: searchedConfig.select ?? '',
            where: searchedConfig.where ?? '',
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
            tags: newTags,
          },
          {
            onSuccess: () => {
              notifications.show({
                color: 'green',
                message: 'Tags updated successfully',
              });
            },
            onError: () => {
              notifications.show({
                color: 'red',
                message: <>An error occurred. {contactSupportNode}</>,
              });
            },
          },
        );
      }
    },
    [savedSearch, searchedConfig, updateSavedSearch, contactSupportNode],
  );

  const handleRenameSavedSearch = useCallback(
    (editedName: string) => {
      if (savedSearch?.id) {
        updateSavedSearch.mutate({
          id: savedSearch.id,
          name: editedName,
        });
      }
    },
    [savedSearch, updateSavedSearch],
  );

  const handleDeleteSavedSearch = useCallback(() => {
    if (savedSearch?.id) {
      deleteSavedSearch.mutate(savedSearch.id, {
        onSuccess: () => {
          router.push('/search/list');
        },
      });
    }
  }, [savedSearch, deleteSavedSearch]);

  const handleSaveAsNew = useCallback(() => {
    setSaveSearchModalState('create');
  }, []);

  const onUpdateSearchClick = useCallback(() => {
    setSaveSearchModalState('update');
  }, []);

  const clearSaveSearchModalState = useCallback(
    () => setSaveSearchModalState(undefined),
    [],
  );

  return {
    saveSearchModalState,
    clearSaveSearchModalState,
    onSaveSearch,
    handleUpdateTags,
    handleRenameSavedSearch,
    handleDeleteSavedSearch,
    handleSaveAsNew,
    onUpdateSearchClick,
  };
}

type UseLiveTailControlsArgs = {
  isLive: boolean;
  setIsLive: (v: boolean) => void;
  isReady: boolean;
  queryReady: boolean;
  searchedConfigSource: string | null | undefined;
  setDisplayedTimeInputValue: (v: string) => void;
  onSearch: (range: string) => void;
  onTimeRangeSelect: (
    start: Date,
    end: Date,
    displayedTimeInputValue?: string | null,
  ) => void;
};

/**
 * Owns live-tail/time-picker state and the callbacks that gate it:
 * - the live-tail interval + refresh-frequency query params
 * - shows/hides the "resume live tail" hint
 * - kicks the user out of live tail on table scroll / row expand / sidebar open
 * - drives collapse-all-rows when resuming live tail
 * - bridges the `<TimePicker>` to the URL time-range
 */
export function useLiveTailControls({
  isLive,
  setIsLive,
  isReady,
  queryReady,
  searchedConfigSource,
  setDisplayedTimeInputValue,
  onSearch,
  onTimeRangeSelect,
}: UseLiveTailControlsArgs) {
  const isAnyQueryFetching = useIsFetching({ queryKey: ['search'] }) > 0;
  const isTabVisible = useDocumentVisibility();

  const [collapseAllRows, setCollapseAllRows] = useState(false);

  const [interval, setInterval] = useQueryState(
    'liveInterval',
    parseAsInteger.withDefault(LIVE_TAIL_DURATION_MS),
  );

  const [refreshFrequency, setRefreshFrequency] = useQueryState(
    'refreshFrequency',
    parseAsInteger.withDefault(DEFAULT_REFRESH_FREQUENCY),
  );

  const updateRelativeTimeInputValue = useCallback(
    (intervalMs: number) => {
      const label = getRelativeTimeOptionLabel(intervalMs);
      if (label) {
        setDisplayedTimeInputValue(label);
      }
    },
    [setDisplayedTimeInputValue],
  );

  useEffect(() => {
    if (isReady && isLive) {
      updateRelativeTimeInputValue(interval);
    }
    // Only on initial mount + when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRelativeTimeInputValue, searchedConfigSource, isReady]);

  useLiveUpdate({
    isLive,
    interval,
    refreshFrequency,
    onTimeRangeSelect,
    pause: isAnyQueryFetching || !queryReady || !isTabVisible,
  });

  // Defer initial render of the hint to the client to avoid SSR hydration drift.
  const [shouldShowLiveModeHint, setShouldShowLiveModeHint] = useState(false);
  useEffect(() => {
    setShouldShowLiveModeHint(isLive === false);
  }, [isLive]);

  const onExpandedRowsChange = useCallback(
    (hasExpandedRows: boolean) => {
      if (hasExpandedRows && isLive) {
        setIsLive(false);
      }
    },
    [isLive, setIsLive],
  );

  const handleResumeLiveTail = useCallback(() => {
    setIsLive(true);
    updateRelativeTimeInputValue(interval);
    setCollapseAllRows(true);
    setTimeout(() => setCollapseAllRows(false), 100);
  }, [interval, updateRelativeTimeInputValue, setIsLive]);

  const onTableScroll = useCallback(
    (scrollTop: number) => {
      if (scrollTop > 16 && isLive) {
        setIsLive(false);
      }
    },
    [isLive, setIsLive],
  );

  const onSidebarOpen = useCallback(() => {
    setIsLive(false);
  }, [setIsLive]);

  const onTimePickerSearch = useCallback(
    (range: string) => {
      setIsLive(false);
      onSearch(range);
    },
    [setIsLive, onSearch],
  );

  const onTimePickerRelativeSearch = useCallback(
    (rangeMs: number) => {
      const range = parseRelativeTimeQuery(rangeMs);
      setIsLive(true);
      setInterval(rangeMs);
      onTimeRangeSelect(range[0], range[1], null);
    },
    [setIsLive, setInterval, onTimeRangeSelect],
  );

  const handleTimeRangeSelect = useCallback(
    (d1: Date, d2: Date) => {
      onTimeRangeSelect(d1, d2);
      setIsLive(false);
    },
    [onTimeRangeSelect, setIsLive],
  );

  return {
    interval,
    refreshFrequency,
    setRefreshFrequency,
    shouldShowLiveModeHint,
    collapseAllRows,
    onExpandedRowsChange,
    handleResumeLiveTail,
    onTableScroll,
    onSidebarOpen,
    onTimePickerSearch,
    onTimePickerRelativeSearch,
    handleTimeRangeSelect,
  };
}

type UseChartConfigsArgs = {
  searchedConfig: SearchConfig;
  chartSourceId: string;
  defaultSearchConfig: Partial<SearchConfig>;
  searchedSource: TSource | undefined;
  isLive: boolean;
  searchedTimeRange: [Date, Date];
};

/**
 * Builds the family of chart configs the search page needs:
 * - the main `chartConfig` (search rows)
 * - `dbSqlRowTableConfig` (search + dateRange)
 * - `histogramTimeChartConfig` (count chart in stats bar)
 * - `filtersChartConfig` (config used by the filter sidebar)
 *
 * Plus the `queryReady` boolean derived from the source's table identity.
 */
export function useChartConfigs({
  searchedConfig,
  chartSourceId,
  defaultSearchConfig,
  searchedSource,
  isLive,
  searchedTimeRange,
}: UseChartConfigsArgs) {
  const chartSearchConfig = useMemo(
    () => ({
      select: searchedConfig.select ?? '',
      source: chartSourceId,
      where: searchedConfig.where ?? '',
      whereLanguage:
        searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
      filters: searchedConfig.filters ?? [],
      orderBy: searchedConfig.orderBy ?? '',
    }),
    [
      chartSourceId,
      searchedConfig.filters,
      searchedConfig.orderBy,
      searchedConfig.select,
      searchedConfig.where,
      searchedConfig.whereLanguage,
    ],
  );

  const { data: chartConfig, isLoading: isChartConfigLoading } =
    useSearchedConfigToChartConfig(chartSearchConfig, defaultSearchConfig);

  const queryReady = !!(
    chartConfig?.from?.databaseName &&
    chartConfig?.from?.tableName &&
    chartConfig?.timestampValueExpression
  );

  const dbSqlRowTableConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }
    return {
      ...chartConfig,
      dateRange: searchedTimeRange,
    };
  }, [chartConfig, searchedTimeRange]);

  const { data: aliasMap } = useAliasMapFromChartConfig(dbSqlRowTableConfig);
  const aliasWith = useMemo(() => aliasMapToWithClauses(aliasMap), [aliasMap]);

  const histogramTimeChartConfig = useMemo(() => {
    if (chartConfig == null) return undefined;
    return buildHistogramTimeChartConfig({
      chartConfig,
      source: searchedSource,
      aliasWith,
      searchedTimeRange,
      isLive,
      eventTableSelect: searchedConfig.select ?? undefined,
    });
  }, [
    chartConfig,
    searchedSource,
    aliasWith,
    searchedTimeRange,
    searchedConfig.select,
    isLive,
  ]);

  const filtersChartConfig = useMemo(() => {
    const overrides = {
      orderBy: undefined,
      dateRange: searchedTimeRange,
      with: aliasWith,
    } as const;
    return chartConfig
      ? { ...chartConfig, ...overrides }
      : {
          timestampValueExpression: '',
          connection: '',
          from: { databaseName: '', tableName: '' },
          where: '',
          select: '',
          ...overrides,
        };
  }, [chartConfig, searchedTimeRange, aliasWith]);

  return {
    chartConfig,
    isChartConfigLoading,
    queryReady,
    dbSqlRowTableConfig,
    aliasWith,
    histogramTimeChartConfig,
    filtersChartConfig,
  };
}

type UseFormUrlSyncArgs = {
  searchedConfig: SearchConfig;
  setSearchedConfig: (patch: SearchConfig) => void;
  savedSearch: SavedSearchListApiResponse | undefined;
  savedSearchId: string | null;
  defaultSourceId: string;
  directTraceId: string | null;
  reset: (values: SearchConfigFromSchema) => void;
};

/**
 * Keeps the react-hook-form values in sync with the URL search params, and
 * populates the URL when landing on a saved-search route or a fresh search.
 */
export function useFormUrlSync({
  searchedConfig,
  setSearchedConfig,
  savedSearch,
  savedSearchId,
  defaultSourceId,
  directTraceId,
  reset,
}: UseFormUrlSyncArgs) {
  // Sync URL state back to form state (e.g. for history navigation).
  // TODO: check edge cases.
  const prevSearched = usePrevious(searchedConfig);
  useEffect(() => {
    if (JSON.stringify(prevSearched) !== JSON.stringify(searchedConfig)) {
      reset({
        select: searchedConfig?.select ?? '',
        where: searchedConfig?.where ?? '',
        whereLanguage:
          searchedConfig?.whereLanguage ?? getStoredLanguage() ?? 'lucene',
        source: searchedConfig?.source ?? '',
        filters: searchedConfig?.filters ?? [],
        orderBy: searchedConfig?.orderBy ?? '',
      });
    }
  }, [searchedConfig, reset, prevSearched]);

  // Populate the searched query when the URL is wiped (e.g. clicking the same
  // saved search again, or arriving on a fresh search route).
  useEffect(() => {
    const { source, where, select, whereLanguage, filters } = searchedConfig;
    const isSearchConfigEmpty =
      !source && !where && !select && !whereLanguage && !filters?.length;

    if (
      savedSearch != null &&
      savedSearch.id === savedSearchId &&
      isSearchConfigEmpty
    ) {
      setSearchedConfig({
        source: savedSearch.source,
        where: savedSearch.where,
        select: savedSearch.select,
        whereLanguage: savedSearch.whereLanguage as 'sql' | 'lucene',
        filters: savedSearch.filters ?? [],
        orderBy: savedSearch.orderBy ?? '',
      });
      return;
    }

    if (savedSearchId == null && directTraceId != null && !source) {
      return;
    }

    if (savedSearchId == null && defaultSourceId && isSearchConfigEmpty) {
      setSearchedConfig({
        source: defaultSourceId,
        where: '',
        select: '',
        whereLanguage: getStoredLanguage() ?? 'lucene',
        filters: [],
        orderBy: '',
      });
    }
  }, [
    savedSearch,
    searchedConfig,
    setSearchedConfig,
    savedSearchId,
    defaultSourceId,
    directTraceId,
  ]);
}

type UseSourceChangeResetArgs = {
  watchedSource: string | undefined;
  inputSourceObjs: TSource[] | undefined;
  savedSearch: SavedSearchListApiResponse | undefined;
  savedSearchId: string | null;
  setValue: (name: 'select' | 'orderBy', value: string) => void;
  setLastSelectedSourceId: (id: string) => void;
  clearAllFilters: () => void;
};

/**
 * When the user changes the source dropdown:
 * - resets SELECT/ORDER BY/filters (or restores them from the saved search)
 * - persists the chosen source id to localStorage
 */
export function useSourceChangeReset({
  watchedSource,
  inputSourceObjs,
  savedSearch,
  savedSearchId,
  setValue,
  setLastSelectedSourceId,
  clearAllFilters,
}: UseSourceChangeResetArgs) {
  const prevSourceRef = useRef(watchedSource);

  useEffect(() => {
    if (watchedSource !== prevSourceRef.current) {
      prevSourceRef.current = watchedSource;
      const newInputSourceObj = inputSourceObjs?.find(
        s => s.id === watchedSource,
      );
      if (newInputSourceObj != null) {
        setLastSelectedSourceId(newInputSourceObj.id);

        if (savedSearchId == null || savedSearch?.source !== watchedSource) {
          setValue('select', '');
          setValue('orderBy', '');
          clearAllFilters();
        } else {
          setValue('select', savedSearch?.select ?? '');
          setValue('orderBy', savedSearch?.orderBy ?? '');
        }
      }
    }
  }, [
    watchedSource,
    setValue,
    savedSearch,
    savedSearchId,
    inputSourceObjs,
    clearAllFilters,
    setLastSelectedSourceId,
  ]);
}

type UseQueryErrorsArgs = {
  inputWhere: string;
  inputWhereLanguage: 'sql' | 'lucene';
  setIsLive: (v: boolean) => void;
};

/**
 * Owns query-error state for the search page:
 * - records errors keyed by source component (e.g. DBSqlRowTable)
 * - clears errors when the local connection store is updated (local mode)
 * - exposes the first error + WHERE-clause SQL suggestions when relevant
 */
export function useQueryErrors({
  inputWhere,
  inputWhereLanguage,
  setIsLive,
}: UseQueryErrorsArgs) {
  const [queryErrors, setQueryErrors] = useState<{
    [key: string]: Error | ClickHouseQueryError;
  }>({});

  useEffect(() => {
    if (!isBrowser || !IS_LOCAL_MODE) return;
    const nullQueryErrors = (event: StorageEvent) => {
      if (event.key === LOCAL_STORE_CONNECTIONS_KEY) {
        setQueryErrors({});
      }
    };

    window.addEventListener('storage', nullQueryErrors);
    return () => {
      window.removeEventListener('storage', nullQueryErrors);
    };
  }, []);

  const { hasQueryError, queryError } = useMemo(() => {
    const values = Object.values(queryErrors);
    return {
      hasQueryError: values.length > 0,
      queryError: (values[0] ?? null) as Error | ClickHouseQueryError | null,
    };
  }, [queryErrors]);

  const whereSuggestions: Suggestion[] | null = useSqlSuggestions({
    input: inputWhere,
    enabled: hasQueryError && inputWhereLanguage === 'sql',
  });

  const handleTableError = useCallback(
    (error: Error | ClickHouseQueryError) => {
      setIsLive(false);
      setQueryErrors(prev => ({ ...prev, DBSqlRowTable: error }));
    },
    [setIsLive],
  );

  const clearQueryErrors = useCallback(() => setQueryErrors({}), []);

  return {
    hasQueryError,
    queryError,
    whereSuggestions,
    handleTableError,
    clearQueryErrors,
  };
}
