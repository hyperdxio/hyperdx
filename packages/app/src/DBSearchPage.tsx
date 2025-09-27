import {
  FormEvent,
  FormEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import router from 'next/router';
import {
  parseAsBoolean,
  parseAsJson,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import {
  isBrowser,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/utils';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Center,
  Code,
  Flex,
  Grid,
  Group,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import {
  useDebouncedCallback,
  useDisclosure,
  useDocumentVisibility,
} from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useIsFetching } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';

import { ContactSupportText } from '@/components/ContactSupportText';
import DBDeltaChart from '@/components/DBDeltaChart';
import DBHeatmapChart from '@/components/DBHeatmapChart';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { DBTimeChart } from '@/components/DBTimeChart';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import SearchTotalCountChart from '@/components/SearchTotalCountChart';
import { TableSourceForm } from '@/components/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { Tags } from '@/components/Tags';
import { TimePicker } from '@/components/TimePicker';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { IS_LOCAL_MODE } from '@/config';
import {
  useAliasMapFromChartConfig,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { withAppNav } from '@/layout';
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import SearchInputV2 from '@/SearchInputV2';
import {
  getDurationMsExpression,
  getFirstTimestampValueExpression,
  useSource,
  useSources,
} from '@/source';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { QUERY_LOCAL_STORAGE, useLocalStorage, usePrevious } from '@/utils';

import { SQLPreview } from './components/ChartSQLPreview';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import PatternTable from './components/PatternTable';
import SourceSchemaPreview from './components/SourceSchemaPreview';
import { useTableMetadata } from './hooks/useMetadata';
import { useSqlSuggestions } from './hooks/useSqlSuggestions';
import api from './api';
import { LOCAL_STORE_CONNECTIONS_KEY } from './connection';
import { DBSearchPageAlertModal } from './DBSearchPageAlertModal';
import { SearchConfig } from './types';

import searchPageStyles from '../styles/SearchPage.module.scss';

const SearchConfigSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']),
  orderBy: z.string(),
  filters: z.array(
    z.union([
      z.object({
        type: z.literal('sql_ast'),
        operator: z.enum(['=', '<', '>', '>=', '<=', '!=']),
        left: z.string(),
        right: z.string(),
      }),
      z.object({
        type: z.enum(['sql', 'lucene']),
        condition: z.string(),
      }),
    ]),
  ),
});

type SearchConfigFromSchema = z.infer<typeof SearchConfigSchema>;

// Helper function to get the default source id
export function getDefaultSourceId(
  sources: { id: string }[] | undefined,
  lastSelectedSourceId: string | undefined,
): string {
  if (!sources || sources.length === 0) return '';
  if (
    lastSelectedSourceId &&
    sources.some(s => s.id === lastSelectedSourceId)
  ) {
    return lastSelectedSourceId;
  }
  return sources[0].id;
}

function SearchNumRows({
  config,
  enabled,
}: {
  config: ChartConfigWithDateRange;
  enabled: boolean;
}) {
  const { data, isLoading, error } = useExplainQuery(config, {
    enabled,
  });

  if (!enabled) {
    return null;
  }

  const numRows = data?.[0]?.rows;
  return (
    <Text size="xs" c="gray.4" mb={4}>
      {isLoading
        ? 'Scanned Rows ...'
        : error || !numRows
          ? ''
          : `Scanned Rows: ${numRows}`}
    </Text>
  );
}

function SaveSearchModal({
  searchedConfig,
  opened,
  onClose,
  isUpdate,
  savedSearchId,
}: {
  searchedConfig: SearchConfig;
  opened: boolean;
  onClose: () => void;
  isUpdate: boolean;
  savedSearchId: string | undefined | null;
}) {
  const { data: savedSearch } = useSavedSearch(
    { id: savedSearchId ?? '' },
    {
      enabled: savedSearchId != null,
    },
  );

  const {
    control,
    handleSubmit,
    formState,
    reset: resetForm,
  } = useForm({
    ...(isUpdate
      ? {
          values: {
            name: savedSearch?.name ?? '',
          },
        }
      : {}),
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
    },
  });

  const closeAndReset = () => {
    resetForm();
    onClose();
  };

  const isValidName = (name?: string): boolean =>
    Boolean(name && name.trim().length > 0);
  const [tags, setTags] = useState<string[]>(savedSearch?.tags || []);

  // Update tags when savedSearch changes
  useEffect(() => {
    if (savedSearch?.tags) {
      setTags(savedSearch.tags);
    }
  }, [savedSearch]);
  const createSavedSearch = useCreateSavedSearch();
  const updateSavedSearch = useUpdateSavedSearch();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    handleSubmit(({ name }) => {
      if (isUpdate) {
        if (savedSearchId == null) {
          throw new Error('savedSearchId is required for update');
        }

        updateSavedSearch.mutate(
          {
            id: savedSearchId,
            name,
            select: searchedConfig.select ?? '',
            where: searchedConfig.where ?? '',
            whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            tags: tags,
          },
          {
            onSuccess: () => {
              onClose();
            },
          },
        );
      } else {
        createSavedSearch.mutate(
          {
            name,
            select: searchedConfig.select ?? '',
            where: searchedConfig.where ?? '',
            whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            tags: tags,
          },
          {
            onSuccess: savedSearch => {
              router.push(`/search/${savedSearch.id}${window.location.search}`);
              onClose();
            },
          },
        );
      }
    })();
  };

  const { data: chartConfig } = useSearchedConfigToChartConfig(searchedConfig);

  return (
    <Modal
      data-testid="save-search-modal"
      opened={opened}
      onClose={closeAndReset}
      title="Save Search"
      centered
      size="lg"
    >
      <form data-testid="save-search-form" onSubmit={onSubmit}>
        <Stack>
          {chartConfig != null ? (
            <Card withBorder>
              <Text c="gray.4" size="xs" mb="xs">
                SELECT
              </Text>
              <Text
                mb="sm"
                size="xs"
                c="gray.2"
              >{`${chartConfig.select}`}</Text>
              <Text c="gray.4" size="xs" mb="xs">
                FROM
              </Text>
              <Text mb="sm" size="xs" c="gray.2">
                {chartConfig?.from.databaseName}.{chartConfig?.from.tableName}
              </Text>
              <Text c="gray.4" size="xs" mb="xs">
                WHERE
              </Text>
              {chartConfig.where ? (
                <Text size="xs" c="gray.2">
                  {chartConfig.where}
                </Text>
              ) : (
                <Text size="xxs" c="gray.4" fs="italic">
                  None
                </Text>
              )}
              <Text c="gray.4" size="xs" mb="xs" mt="sm">
                ORDER BY
              </Text>
              <Text size="xs" c="gray.2">
                {chartConfig.orderBy}
              </Text>
            </Card>
          ) : (
            <Text c="gray.4">Loading Chart Config...</Text>
          )}
          <Box>
            <Text c="gray.4" size="xs" mb="xs">
              Name
            </Text>
            <InputControlled
              data-testid="save-search-name-input"
              control={control}
              name="name"
              rules={{ required: true, validate: isValidName }}
            />
          </Box>
          <Box mb="sm">
            <Text c="gray.4" size="xs" mb="xs">
              Tags
            </Text>
            <Group gap="xs" align="center" mb="xs">
              {tags.map(tag => (
                <Button
                  key={tag}
                  variant="light"
                  color="gray"
                  size="xs"
                  rightSection={
                    <ActionIcon
                      variant="transparent"
                      color="gray"
                      onClick={e => {
                        e.stopPropagation();
                        setTags(tags.filter(t => t !== tag));
                      }}
                      size="xs"
                    >
                      <i className="bi bi-x" />
                    </ActionIcon>
                  }
                >
                  {tag.toUpperCase()}
                </Button>
              ))}
              <Tags allowCreate values={tags} onChange={setTags}>
                <Button
                  data-testid="add-tag-button"
                  variant="outline"
                  color="gray"
                  size="xs"
                >
                  <i className="bi bi-plus me-1"></i>
                  Add Tag
                </Button>
              </Tags>
            </Group>
          </Box>
          <Button
            data-testid="save-search-submit-button"
            variant="outline"
            color="green"
            type="submit"
            disabled={!formState.isValid}
          >
            {isUpdate ? 'Update' : 'Save'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 15m', false) as [Date, Date];

function useLiveUpdate({
  isLive,
  interval, // ms ago to refresh from
  refreshFrequency, // ms, how often to refresh
  onTimeRangeSelect,
  pause,
}: {
  isLive: boolean;
  interval: number;
  refreshFrequency: number;
  onTimeRangeSelect: (
    start: Date,
    end: Date,
    displayedTimeInputValue?: string | undefined,
  ) => void;
  pause: boolean;
}) {
  const documentState = useDocumentVisibility();
  const isDocumentVisible = documentState === 'visible';
  const [refreshOnVisible, setRefreshOnVisible] = useState(false);

  const refresh = useCallback(() => {
    onTimeRangeSelect(new Date(Date.now() - interval), new Date(), 'Live Tail');
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

function useSearchedConfigToChartConfig({
  select,
  source,
  whereLanguage,
  where,
  filters,
  orderBy,
}: SearchConfig) {
  const { data: sourceObj, isLoading } = useSource({
    id: source,
  });
  const defaultOrderBy = useDefaultOrderBy(source);

  return useMemo(() => {
    if (sourceObj != null) {
      return {
        data: {
          select: select || (sourceObj.defaultTableSelectExpression ?? ''),
          from: sourceObj.from,
          ...(sourceObj.tableFilterExpression != null
            ? {
                filters: [
                  {
                    type: 'sql' as const,
                    condition: sourceObj.tableFilterExpression,
                  },
                  ...(filters ?? []),
                ],
              }
            : {}),
          ...(filters != null ? { filters } : {}),
          where: where ?? '',
          whereLanguage: whereLanguage ?? 'sql',
          timestampValueExpression: sourceObj.timestampValueExpression,
          implicitColumnExpression: sourceObj.implicitColumnExpression,
          connection: sourceObj.connection,
          displayType: DisplayType.Search,
          orderBy: orderBy || defaultOrderBy,
        },
      };
    }

    return { data: null, isLoading };
  }, [
    sourceObj,
    isLoading,
    select,
    filters,
    where,
    whereLanguage,
    defaultOrderBy,
  ]);
}

function optimizeDefaultOrderBy(
  timestampExpr: string,
  sortingKey: string | undefined,
) {
  const defaultModifier = 'DESC';
  const fallbackOrderByItems = [
    getFirstTimestampValueExpression(timestampExpr ?? ''),
    defaultModifier,
  ];
  const fallbackOrderBy = fallbackOrderByItems.join(' ');

  if (!sortingKey) return fallbackOrderBy;

  const orderByArr = [];
  const sortKeys = sortingKey.split(',').map(key => key.trim());
  for (let i = 0; i < sortKeys.length; i++) {
    const sortKey = sortKeys[i];
    if (sortKey.includes('toStartOf') && sortKey.includes(timestampExpr)) {
      orderByArr.push(sortKey);
    } else if (
      sortKey === timestampExpr ||
      (sortKey.startsWith('toUnixTimestamp') &&
        sortKey.includes(timestampExpr)) ||
      (sortKey.startsWith('toDateTime') && sortKey.includes(timestampExpr))
    ) {
      if (orderByArr.length === 0) {
        // fallback if the first sort key is the timestamp sort key
        return fallbackOrderBy;
      } else {
        orderByArr.push(sortKey);
        break;
      }
    }
  }

  // If we can't find an optimized order by, use the fallback/default
  if (orderByArr.length === 0) {
    return fallbackOrderBy;
  }

  return `(${orderByArr.join(', ')}) ${defaultModifier}`;
}

export function useDefaultOrderBy(sourceID: string | undefined | null) {
  const { data: source } = useSource({ id: sourceID });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  // When source changes, make sure select and orderby fields are set to default
  return useMemo(
    () =>
      optimizeDefaultOrderBy(
        source?.timestampValueExpression ?? '',
        tableMetadata?.sorting_key,
      ),
    [source, tableMetadata],
  );
}

// This is outside as it needs to be a stable reference
const queryStateMap = {
  source: parseAsString,
  where: parseAsString,
  select: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  filters: parseAsJson<Filter[]>(),
  orderBy: parseAsString,
};

function DBSearchPage() {
  // Next router is laggy behind window.location, which causes race
  // conditions with useQueryStates, so we'll parse it directly
  const paths = window.location.pathname.split('/');
  const savedSearchId = paths.length === 3 ? paths[2] : null;

  const [searchedConfig, setSearchedConfig] = useQueryStates(queryStateMap);

  const { data: savedSearch } = useSavedSearch(
    { id: `${savedSearchId}` },
    {
      enabled: savedSearchId != null,
    },
  );

  const { data: sources } = useSources();
  const [lastSelectedSourceId, setLastSelectedSourceId] = useLocalStorage(
    'hdx-last-selected-source-id',
    '',
  );
  const { data: searchedSource } = useSource({
    id: searchedConfig.source,
  });

  const [analysisMode, setAnalysisMode] = useQueryState(
    'mode',
    parseAsStringEnum<'results' | 'delta' | 'pattern'>([
      'results',
      'delta',
      'pattern',
    ]).withDefault('results'),
  );

  const [outlierSqlCondition, setOutlierSqlCondition] = useQueryState(
    'outlierSqlCondition',
    parseAsString,
  );

  const [_isLive, setIsLive] = useQueryState('isLive', parseAsBoolean);
  const isLive = _isLive ?? true;

  useEffect(() => {
    if (analysisMode === 'delta' || analysisMode === 'pattern') {
      setIsLive(false);
    }
  }, [analysisMode, setIsLive]);

  const [denoiseResults, _setDenoiseResults] = useQueryState(
    'denoise',
    parseAsBoolean.withDefault(false),
  );
  const setDenoiseResults = useCallback(
    (value: boolean) => {
      setIsLive(false);
      _setDenoiseResults(value);
    },
    [setIsLive, _setDenoiseResults],
  );

  // Get default source
  const defaultSourceId = useMemo(
    () => getDefaultSourceId(sources, lastSelectedSourceId),
    [sources, lastSelectedSourceId],
  );

  const {
    control,
    watch,
    setValue,
    reset,
    handleSubmit,
    getValues,
    formState,
    setError,
    resetField,
  } = useForm<SearchConfigFromSchema>({
    values: {
      select: searchedConfig.select || '',
      where: searchedConfig.where || '',
      whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
      source: searchedConfig.source || defaultSourceId,
      filters: searchedConfig.filters ?? [],
      orderBy: searchedConfig.orderBy ?? '',
    },
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
    },
    resolver: zodResolver(SearchConfigSchema),
  });

  const inputSource = watch('source');
  // const { data: inputSourceObj } = useSource({ id: inputSource });
  const { data: inputSourceObjs } = useSources();
  const inputSourceObj = inputSourceObjs?.find(s => s.id === inputSource);

  const defaultOrderBy = useDefaultOrderBy(inputSource);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Live Tail');

  const { from, to, isReady, searchedTimeRange, onSearch, onTimeRangeSelect } =
    useNewTimeQuery({
      initialDisplayValue: 'Live Tail',
      initialTimeRange: defaultTimeRange,
      showRelativeInterval: isLive ?? true,
      setDisplayedTimeInputValue,
      updateInput: !isLive,
    });

  // If live tail is null, but time range exists, don't live tail
  // If live tail is null, and time range is null, let's live tail
  useEffect(() => {
    if (_isLive == null && isReady) {
      if (from == null && to == null) {
        setIsLive(true);
      } else {
        setIsLive(false);
      }
    }
  }, [_isLive, setIsLive, from, to, isReady]);

  // Sync url state back with form state
  // (ex. for history navigation)
  // TODO: Check if there are any bad edge cases here
  const prevSearched = usePrevious(searchedConfig);
  useEffect(() => {
    if (JSON.stringify(prevSearched) !== JSON.stringify(searchedConfig)) {
      reset({
        select: searchedConfig?.select ?? '',
        where: searchedConfig?.where ?? '',
        whereLanguage: searchedConfig?.whereLanguage ?? 'lucene',
        source: searchedConfig?.source ?? undefined,
        filters: searchedConfig?.filters ?? [],
        orderBy: searchedConfig?.orderBy ?? '',
      });
    }
  }, [searchedConfig, reset, prevSearched]);

  // Populate searched query with saved search if the query params have
  // been wiped (ex. clicking on the same saved search again)
  useEffect(() => {
    const { source, where, select, whereLanguage, filters } = searchedConfig;
    const isSearchConfigEmpty =
      !source && !where && !select && !whereLanguage && !filters?.length;

    if (isSearchConfigEmpty) {
      // Landed on saved search (if we just landed on a searchId route)
      if (
        savedSearch != null && // Make sure saved search data is loaded
        savedSearch.id === savedSearchId // Make sure we've loaded the correct saved search
      ) {
        setSearchedConfig({
          source: savedSearch.source,
          where: savedSearch.where,
          select: savedSearch.select,
          whereLanguage: savedSearch.whereLanguage as 'sql' | 'lucene',
          orderBy: savedSearch.orderBy ?? '',
        });
        return;
      }

      // Landed on a new search - ensure we have a source selected
      if (savedSearchId == null && defaultSourceId) {
        setSearchedConfig({
          source: defaultSourceId,
          where: '',
          select: '',
          whereLanguage: 'lucene',
          orderBy: '',
        });
        return;
      }
    }
  }, [
    savedSearch,
    searchedConfig,
    setSearchedConfig,
    savedSearchId,
    defaultSourceId,
    sources,
  ]);

  const [_queryErrors, setQueryErrors] = useState<{
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

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(
      ({ select, where, whereLanguage, source, filters, orderBy }) => {
        setSearchedConfig({
          select,
          where,
          whereLanguage,
          source,
          filters,
          orderBy,
        });
      },
    )();
    // clear query errors
    setQueryErrors({});
  }, [
    handleSubmit,
    setSearchedConfig,
    displayedTimeInputValue,
    onSearch,
    setQueryErrors,
  ]);

  // Filter loading state management for live tail mode
  // This allows showing loading animations when applying filters during live tail,
  // without kicking the user out of live tail mode (which would show "Resume Live Tail" button)
  const [isFiltering, setIsFiltering] = useState(false);
  const filteringTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (filteringTimeoutRef.current) {
        clearTimeout(filteringTimeoutRef.current);
      }
    };
  }, []);

  const debouncedSubmit = useDebouncedCallback(() => {
    onSubmit();
    // Clear filtering state after the submit completes to restore normal live tail behavior
    if (filteringTimeoutRef.current) {
      clearTimeout(filteringTimeoutRef.current);
    }
    filteringTimeoutRef.current = setTimeout(() => setIsFiltering(false), 1500);
  }, 1000);

  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      // Set filtering state to show loading animations even during live tail mode
      setIsFiltering(true);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  const searchFilters = useSearchPageFilterState({
    searchQuery: watch('filters') ?? undefined,
    onFilterChange: handleSetFilters,
  });

  useEffect(() => {
    const { unsubscribe } = watch((data, { name, type }) => {
      // If the user changes the source dropdown, reset the select and orderby fields
      // to match the new source selected
      if (name === 'source' && type === 'change') {
        const newInputSourceObj = inputSourceObjs?.find(
          s => s.id === data.source,
        );
        if (newInputSourceObj != null) {
          // Save the selected source ID to localStorage
          setLastSelectedSourceId(newInputSourceObj.id);

          setValue(
            'select',
            newInputSourceObj?.defaultTableSelectExpression ?? '',
          );
          // Clear all search filters
          searchFilters.clearAllFilters();
        }
      }
    });
    return () => unsubscribe();
  }, [
    watch,
    inputSourceObj,
    setValue,
    inputSourceObjs,
    searchFilters,
    setLastSelectedSourceId,
  ]);

  const onTableScroll = useCallback(
    (scrollTop: number) => {
      // If the user scrolls a bit down, kick out of live mode
      if (scrollTop > 16 && isLive) {
        setIsLive(false);
      }
    },
    [isLive, setIsLive],
  );

  const onSidebarOpen = useCallback(() => {
    setIsLive(false);
  }, [setIsLive]);

  const [modelFormExpanded, setModelFormExpanded] = useState(false); // Used in local mode
  const [saveSearchModalState, setSaveSearchModalState] = useState<
    'create' | 'update' | undefined
  >(undefined);

  const { data: chartConfig, isLoading: isChartConfigLoading } =
    useSearchedConfigToChartConfig(searchedConfig);

  // query error handling
  const { hasQueryError, queryError } = useMemo(() => {
    const hasQueryError = Object.values(_queryErrors).length > 0;
    const queryError: Error | ClickHouseQueryError | null = hasQueryError
      ? Object.values(_queryErrors)[0]
      : null;
    return { hasQueryError, queryError };
  }, [_queryErrors]);
  const inputWhere = watch('where');
  const inputWhereLanguage = watch('whereLanguage');
  // query suggestion for 'where' if error
  const whereSuggestions = useSqlSuggestions({
    input: inputWhere,
    enabled: hasQueryError && inputWhereLanguage === 'sql',
  });

  const queryReady =
    chartConfig?.from?.databaseName &&
    chartConfig?.from?.tableName &&
    chartConfig?.timestampValueExpression;

  const updateSavedSearch = useUpdateSavedSearch();
  const deleteSavedSearch = useDeleteSavedSearch();
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
            whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
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
                message: (
                  <>
                    An error occurred. <ContactSupportText />
                  </>
                ),
              });
            },
          },
        );
      }
    },
    [savedSearch, searchedConfig, updateSavedSearch],
  );

  const [newSourceModalOpened, setNewSourceModalOpened] = useState(false);

  const QUERY_KEY_PREFIX = 'search';

  const isAnyQueryFetching =
    useIsFetching({
      queryKey: [QUERY_KEY_PREFIX],
    }) > 0;

  const isTabVisible = useDocumentVisibility();

  // State for collapsing all expanded rows when resuming live tail
  const [collapseAllRows, setCollapseAllRows] = useState(false);

  useLiveUpdate({
    isLive,
    interval: 1000 * 60 * 15,
    refreshFrequency: 4000,
    onTimeRangeSelect,
    pause: isAnyQueryFetching || !queryReady || !isTabVisible,
  });

  // This ensures we only render this conditionally on the client
  // otherwise we get SSR hydration issues
  const [shouldShowLiveModeHint, setShouldShowLiveModeHint] = useState(false);
  useEffect(() => {
    setShouldShowLiveModeHint(isLive === false);
  }, [isLive]);

  const { data: me } = api.useMe();

  // Callback to handle when rows are expanded - kick user out of live tail
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
    setDisplayedTimeInputValue('Live Tail');
    // Trigger collapsing all expanded rows
    setCollapseAllRows(true);
    // Reset the collapse trigger after a short delay
    setTimeout(() => setCollapseAllRows(false), 100);
    onSearch('Live Tail');
  }, [onSearch, setIsLive]);

  const dbSqlRowTableConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    return {
      ...chartConfig,
      dateRange: searchedTimeRange,
    };
  }, [me?.team, chartConfig, searchedTimeRange]);

  const displayedColumns = splitAndTrimWithBracket(
    dbSqlRowTableConfig?.select ??
      searchedSource?.defaultTableSelectExpression ??
      '',
  );

  const toggleColumn = (column: string) => {
    const newSelectArray = displayedColumns.includes(column)
      ? displayedColumns.filter(s => s !== column)
      : [...displayedColumns, column];
    setValue('select', newSelectArray.join(', '));
    onSubmit();
  };

  const generateSearchUrl = useCallback(
    ({
      where,
      whereLanguage,
    }: {
      where: SearchConfig['where'];
      whereLanguage: SearchConfig['whereLanguage'];
    }) => {
      const qParams = new URLSearchParams({
        where: where || searchedConfig.where || '',
        whereLanguage: whereLanguage || 'sql',
        from: searchedTimeRange[0].getTime().toString(),
        to: searchedTimeRange[1].getTime().toString(),
        select: searchedConfig.select || '',
        source: searchedSource?.id || '',
        filters: JSON.stringify(searchedConfig.filters),
      });
      return `/search?${qParams.toString()}`;
    },
    [
      searchedConfig.filters,
      searchedConfig.select,
      searchedConfig.where,
      searchedSource?.id,
      searchedTimeRange,
    ],
  );

  const handleTableError = useCallback(
    (error: Error | ClickHouseQueryError) => {
      setIsLive(false);
      setQueryErrors(prev => ({ ...prev, DBSqlRowTable: error }));
    },
    [setIsLive, setQueryErrors],
  );

  const [isAlertModalOpen, { open: openAlertModal, close: closeAlertModal }] =
    useDisclosure();

  // Add this effect to trigger initial search when component mounts
  useEffect(() => {
    if (isReady && queryReady && !isChartConfigLoading) {
      // Only trigger if we haven't searched yet (no time range in URL)
      const searchParams = new URLSearchParams(window.location.search);
      if (!searchParams.has('from') && !searchParams.has('to')) {
        onSearch('Live Tail');
      }
    }
  }, [isReady, queryReady, isChartConfigLoading, onSearch]);

  const { data: aliasMap } = useAliasMapFromChartConfig(dbSqlRowTableConfig);

  const aliasWith = useMemo(
    () =>
      Object.entries(aliasMap ?? {}).map(([key, value]) => ({
        name: key,
        sql: {
          sql: value,
          params: {},
        },
        isSubquery: false,
      })),
    [aliasMap],
  );

  const histogramTimeChartConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    const variableConfig: any = {};
    switch (searchedSource?.kind) {
      case SourceKind.Log:
        variableConfig.groupBy = searchedSource?.severityTextExpression;
        break;
      case SourceKind.Trace:
        variableConfig.groupBy = searchedSource?.statusCodeExpression;
        break;
    }

    return {
      ...chartConfig,
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
      ],
      orderBy: undefined,
      granularity: 'auto',
      dateRange: searchedTimeRange,
      displayType: DisplayType.StackedBar,
      with: aliasWith,
      ...variableConfig,
    };
  }, [chartConfig, searchedSource, aliasWith, searchedTimeRange]);

  const onFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    e => {
      e.preventDefault();
      onSubmit();
      return false;
    },
    [onSubmit],
  );

  const handleTimeRangeSelect = useCallback(
    (d1: Date, d2: Date) => {
      onTimeRangeSelect(d1, d2);
      setIsLive(false);
    },
    [onTimeRangeSelect],
  );

  const filtersChartConfig = useMemo<ChartConfigWithDateRange>(() => {
    const overrides = {
      orderBy: undefined,
      dateRange: searchedTimeRange,
      with: aliasWith,
    } as const;
    return chartConfig
      ? {
          ...chartConfig,
          ...overrides,
        }
      : {
          timestampValueExpression: '',
          connection: '',
          from: {
            databaseName: '',
            tableName: '',
          },
          where: '',
          select: '',
          ...overrides,
        };
  }, [chartConfig, searchedTimeRange, aliasWith]);

  const openNewSourceModal = useCallback(() => {
    setNewSourceModalOpened(true);
  }, []);

  const [isDrawerChildModalOpen, setDrawerChildModalOpen] = useState(false);

  return (
    <Flex direction="column" h="100vh" style={{ overflow: 'hidden' }}>
      {!IS_LOCAL_MODE && isAlertModalOpen && (
        <DBSearchPageAlertModal
          id={savedSearch?.id}
          searchedConfig={searchedConfig}
          open={isAlertModalOpen}
          onClose={closeAlertModal}
        />
      )}
      <OnboardingModal />
      <form data-testid="search-form" onSubmit={onFormSubmit}>
        {/* <DevTool control={control} /> */}
        <Flex gap="sm" px="sm" pt="sm" wrap="nowrap">
          <Group gap="4px" wrap="nowrap">
            <SourceSelectControlled
              key={`${savedSearchId}`}
              size="xs"
              control={control}
              name="source"
              onCreate={openNewSourceModal}
              allowedSourceKinds={[SourceKind.Log, SourceKind.Trace]}
              data-testid="source-selector"
            />
            <span className="ms-1">
              <SourceSchemaPreview
                source={inputSourceObj}
                iconStyles={{ size: 'xs', color: 'dark.2' }}
              />
            </span>
            <Menu withArrow position="bottom-start">
              <Menu.Target>
                <ActionIcon
                  data-testid="source-settings-menu"
                  variant="subtle"
                  color="dark.2"
                  size="sm"
                  title="Edit Source"
                >
                  <Text size="xs">
                    <i className="bi bi-gear" />
                  </Text>
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Sources</Menu.Label>
                <Menu.Item
                  data-testid="create-new-source-menu-item"
                  leftSection={<i className="bi bi-plus-circle" />}
                  onClick={() => setNewSourceModalOpened(true)}
                >
                  Create New Source
                </Menu.Item>
                {IS_LOCAL_MODE ? (
                  <Menu.Item
                    data-testid="edit-source-menu-item"
                    leftSection={<i className="bi bi-gear" />}
                    onClick={() => setModelFormExpanded(v => !v)}
                  >
                    Edit Source
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    data-testid="edit-sources-menu-item"
                    leftSection={<i className="bi bi-gear" />}
                    component={Link}
                    href="/team"
                  >
                    Edit Sources
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Box style={{ minWidth: 100, flexGrow: 1 }}>
            <SQLInlineEditorControlled
              tableConnections={tcFromSource(inputSourceObj)}
              control={control}
              name="select"
              defaultValue={inputSourceObj?.defaultTableSelectExpression}
              placeholder={
                inputSourceObj?.defaultTableSelectExpression || 'SELECT Columns'
              }
              onSubmit={onSubmit}
              label="SELECT"
              size="xs"
            />
          </Box>
          <Box style={{ maxWidth: 400, width: '20%' }}>
            <SQLInlineEditorControlled
              tableConnections={tcFromSource(inputSourceObj)}
              control={control}
              name="orderBy"
              defaultValue={defaultOrderBy}
              onSubmit={onSubmit}
              label="ORDER BY"
              size="xs"
            />
          </Box>
          {!IS_LOCAL_MODE && (
            <>
              {!savedSearchId ? (
                <Button
                  data-testid="save-search-button"
                  variant="outline"
                  color="dark.2"
                  px="xs"
                  size="xs"
                  onClick={onSaveSearch}
                  style={{ flexShrink: 0 }}
                >
                  Save
                </Button>
              ) : (
                <Button
                  data-testid="update-search-button"
                  variant="outline"
                  color="dark.2"
                  px="xs"
                  size="xs"
                  onClick={() => {
                    setSaveSearchModalState('update');
                  }}
                  style={{ flexShrink: 0 }}
                >
                  Update
                </Button>
              )}
              {!IS_LOCAL_MODE && (
                <Button
                  data-testid="alerts-button"
                  variant="outline"
                  color="dark.2"
                  px="xs"
                  size="xs"
                  onClick={openAlertModal}
                  style={{ flexShrink: 0 }}
                >
                  Alerts
                </Button>
              )}
              {!!savedSearch && (
                <>
                  <Tags
                    allowCreate
                    values={savedSearch.tags || []}
                    onChange={handleUpdateTags}
                  >
                    <Button
                      data-testid="tags-button"
                      variant="outline"
                      color="dark.2"
                      px="xs"
                      size="xs"
                      style={{ flexShrink: 0 }}
                    >
                      <i className="bi bi-tags-fill me-1"></i>
                      {savedSearch.tags?.length || 0}
                    </Button>
                  </Tags>

                  <SearchPageActionBar
                    onClickDeleteSavedSearch={() => {
                      deleteSavedSearch.mutate(savedSearch?.id ?? '', {
                        onSuccess: () => {
                          router.push('/search');
                        },
                      });
                    }}
                    onClickRenameSavedSearch={() => {
                      setSaveSearchModalState('update');
                    }}
                  />
                </>
              )}
            </>
          )}
        </Flex>
        <Modal
          size="xl"
          opened={modelFormExpanded}
          onClose={() => {
            setModelFormExpanded(false);
          }}
          title="Edit Source"
        >
          <TableSourceForm sourceId={inputSource} />
        </Modal>
        <Modal
          size="xl"
          opened={newSourceModalOpened}
          onClose={() => {
            setNewSourceModalOpened(false);
          }}
          title="Configure New Source"
        >
          <TableSourceForm
            isNew
            defaultName="My New Source"
            onCreate={newSource => {
              setValue('source', newSource.id);
              setNewSourceModalOpened(false);
            }}
          />
        </Modal>
        <Flex gap="sm" mt="sm" px="sm">
          <WhereLanguageControlled
            name="whereLanguage"
            control={control}
            sqlInput={
              <Box style={{ width: '75%', flexGrow: 1 }}>
                <SQLInlineEditorControlled
                  tableConnections={tcFromSource(inputSourceObj)}
                  control={control}
                  name="where"
                  placeholder="SQL WHERE clause (ex. column = 'foo')"
                  onLanguageChange={lang =>
                    setValue('whereLanguage', lang, {
                      shouldDirty: true,
                    })
                  }
                  language="sql"
                  onSubmit={onSubmit}
                  label="WHERE"
                  queryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_SQL}
                  enableHotkey
                />
              </Box>
            }
            luceneInput={
              <SearchInputV2
                tableConnections={tcFromSource(inputSourceObj)}
                control={control}
                name="where"
                onLanguageChange={lang =>
                  setValue('whereLanguage', lang, {
                    shouldDirty: true,
                  })
                }
                onSubmit={onSubmit}
                language="lucene"
                placeholder="Search your events w/ Lucene ex. column:foo"
                queryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_LUCENE}
                enableHotkey
                data-testid="search-input"
              />
            }
          />
          <TimePicker
            data-testid="time-picker"
            inputValue={displayedTimeInputValue}
            setInputValue={setDisplayedTimeInputValue}
            onSearch={range => {
              if (range === 'Live Tail') {
                setIsLive(true);
              } else {
                setIsLive(false);
              }
              onSearch(range);
            }}
            showLive={analysisMode === 'results'}
          />
          <Button
            data-testid="search-submit-button"
            variant="outline"
            type="submit"
            color={formState.isDirty ? 'green' : 'gray.4'}
          >
            <i className="bi bi-play"></i>
          </Button>
        </Flex>
      </form>
      {searchedConfig != null && searchedSource != null && (
        <SaveSearchModal
          opened={saveSearchModalState != null}
          onClose={() => setSaveSearchModalState(undefined)}
          // @ts-ignore FIXME: Do some sort of validation?
          searchedConfig={searchedConfig}
          isUpdate={saveSearchModalState === 'update'}
          savedSearchId={savedSearchId}
        />
      )}
      <Flex
        direction="column"
        mt="sm"
        style={{ overflow: 'hidden', height: '100%' }}
        className="bg-hdx-dark"
      >
        {!queryReady ? (
          <Paper shadow="xs" p="xl" h="100%">
            <Center mih={100} h="100%">
              <Text size="sm" c="gray.4">
                Please start by selecting a database, table, and timestamp
                column above to view data.
              </Text>
            </Center>
          </Paper>
        ) : (
          <>
            <div
              className={searchPageStyles.searchPageContainer}
              style={{
                minHeight: 0,
                height: '100%',
              }}
            >
              <ErrorBoundary message="Unable to render search filters">
                <DBSearchPageFilters
                  denoiseResults={denoiseResults}
                  setDenoiseResults={setDenoiseResults}
                  isLive={isLive}
                  analysisMode={analysisMode}
                  setAnalysisMode={setAnalysisMode}
                  chartConfig={filtersChartConfig}
                  sourceId={inputSourceObj?.id}
                  showDelta={!!searchedSource?.durationExpression}
                  {...searchFilters}
                />
              </ErrorBoundary>
              {analysisMode === 'pattern' &&
                histogramTimeChartConfig != null && (
                  <Flex direction="column" w="100%" gap="0px">
                    <Box style={{ height: 20, minHeight: 20 }} p="xs" pb="md">
                      <Group
                        justify="space-between"
                        mb={4}
                        style={{ width: '100%' }}
                      >
                        <SearchTotalCountChart
                          config={histogramTimeChartConfig}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                        />
                        <SearchNumRows
                          config={{
                            ...chartConfig,
                            dateRange: searchedTimeRange,
                          }}
                          enabled={isReady}
                        />
                      </Group>
                    </Box>
                    {!hasQueryError && (
                      <Box
                        style={{ height: 120, minHeight: 120 }}
                        p="xs"
                        pb="md"
                        mb="md"
                      >
                        <DBTimeChart
                          sourceId={searchedConfig.source ?? undefined}
                          showLegend={false}
                          config={histogramTimeChartConfig}
                          enabled={isReady}
                          showDisplaySwitcher={false}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onTimeRangeSelect={handleTimeRangeSelect}
                          // Pass false when filtering to show loading animations during live tail
                          isLive={isLive && !isFiltering}
                        />
                      </Box>
                    )}
                    <PatternTable
                      source={searchedSource}
                      config={{
                        ...chartConfig,
                        dateRange: searchedTimeRange,
                      }}
                      bodyValueExpression={
                        searchedSource?.bodyExpression ??
                        chartConfig.implicitColumnExpression ??
                        ''
                      }
                      totalCountConfig={histogramTimeChartConfig}
                      totalCountQueryKeyPrefix={QUERY_KEY_PREFIX}
                    />
                  </Flex>
                )}
              {analysisMode === 'delta' && searchedSource != null && (
                <Flex direction="column" w="100%">
                  <div
                    style={{ minHeight: 210, maxHeight: 210, width: '100%' }}
                  >
                    <DBHeatmapChart
                      config={{
                        ...chartConfig,
                        select: [
                          {
                            aggFn: 'heatmap',
                            valueExpression:
                              getDurationMsExpression(searchedSource),
                          },
                        ],
                        dateRange: searchedTimeRange,
                        displayType: DisplayType.Heatmap,
                        granularity: 'auto',
                        with: aliasWith,
                      }}
                      enabled={isReady}
                      onFilter={(xMin, xMax, yMin, yMax) => {
                        setOutlierSqlCondition(
                          [
                            `${searchedSource.durationExpression} >= ${yMin} * 1e${(searchedSource.durationPrecision ?? 9) - 3}`,
                            `${searchedSource.durationExpression} <= ${yMax} * 1e${(searchedSource.durationPrecision ?? 9) - 3}`,
                            `${getFirstTimestampValueExpression(chartConfig.timestampValueExpression)} >= ${xMin}`,
                            `${getFirstTimestampValueExpression(chartConfig.timestampValueExpression)} <= ${xMax}`,
                          ].join(' AND '),
                        );
                      }}
                    />
                  </div>
                  {outlierSqlCondition ? (
                    <DBDeltaChart
                      config={{
                        ...chartConfig,
                        dateRange: searchedTimeRange,
                      }}
                      outlierSqlCondition={outlierSqlCondition ?? ''}
                    />
                  ) : (
                    <Paper shadow="xs" p="xl" h="100%">
                      <Center mih={100} h="100%">
                        <Text size="sm" c="gray.4">
                          Please highlight an outlier range in the heatmap to
                          view the delta chart.
                        </Text>
                      </Center>
                    </Paper>
                  )}
                </Flex>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {analysisMode === 'results' &&
                  chartConfig &&
                  histogramTimeChartConfig && (
                    <>
                      <Box style={{ height: 20, minHeight: 20 }} p="xs" pb="md">
                        <Group
                          justify="space-between"
                          mb={4}
                          style={{ width: '100%' }}
                        >
                          <SearchTotalCountChart
                            config={histogramTimeChartConfig}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                          />
                          <SearchNumRows
                            config={{
                              ...chartConfig,
                              dateRange: searchedTimeRange,
                            }}
                            enabled={isReady}
                          />
                        </Group>
                      </Box>
                      {!hasQueryError && (
                        <Box
                          style={{ height: 120, minHeight: 120 }}
                          p="xs"
                          pb="md"
                          mb="md"
                        >
                          <DBTimeChart
                            sourceId={searchedConfig.source ?? undefined}
                            showLegend={false}
                            config={histogramTimeChartConfig}
                            enabled={isReady}
                            showDisplaySwitcher={false}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            onTimeRangeSelect={handleTimeRangeSelect}
                            // Pass false when filtering to show loading animations during live tail
                            isLive={isLive && !isFiltering}
                          />
                        </Box>
                      )}
                    </>
                  )}
                {hasQueryError && queryError ? (
                  <>
                    <div className="h-100 w-100 px-4 mt-4 align-items-center justify-content-center text-muted overflow-auto">
                      {whereSuggestions && whereSuggestions.length > 0 && (
                        <Box mb="xl">
                          <Text size="lg">
                            <b>Query Helper</b>
                          </Text>
                          <Grid>
                            {whereSuggestions!.map(s => (
                              <>
                                <Grid.Col span={10}>
                                  <Text>{s.userMessage('where')}</Text>
                                </Grid.Col>
                                <Grid.Col span={2}>
                                  <Button
                                    onClick={() =>
                                      setValue('where', s.corrected())
                                    }
                                  >
                                    Accept
                                  </Button>
                                </Grid.Col>
                              </>
                            ))}
                          </Grid>
                        </Box>
                      )}
                      <Box mt="sm">
                        <Text my="sm" size="sm">
                          Error encountered for query with inputs:
                        </Text>
                        <Paper
                          flex="auto"
                          p={'sm'}
                          shadow="none"
                          radius="sm"
                          style={{ overflow: 'hidden' }}
                        >
                          <Grid>
                            <Grid.Col span={2}>
                              <Text>SELECT</Text>
                            </Grid.Col>
                            <Grid.Col span={10}>
                              <SQLPreview
                                data={`${chartConfig.select as string}`}
                                formatData={false}
                              />
                            </Grid.Col>
                            <Grid.Col span={2}>
                              <Text>ORDER BY</Text>
                            </Grid.Col>
                            <Grid.Col span={10}>
                              <SQLPreview
                                data={`${chartConfig.orderBy}`}
                                formatData={false}
                              />
                            </Grid.Col>
                            <Grid.Col span={2}>
                              <Text>
                                {chartConfig.whereLanguage === 'lucene'
                                  ? 'Searched For'
                                  : 'WHERE'}
                              </Text>
                            </Grid.Col>
                            <Grid.Col span={10}>
                              {chartConfig.whereLanguage === 'lucene' ? (
                                <CodeMirror
                                  indentWithTab={false}
                                  value={chartConfig.where}
                                  theme="dark"
                                  basicSetup={{
                                    lineNumbers: false,
                                    foldGutter: false,
                                    highlightActiveLine: false,
                                    highlightActiveLineGutter: false,
                                  }}
                                  editable={false}
                                />
                              ) : (
                                <SQLPreview data={`${chartConfig.where}`} />
                              )}
                            </Grid.Col>
                          </Grid>
                        </Paper>
                      </Box>
                      <Box mt="lg">
                        <Text my="sm" size="sm">
                          Error Message:
                        </Text>
                        <Code
                          block
                          style={{
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {queryError.message}
                        </Code>
                      </Box>
                      {queryError instanceof ClickHouseQueryError && (
                        <Box mt="lg">
                          <Text my="sm" size="sm">
                            Original Query:
                          </Text>
                          <Code
                            block
                            style={{
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            <SQLPreview data={queryError.query} formatData />
                          </Code>
                        </Box>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {shouldShowLiveModeHint &&
                      analysisMode === 'results' &&
                      denoiseResults != true && (
                        <div
                          className="d-flex justify-content-center"
                          style={{ height: 0 }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              top: -20,
                              zIndex: 2,
                            }}
                          >
                            <Button
                              size="compact-xs"
                              variant="outline"
                              onClick={handleResumeLiveTail}
                            >
                              <i className="bi text-success bi-lightning-charge-fill me-2" />
                              Resume Live Tail
                            </Button>
                          </div>
                        </div>
                      )}
                    {chartConfig &&
                      searchedConfig.source &&
                      dbSqlRowTableConfig &&
                      analysisMode === 'results' && (
                        <DBSqlRowTableWithSideBar
                          context={{
                            onPropertyAddClick: searchFilters.setFilterValue,
                            displayedColumns,
                            toggleColumn,
                            generateSearchUrl,
                            dbSqlRowTableConfig,
                            isChildModalOpen: isDrawerChildModalOpen,
                            setChildModalOpen: setDrawerChildModalOpen,
                          }}
                          config={dbSqlRowTableConfig}
                          sourceId={searchedConfig.source}
                          onSidebarOpen={onSidebarOpen}
                          onExpandedRowsChange={onExpandedRowsChange}
                          enabled={isReady}
                          isLive={isLive ?? true}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onScroll={onTableScroll}
                          onError={handleTableError}
                          denoiseResults={denoiseResults}
                          collapseAllRows={collapseAllRows}
                        />
                      )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Flex>
    </Flex>
  );
}

const DBSearchPageDynamic = dynamic(async () => DBSearchPage, { ssr: false });

// @ts-ignore
DBSearchPageDynamic.getLayout = withAppNav;

export default DBSearchPageDynamic;
