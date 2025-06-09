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
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
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
  Modal,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure, useDocumentVisibility } from '@mantine/hooks';
import { useIsFetching } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';

import DBDeltaChart from '@/components/DBDeltaChart';
import DBHeatmapChart from '@/components/DBHeatmapChart';
import DBRowSidePanel from '@/components/DBRowSidePanel';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';
import { DBSqlRowTable } from '@/components/DBRowTable';
import { DBSearchForm } from '@/components/DBSearchForm';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { DBTimeChart } from '@/components/DBTimeChart';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import SearchTotalCountChart from '@/components/SearchTotalCountChart';
import { Tags } from '@/components/Tags';
import { IS_LOCAL_MODE } from '@/config';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { withAppNav } from '@/layout';
import {
  useCreateSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import {
  getDurationMsExpression,
  getFirstTimestampValueExpression,
  useSource,
  useSources,
} from '@/source';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { SQLPreview } from './components/ChartSQLPreview';
import PatternTable from './components/PatternTable';
import { useSqlSuggestions } from './hooks/useSqlSuggestions';
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
                <Button variant="outline" color="gray" size="xs">
                  <i className="bi bi-plus me-1"></i>
                  Add Tag
                </Button>
              </Tags>
            </Group>
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

function WhereSuggestions(setValue?: (name: string, value: any) => void) {
  // query suggestion for 'where' if error
  const whereSuggestions = useSqlSuggestions({
    input: searchedConfig.where || '',
    enabled:
      hasQueryError && (searchedConfig.whereLanguage || 'lucene') === 'sql',
  });

  if (whereSuggestions && whereSuggestions.length > 0) {
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
                                      setValue?.(
                                        'where',
                                        s.corrected(),
                                      )
                                    }
                                  >
                                    Accept
                                  </Button>
                                </Grid.Col>
                              </>
                            ))}
                          </Grid>
                        </Box>
  }
  return null
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

  const { data: savedSearch } = useSavedSearch(
    { id: `${savedSearchId}` },
    {
      enabled: savedSearchId != null,
    },
  );

  const [searchedConfig, setSearchedConfig] = useQueryStates(queryStateMap);
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

  const { data: inputSourceObjs } = useSources();
  const inputSource = searchedConfig.source;
  const inputSourceObj = inputSourceObjs?.find(s => s.id === inputSource);

  const [rowId, setRowId] = useQueryState('rowWhere');

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

  const searchFilters = useSearchPageFilterState({
    searchQuery: searchedConfig.filters ?? undefined,
    onFilterChange: (filters: Filter[]) => {
      setSearchedConfig(prev => ({ ...prev, filters }));
    },
  });

  const onTableScroll = useCallback(
    (scrollTop: number) => {
      // If the user scrolls a bit down, kick out of live mode
      if (scrollTop > 16 && isLive) {
        setIsLive(false);
      }
    },
    [isLive, setIsLive],
  );

  const onRowExpandClick = useCallback(
    (rowWhere: string) => {
      setIsLive(false);
      setRowId(rowWhere);
    },
    [setRowId, setIsLive],
  );

  const { data: chartConfig, isLoading: isChartConfigLoading } =
    useSearchedConfigToChartConfig(searchedConfig);

  // query error handling
  const { hasQueryError, queryError } = useMemo(() => {
    const hasQueryError = Object.values(_queryErrors).length > 0;
    const queryError = hasQueryError ? Object.values(_queryErrors)[0] : null;
    return { hasQueryError, queryError };
  }, [_queryErrors]);

  const queryReady =
    chartConfig?.from?.databaseName &&
    chartConfig?.from?.tableName &&
    chartConfig?.timestampValueExpression;

  const QUERY_KEY_PREFIX = 'search';

  const isAnyQueryFetching =
    useIsFetching({
      queryKey: [QUERY_KEY_PREFIX],
    }) > 0;

  const isTabVisible = useDocumentVisibility();

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

  const handleResumeLiveTail = useCallback(() => {
    setIsLive(true);
    setDisplayedTimeInputValue('Live Tail');
    onSearch('Live Tail');
  }, [onSearch, setIsLive]);

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

  const displayedColumns = splitAndTrimWithBracket(
    dbSqlRowTableConfig?.select ??
      searchedSource?.defaultTableSelectExpression ??
      '',
  );

  const toggleColumn = (column: string) => {
    const newSelectArray = displayedColumns.includes(column)
      ? displayedColumns.filter(s => s !== column)
      : [...displayedColumns, column];
    if (formMethods) {
      formMethods.setValue('select', newSelectArray.join(', '));
      formMethods.onSubmit();
    }
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

  const [saveSearchModalState, setSaveSearchModalState] = useState<
    'create' | 'update' | undefined
  >(undefined);

  // Form methods exposed from DBSearchForm
  const [formMethods, setFormMethods] = useState<{
    setValue: (name: string, value: any) => void;
    onSubmit: () => void;
  } | null>(null);

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

  const aliasWith = Object.entries(aliasMap ?? {}).map(([key, value]) => ({
    name: key,
    sql: {
      sql: value,
      params: {},
    },
    isSubquery: false,
  }));

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
      <DBSearchForm
        onOpenAlertModal={openAlertModal}
        onSetSaveSearchModalState={setSaveSearchModalState}
        onFormMethodsReady={setFormMethods}
      />
      <RowSidePanelContext.Provider
        value={{
          onPropertyAddClick: searchFilters.setFilterValue,
          displayedColumns,
          toggleColumn,
          generateSearchUrl,
          dbSqlRowTableConfig,
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
                  chartConfig={{
                    ...chartConfig,
                    orderBy: undefined,
                    dateRange: searchedTimeRange,
                    with: aliasWith,
                  }}
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
                          onTimeRangeSelect={(d1, d2) => {
                            onTimeRangeSelect(d1, d2);
                            setIsLive(false);
                          }}
                          onError={error =>
                            setQueryErrors(prev => ({
                              ...prev,
                              DBTimeChart: error,
                            }))
                          }
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
                            onTimeRangeSelect={(d1, d2) => {
                              onTimeRangeSelect(d1, d2);
                              setIsLive(false);
                            }}
                            onError={error =>
                              setQueryErrors(prev => ({
                                ...prev,
                                DBTimeChart: error,
                              }))
                            }
                          />
                        </Box>
                      )}
                    </>
                  )}
                {hasQueryError && queryError ? (
                    <div className="h-100 w-100 px-4 mt-4 align-items-center justify-content-center text-muted overflow-auto">
                  <WhereSuggestions />
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
                      dbSqlRowTableConfig &&
                      analysisMode === 'results' && (
                        <DBSqlRowTable
                          config={dbSqlRowTableConfig}
                          sourceId={searchedConfig.source ?? ''}
                          onRowExpandClick={onRowExpandClick}
                          highlightedLineId={rowId ?? undefined}
                          enabled={isReady}
                          isLive={isLive ?? true}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onScroll={onTableScroll}
                          onError={handleTableError}
                          denoiseResults={denoiseResults}
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
