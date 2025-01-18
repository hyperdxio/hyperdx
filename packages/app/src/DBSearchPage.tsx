import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
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
import {
  ChartConfig,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Center,
  Flex,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { useIsFetching } from '@tanstack/react-query';

import { useTimeChartSettings } from '@/ChartUtils';
import DBDeltaChart from '@/components/DBDeltaChart';
import DBHeatmapChart from '@/components/DBHeatmapChart';
import DBRowSidePanel from '@/components/DBRowSidePanel';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import { DBSqlRowTable } from '@/components/DBRowTable';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { DBTimeChart } from '@/components/DBTimeChart';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import { TableSourceForm } from '@/components/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { IS_LOCAL_MODE } from '@/config';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
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
import { usePrevious } from '@/utils';

import { DBSearchPageAlertModal } from './DBSearchPageAlertModal';

type SearchConfig = {
  select?: string | null;
  source?: string | null;
  where?: ChartConfig['where'] | null;
  whereLanguage?: ChartConfig['whereLanguage'] | null;
  filters?: Filter[] | null;
  orderBy?: string | null;
};
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

function SearchTotalCount({
  config,
  queryKeyPrefix,
}: {
  config: ChartConfigWithDateRange;
  queryKeyPrefix: string;
}) {
  // copied from DBTimeChart
  const { granularity } = useTimeChartSettings(config);
  const queriedConfig = {
    ...config,
    granularity,
    limit: { limit: 100000 },
  };
  const { data: totalCountData, isLoading } = useQueriedChartConfig(
    queriedConfig,
    {
      queryKey: [queryKeyPrefix, queriedConfig],
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  );

  const totalCount = useMemo(() => {
    return totalCountData?.data?.reduce(
      (p: number, v: any) => p + Number.parseInt(v['count()']),
      0,
    );
  }, [totalCountData]);

  return (
    <Text size="xs" c="gray.4" mb={4}>
      {isLoading ? (
        <span className="effect-pulse">&middot;&middot;&middot; Results</span>
      ) : totalCount !== null ? (
        `${totalCount} Results`
      ) : (
        'Results'
      )}
    </Text>
  );
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

  const { control, handleSubmit } = useForm({
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
            tags: [],
          },
          {
            onSuccess: savedSearch => {
              router.push(`/search/${savedSearch.id}`);
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
      opened={opened}
      onClose={onClose}
      title="Save Search"
      centered
      size="lg"
    >
      <form onSubmit={onSubmit}>
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
            <InputControlled control={control} name="name" />
          </Box>
          <Button variant="outline" color="green" type="submit">
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
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (isLive) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }

      // only start interval if no queries are fetching
      if (!pause) {
        intervalRef.current = window.setInterval(() => {
          onTimeRangeSelect(
            new Date(Date.now() - interval),
            new Date(),
            'Live Tail',
          );
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
  }, [isLive, onTimeRangeSelect, pause, interval, refreshFrequency]);
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
          orderBy:
            orderBy ||
            `${getFirstTimestampValueExpression(
              sourceObj.timestampValueExpression,
            )} DESC`,
        },
      };
    }

    return { data: null, isLoading };
  }, [sourceObj, isLoading, select, filters, where, whereLanguage]);
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

      // Landed on a new search
      if (inputSource && savedSearchId == null) {
        setSearchedConfig({
          source: inputSource,
          where: '',
          select: '',
          whereLanguage: 'lucene',
          orderBy: '',
        });
        return;
      }
    }
  }, [savedSearch, searchedConfig, setSearchedConfig, savedSearchId]);

  const { data: sources } = useSources();
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

  const [isLive, setIsLive] = useQueryState(
    'isLive',
    parseAsBoolean.withDefault(true),
  );

  useEffect(() => {
    if (analysisMode === 'delta') {
      setIsLive(false);
    }
  }, [analysisMode, setIsLive]);

  const {
    control,
    watch,
    setValue,
    reset,
    handleSubmit,
    getValues,
    formState,
    setError,
  } = useForm<z.infer<typeof SearchConfigSchema>>({
    values: {
      select: searchedConfig.select || '',
      where: searchedConfig.where || '',
      whereLanguage: searchedConfig.whereLanguage ?? 'lucene',
      source: searchedConfig.source ?? sources?.[0]?.id ?? '',
      filters: searchedConfig.filters ?? [],
      orderBy: searchedConfig.orderBy ?? '',
    },
    resetOptions: {
      keepDirtyValues: true,
      keepErrors: true,
    },
    resolver: zodResolver(SearchConfigSchema),
  });

  const [rowId, setRowId] = useQueryState('rowWhere');

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Live Tail');

  const { isReady, searchedTimeRange, onSearch, onTimeRangeSelect } =
    useNewTimeQuery({
      initialDisplayValue: 'Live Tail',
      initialTimeRange: defaultTimeRange,
      showRelativeInterval: isLive ?? true,
      setDisplayedTimeInputValue,
      updateInput: !isLive,
    });

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

  const onTableScroll = useCallback(
    (scrollTop: number) => {
      // If the user scrolls a bit down, kick out of live mode
      if (scrollTop > 16) {
        setIsLive(false);
      }
    },
    [setIsLive],
  );

  const inputSource = watch('source');
  const { data: inputSourceObj } = useSource({ id: inputSource });
  const databaseName = inputSourceObj?.from.databaseName;
  const tableName = inputSourceObj?.from.tableName;

  const onRowExpandClick = useCallback(
    (rowWhere: string) => {
      setIsLive(false);
      setRowId(rowWhere);
    },
    [setRowId, setIsLive],
  );

  const [modelFormExpanded, setModelFormExpanded] = useState(false);
  const [saveSearchModalState, setSaveSearchModalState] = useState<
    'create' | 'update' | undefined
  >(undefined);

  const { data: chartConfig, isLoading: isChartConfigLoading } =
    useSearchedConfigToChartConfig(searchedConfig);

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
  }, [handleSubmit, setSearchedConfig, displayedTimeInputValue, onSearch]);

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

  const [newSourceModalOpened, setNewSourceModalOpened] = useState(false);

  const QUERY_KEY_PREFIX = 'search';

  const isAnyQueryFetching =
    useIsFetching({
      queryKey: [QUERY_KEY_PREFIX],
    }) > 0;

  useLiveUpdate({
    isLive,
    interval: 1000 * 60 * 15,
    refreshFrequency: 4000,
    onTimeRangeSelect,
    pause: isAnyQueryFetching || !queryReady,
  });

  // This ensures we only render this conditionally on the client
  // otherwise we get SSR hydration issues
  const [shouldShowLiveModeHint, setShouldShowLiveModeHint] = useState(false);
  useEffect(() => {
    setShouldShowLiveModeHint(isLive === false);
  }, [isLive]);

  const handleResumeLiveTail = useCallback(() => {
    setIsLive(true);
    setDisplayedTimeInputValue('Live Tail');
    onSearch('Live Tail');
  }, [onSearch, setIsLive]);

  const debouncedSubmit = useDebouncedCallback(onSubmit, 1000);
  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  const dbSqlRowTableConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    return {
      ...chartConfig,
      dateRange: searchedTimeRange,
      limit: { limit: 200 },
    };
  }, [chartConfig, searchedTimeRange]);

  const searchFilters = useSearchPageFilterState({
    searchQuery: watch('filters') ?? undefined,
    onFilterChange: handleSetFilters,
  });

  const displayedColumns = (
    dbSqlRowTableConfig?.select ??
    searchedSource?.defaultTableSelectExpression ??
    ''
  )
    .split(',')
    .map(s => s.trim());

  const toggleColumn = (column: string) => {
    const newSelectArray = displayedColumns.includes(column)
      ? displayedColumns.filter(s => s !== column)
      : [...displayedColumns, column];
    setValue('select', newSelectArray.join(', '));
    onSubmit();
  };

  const generateSearchUrl = useCallback(
    (query?: string) => {
      const qParams = new URLSearchParams({
        where: query || searchedConfig.where || '',
        whereLanguage: 'sql',
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

  const handleTableError = useCallback(() => {
    setIsLive(false);
  }, [setIsLive]);

  // When source changes, make sure select and orderby fields are set to default
  const defaultOrderBy = useMemo(
    () =>
      `${getFirstTimestampValueExpression(
        inputSourceObj?.timestampValueExpression ?? '',
      )} DESC`,
    [inputSourceObj?.timestampValueExpression],
  );

  useEffect(() => {
    setValue('select', inputSourceObj?.defaultTableSelectExpression ?? '');
    setValue('orderBy', defaultOrderBy);
  }, [inputSource, inputSourceObj, defaultOrderBy]);

  const [isAlertModalOpen, { open: openAlertModal, close: closeAlertModal }] =
    useDisclosure();

  return (
    <Flex direction="column" h="100vh" style={{ overflow: 'hidden' }}>
      {isAlertModalOpen && (
        <DBSearchPageAlertModal
          id={savedSearch?.id ?? ''}
          open={isAlertModalOpen}
          onClose={closeAlertModal}
        />
      )}
      <OnboardingModal />
      <form
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
          return false;
        }}
      >
        {/* <DevTool control={control} /> */}
        <Flex gap="sm" px="sm" pt="sm">
          <Group gap="4px">
            <SourceSelectControlled
              key={`${savedSearchId}`}
              size="xs"
              control={control}
              name="source"
              onCreate={() => {
                setNewSourceModalOpened(true);
              }}
            />
            <ActionIcon
              variant="subtle"
              color="dark.2"
              size="sm"
              onClick={() => setModelFormExpanded(v => !v)}
              title="Edit Source"
            >
              <Text size="xs">
                <i className="bi bi-gear" />
              </Text>
            </ActionIcon>
          </Group>
          <SQLInlineEditorControlled
            connectionId={inputSourceObj?.connection}
            database={databaseName}
            table={tableName}
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
          <Box style={{ maxWidth: 400, width: '20%' }}>
            <SQLInlineEditorControlled
              connectionId={inputSourceObj?.connection}
              database={databaseName}
              table={tableName}
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
              <Button
                variant="outline"
                color="dark.2"
                px="xs"
                size="xs"
                onClick={onSaveSearch}
              >
                Save
              </Button>
              <Tooltip
                label={
                  savedSearchId
                    ? 'Manage or create alerts for this search'
                    : 'Save this view to create alerts'
                }
                color="dark"
              >
                <Button
                  variant="outline"
                  color="dark.2"
                  px="xs"
                  size="xs"
                  onClick={openAlertModal}
                  disabled={!savedSearchId}
                >
                  Alerts
                </Button>
              </Tooltip>
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
              <SQLInlineEditorControlled
                connectionId={inputSourceObj?.connection}
                database={databaseName}
                table={tableName}
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
                enableHotkey
              />
            }
            luceneInput={
              <SearchInputV2
                connectionId={inputSourceObj?.connection}
                database={databaseName}
                table={tableName}
                control={control}
                name="where"
                onLanguageChange={lang =>
                  setValue('whereLanguage', lang, {
                    shouldDirty: true,
                  })
                }
                language="lucene"
                placeholder="Search your events w/ Lucene ex. column:foo"
                enableHotkey
              />
            }
          />
          <TimePicker
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
            variant="outline"
            type="submit"
            color={formState.isDirty ? 'green' : 'gray.4'}
          >
            <i className="bi bi-play"></i>
          </Button>
        </Flex>
      </form>
      <RowSidePanelContext.Provider
        value={{
          onPropertyAddClick: searchFilters.setFilterValue,
          displayedColumns,
          toggleColumn,
          generateSearchUrl,
        }}
      >
        {searchedSource && (
          <DBRowSidePanel
            source={searchedSource}
            rowId={rowId ?? undefined}
            onClose={() => setRowId(null)}
          />
        )}
      </RowSidePanelContext.Provider>
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
              className="d-flex flex-row flex-grow-0"
              style={{
                minHeight: 0,
                height: '100%',
              }}
            >
              <ErrorBoundary message="Unable to render search filters">
                <DBSearchPageFilters
                  isLive={isLive}
                  analysisMode={analysisMode}
                  setAnalysisMode={setAnalysisMode}
                  chartConfig={{
                    ...chartConfig,
                    orderBy: undefined,
                    dateRange: searchedTimeRange,
                  }}
                  {...searchFilters}
                />
              </ErrorBoundary>
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
                {analysisMode === 'results' && (
                  <Box
                    style={{ height: 140, minHeight: 140 }}
                    p="xs"
                    pb="md"
                    mb="md"
                  >
                    {chartConfig && (
                      <>
                        <Group justify="space-between" mb={4}>
                          <SearchTotalCount
                            config={{
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
                            }}
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
                        <DBTimeChart
                          sourceId={searchedConfig.source ?? undefined}
                          showLegend={false}
                          config={{
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
                          }}
                          enabled={isReady}
                          showDisplaySwitcher={false}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onTimeRangeSelect={(d1, d2) => {
                            onTimeRangeSelect(d1, d2);
                            setIsLive(false);
                          }}
                        />
                      </>
                    )}
                  </Box>
                )}
                {shouldShowLiveModeHint && analysisMode === 'results' && (
                  <div
                    className="d-flex justify-content-center"
                    style={{ height: 0 }}
                  >
                    <div style={{ position: 'relative', top: -20, zIndex: 2 }}>
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
                  dbSqlRowTableConfig &&
                  analysisMode === 'results' && (
                    <DBSqlRowTable
                      config={dbSqlRowTableConfig}
                      onRowExpandClick={onRowExpandClick}
                      highlightedLineId={rowId ?? undefined}
                      enabled={isReady}
                      isLive={isLive ?? true}
                      queryKeyPrefix={QUERY_KEY_PREFIX}
                      onScroll={onTableScroll}
                      onError={handleTableError}
                    />
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
