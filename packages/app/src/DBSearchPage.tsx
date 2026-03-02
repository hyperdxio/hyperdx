import {
  FormEvent,
  FormEventHandler,
  memo,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import router from 'next/router';
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsJson,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isBrowser,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
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
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  useDebouncedCallback,
  useDisclosure,
  useDocumentVisibility,
} from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBolt,
  IconCirclePlus,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconTags,
  IconX,
} from '@tabler/icons-react';
import { useIsFetching } from '@tanstack/react-query';
import { SortingState } from '@tanstack/react-table';
import CodeMirror from '@uiw/react-codemirror';

import { ContactSupportText } from '@/components/ContactSupportText';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { DBTimeChart } from '@/components/DBTimeChart';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { SQLInlineEditorControlled } from '@/components/SearchInput/SQLInlineEditor';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import SearchTotalCountChart from '@/components/SearchTotalCountChart';
import { TableSourceForm } from '@/components/Sources/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { Tags } from '@/components/Tags';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { aliasMapToWithClauses } from '@/hooks/useRowWhere';
import { withAppNav } from '@/layout';
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import {
  getEventBody,
  getFirstTimestampValueExpression,
  useSource,
  useSources,
} from '@/source';
import { useAppTheme, useBrandDisplayName } from '@/theme/ThemeProvider';
import {
  parseRelativeTimeQuery,
  parseTimeQuery,
  useNewTimeQuery,
} from '@/timeQuery';
import { QUERY_LOCAL_STORAGE, useLocalStorage, usePrevious } from '@/utils';

import { SQLPreview } from './components/ChartSQLPreview';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import PatternTable from './components/PatternTable';
import { DBSearchHeatmapChart } from './components/Search/DBSearchHeatmapChart';
import SourceSchemaPreview from './components/SourceSchemaPreview';
import {
  getRelativeTimeOptionLabel,
  LIVE_TAIL_DURATION_MS,
} from './components/TimePicker/utils';
import { useTableMetadata } from './hooks/useMetadata';
import { useSqlSuggestions } from './hooks/useSqlSuggestions';
import {
  parseAsSortingStateString,
  parseAsStringWithNewLines,
} from './utils/queryParsers';
import api from './api';
import { LOCAL_STORE_CONNECTIONS_KEY } from './connection';
import { DBSearchPageAlertModal } from './DBSearchPageAlertModal';
import { SearchConfig } from './types';

import searchPageStyles from '../styles/SearchPage.module.scss';

const LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS = [
  { value: '1000', label: '1s' },
  { value: '2000', label: '2s' },
  { value: '4000', label: '4s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
];
const DEFAULT_REFRESH_FREQUENCY = 4000;

const ALLOWED_SOURCE_KINDS = [SourceKind.Log, SourceKind.Trace];
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

function SourceEditMenu({
  setModalOpen,
  setModelFormExpanded,
}: {
  setModalOpen: (val: SetStateAction<boolean>) => void;
  setModelFormExpanded: (val: SetStateAction<boolean>) => void;
}) {
  return (
    <Menu withArrow position="bottom-start">
      <Menu.Target>
        <ActionIcon
          data-testid="source-settings-menu"
          variant="subtle"
          size="sm"
          title="Edit Source"
        >
          <Text size="xs">
            <IconSettings size={14} />
          </Text>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Sources</Menu.Label>
        <Menu.Item
          data-testid="create-new-source-menu-item"
          leftSection={<IconCirclePlus size={14} />}
          onClick={() => setModalOpen(true)}
        >
          Create New Source
        </Menu.Item>
        {IS_LOCAL_MODE ? (
          <Menu.Item
            data-testid="edit-sources-menu-item"
            leftSection={<IconSettings size={14} />}
            onClick={() => setModelFormExpanded(v => !v)}
          >
            Edit Source
          </Menu.Item>
        ) : (
          <Menu.Item
            data-testid="edit-sources-menu-item"
            leftSection={<IconSettings size={14} />}
            component={Link}
            href="/team"
          >
            Edit Sources
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

function SourceEditModal({
  opened,
  onClose,
  inputSource,
}: {
  opened: boolean;
  onClose: () => void;
  inputSource: string | undefined;
}) {
  return (
    <Modal size="xl" opened={opened} onClose={onClose} title="Edit Source">
      <TableSourceForm sourceId={inputSource} />
    </Modal>
  );
}

function NewSourceModal({
  opened,
  onClose,
  onCreate,
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (source: TSource) => void;
}) {
  return (
    <Modal
      size="xl"
      opened={opened}
      onClose={onClose}
      title="Configure New Source"
    >
      <TableSourceForm isNew defaultName="My New Source" onCreate={onCreate} />
    </Modal>
  );
}

function ResumeLiveTailButton({
  handleResumeLiveTail,
}: {
  handleResumeLiveTail: () => void;
}) {
  const { themeName } = useAppTheme();
  const variant = themeName === 'clickstack' ? 'secondary' : 'primary';

  return (
    <Button
      size="compact-xs"
      variant={variant}
      onClick={handleResumeLiveTail}
      leftSection={<IconBolt size={14} />}
    >
      Resume Live Tail
    </Button>
  );
}

function SearchSubmitButton({
  isFormStateDirty,
}: {
  isFormStateDirty: boolean;
}) {
  return (
    <Button
      data-testid="search-submit-button"
      variant={isFormStateDirty ? 'primary' : 'secondary'}
      type="submit"
      leftSection={<IconPlayerPlay size={16} />}
      style={{ flexShrink: 0 }}
    >
      Run
    </Button>
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
    <Text size="xs" mb={4}>
      {isLoading
        ? 'Scanned Rows ...'
        : error || !numRows
          ? ''
          : `Scanned Rows: ${Number.parseInt(numRows)?.toLocaleString()}`}
    </Text>
  );
}

function SaveSearchModalComponent({
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
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
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
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
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
              <Text size="xs" mb="xs">
                SELECT
              </Text>
              <Text mb="sm" size="xs">{`${chartConfig.select}`}</Text>
              <Text size="xs" mb="xs">
                FROM
              </Text>
              <Text mb="sm" size="xs">
                {chartConfig?.from.databaseName}.{chartConfig?.from.tableName}
              </Text>
              <Text size="xs" mb="xs">
                WHERE
              </Text>
              {chartConfig.where ? (
                <Text size="xs">{chartConfig.where}</Text>
              ) : (
                <Text size="xxs" fs="italic">
                  None
                </Text>
              )}
              <Text size="xs" mb="xs" mt="sm">
                ORDER BY
              </Text>
              <Text size="xs">{chartConfig.orderBy}</Text>
              {searchedConfig.filters && searchedConfig.filters.length > 0 && (
                <>
                  <Text size="xs" mb="xs" mt="sm">
                    FILTERS
                  </Text>
                  <Stack gap="xs">
                    {searchedConfig.filters.map((filter, idx) => (
                      <Text key={idx} size="xs" c="dimmed">
                        {filter.type === 'sql_ast'
                          ? `${filter.left} ${filter.operator} ${filter.right}`
                          : filter.condition}
                      </Text>
                    ))}
                  </Stack>
                </>
              )}
            </Card>
          ) : (
            <Text>Loading Chart Config...</Text>
          )}
          <Box>
            <Text size="xs" mb="xs">
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
            <Text size="xs" mb="xs">
              Tags
            </Text>
            <Group gap="xs" align="center" mb="xs">
              {tags.map(tag => (
                <Button
                  key={tag}
                  variant="secondary"
                  size="xs"
                  rightSection={
                    <ActionIcon
                      variant="transparent"
                      color="gray"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setTags(tags.filter(t => t !== tag));
                      }}
                      size="xs"
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  }
                >
                  {tag.toUpperCase()}
                </Button>
              ))}
              <Tags allowCreate values={tags} onChange={setTags}>
                <Button
                  data-testid="add-tag-button"
                  variant="secondary"
                  size="xs"
                >
                  <IconPlus size={14} className="me-1" />
                  Add Tag
                </Button>
              </Tags>
            </Group>
          </Box>
          <Button
            data-testid="save-search-submit-button"
            variant="primary"
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
const SaveSearchModal = memo(SaveSearchModalComponent);

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
    displayedTimeInputValue?: string | null,
  ) => void;
  pause: boolean;
}) {
  const documentState = useDocumentVisibility();
  const isDocumentVisible = documentState === 'visible';
  const [refreshOnVisible, setRefreshOnVisible] = useState(false);

  const refresh = useCallback(() => {
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
 * Takes in a input search config (user edited search config) and a default search config (saved search or source default config)
 * and returns a chart config.
 */
function useSearchedConfigToChartConfig(
  { select, source, whereLanguage, where, filters, orderBy }: SearchConfig,
  defaultSearchConfig?: Partial<SearchConfig>,
) {
  const { data: sourceObj, isLoading } = useSource({
    id: source,
  });
  const defaultOrderBy = useDefaultOrderBy(source);

  return useMemo(() => {
    if (sourceObj != null) {
      return {
        data: {
          select:
            select ||
            defaultSearchConfig?.select ||
            sourceObj.defaultTableSelectExpression ||
            '',
          from: sourceObj.from,
          source: sourceObj.id,
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
          orderBy: orderBy || defaultSearchConfig?.orderBy || defaultOrderBy,
        },
      };
    }

    return { data: null, isLoading };
  }, [
    sourceObj,
    isLoading,
    select,
    filters,
    defaultSearchConfig,
    where,
    whereLanguage,
    defaultOrderBy,
    orderBy,
  ]);
}

function optimizeDefaultOrderBy(
  timestampExpr: string,
  displayedTimestampExpr: string | undefined,
  sortingKey: string | undefined,
) {
  const defaultModifier = 'DESC';
  const firstTimestampValueExpression =
    getFirstTimestampValueExpression(timestampExpr ?? '') ?? '';
  const defaultOrderByItems = [firstTimestampValueExpression];
  const trimmedDisplayedTimestampExpr = displayedTimestampExpr?.trim();

  if (
    trimmedDisplayedTimestampExpr &&
    trimmedDisplayedTimestampExpr !== firstTimestampValueExpression
  ) {
    defaultOrderByItems.push(trimmedDisplayedTimestampExpr);
  }

  const fallbackOrderBy =
    defaultOrderByItems.length > 1
      ? `(${defaultOrderByItems.join(', ')}) ${defaultModifier}`
      : `${defaultOrderByItems[0]} ${defaultModifier}`;

  if (!sortingKey) return fallbackOrderBy;

  const orderByArr = [];
  const sortKeys = splitAndTrimWithBracket(sortingKey);
  for (let i = 0; i < sortKeys.length; i++) {
    const sortKey = sortKeys[i];
    if (
      sortKey.includes('toStartOf') &&
      sortKey.includes(firstTimestampValueExpression)
    ) {
      orderByArr.push(sortKey);
    } else if (
      sortKey === firstTimestampValueExpression ||
      (sortKey.startsWith('toUnixTimestamp') &&
        sortKey.includes(firstTimestampValueExpression)) ||
      (sortKey.startsWith('toDateTime') &&
        sortKey.includes(firstTimestampValueExpression))
    ) {
      if (orderByArr.length === 0) {
        // fallback if the first sort key is the timestamp sort key
        return fallbackOrderBy;
      } else {
        orderByArr.push(sortKey);
        break;
      }
    } else if (sortKey === trimmedDisplayedTimestampExpr) {
      orderByArr.push(sortKey);
    }
  }

  // If we can't find an optimized order by, use the fallback/default
  if (orderByArr.length === 0) {
    return fallbackOrderBy;
  }

  if (
    trimmedDisplayedTimestampExpr &&
    !orderByArr.includes(trimmedDisplayedTimestampExpr)
  ) {
    orderByArr.push(trimmedDisplayedTimestampExpr);
  }

  return orderByArr.length > 1
    ? `(${orderByArr.join(', ')}) ${defaultModifier}`
    : `${orderByArr[0]} ${defaultModifier}`;
}

export function useDefaultOrderBy(sourceID: string | undefined | null) {
  const { data: source } = useSource({ id: sourceID });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  // When source changes, make sure select and orderby fields are set to default
  return useMemo(() => {
    // If no source, return undefined so that the orderBy is not set incorrectly
    if (!source) return undefined;
    return optimizeDefaultOrderBy(
      source?.timestampValueExpression ?? '',
      source?.displayedTimestampValueExpression,
      tableMetadata?.sorting_key,
    );
  }, [source, tableMetadata]);
}

// This is outside as it needs to be a stable reference
const queryStateMap = {
  source: parseAsString,
  where: parseAsStringWithNewLines,
  select: parseAsStringWithNewLines,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  filters: parseAsJson<Filter[]>(),
  orderBy: parseAsStringWithNewLines,
};

function DBSearchPage() {
  const brandName = useBrandDisplayName();
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

  const [isLive, setIsLive] = useQueryState(
    'isLive',
    parseAsBoolean.withDefault(true),
  );

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
      whereLanguage:
        searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
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

  const inputSource = useWatch({ name: 'source', control });

  const defaultOrderBy = useDefaultOrderBy(inputSource);

  // The default search config to use when the user hasn't changed the search config
  const defaultSearchConfig = useMemo(() => {
    let _savedSearch = savedSearch;
    // Ensure to not use the saved search if the saved search id is not the same as the current saved search id
    if (!savedSearchId || savedSearch?.id !== savedSearchId) {
      _savedSearch = undefined;
    }
    // Ensure to not use the saved search if the input source is not the same as the saved search source
    if (inputSource !== savedSearch?.source) {
      _savedSearch = undefined;
    }
    return {
      select:
        _savedSearch?.select ?? searchedSource?.defaultTableSelectExpression,
      where: _savedSearch?.where ?? '',
      whereLanguage: _savedSearch?.whereLanguage ?? 'lucene',
      source: _savedSearch?.source,
      filters: _savedSearch?.filters ?? [],
      orderBy: _savedSearch?.orderBy || defaultOrderBy,
    };
  }, [searchedSource, inputSource, savedSearch, defaultOrderBy, savedSearchId]);

  // const { data: inputSourceObj } = useSource({ id: inputSource });
  const { data: inputSourceObjs } = useSources();
  const inputSourceObj = inputSourceObjs?.find(s => s.id === inputSource);

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
        whereLanguage:
          searchedConfig?.whereLanguage ?? getStoredLanguage() ?? 'lucene',
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

    // Landed on saved search (if we just landed on a searchId route)
    if (
      savedSearch != null && // Make sure saved search data is loaded
      savedSearch.id === savedSearchId && // Make sure we've loaded the correct saved search
      isSearchConfigEmpty // Only populate if URL doesn't have explicit config
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

    // Landed on a new search - ensure we have a source selected
    if (savedSearchId == null && defaultSourceId && isSearchConfigEmpty) {
      setSearchedConfig({
        source: defaultSourceId,
        where: '',
        select: '',
        whereLanguage: getStoredLanguage() ?? 'lucene',
        filters: [],
        orderBy: '',
      });
      return;
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

  const debouncedSubmit = useDebouncedCallback(onSubmit, 1000);
  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  const filters = useWatch({ name: 'filters', control });
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange: handleSetFilters,
  });

  const watchedSource = useWatch({
    control,
    name: 'source',
    // Watch will reset when changing saved search, so we need to default to the URL
    defaultValue: searchedConfig.source ?? undefined,
  });
  const prevSourceRef = useRef(watchedSource);

  useEffect(() => {
    // If the user changes the source dropdown, reset the select and orderby fields
    // to match the new source selected
    if (watchedSource !== prevSourceRef.current) {
      prevSourceRef.current = watchedSource;
      const newInputSourceObj = inputSourceObjs?.find(
        s => s.id === watchedSource,
      );
      if (newInputSourceObj != null) {
        // Save the selected source ID to localStorage
        setLastSelectedSourceId(newInputSourceObj.id);

        // If the user isn't in a saved search (or the source is different from the saved search source), reset fields
        if (savedSearchId == null || savedSearch?.source !== watchedSource) {
          setValue('select', '');
          setValue('orderBy', '');
          // Clear all search filters only when switching to a different source
          searchFilters.clearAllFilters();
          // If the user is in a saved search, prefer the saved search's select/orderBy if available
        } else {
          setValue('select', savedSearch?.select ?? '');
          setValue('orderBy', savedSearch?.orderBy ?? '');
          // Don't clear filters - we're loading from saved search
        }
      }
    }
  }, [
    watchedSource,
    setValue,
    savedSearch,
    savedSearchId,
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
    useSearchedConfigToChartConfig(searchedConfig, defaultSearchConfig);

  // query error handling
  const { hasQueryError, queryError } = useMemo(() => {
    const hasQueryError = Object.values(_queryErrors).length > 0;
    const queryError: Error | ClickHouseQueryError | null = hasQueryError
      ? Object.values(_queryErrors)[0]
      : null;
    return { hasQueryError, queryError };
  }, [_queryErrors]);
  const inputWhere = useWatch({ name: 'where', control });
  const inputWhereLanguage = useWatch({ name: 'whereLanguage', control });
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

  const [interval, setInterval] = useQueryState(
    'liveInterval',
    parseAsInteger.withDefault(LIVE_TAIL_DURATION_MS),
  );

  const [refreshFrequency, setRefreshFrequency] = useQueryState(
    'refreshFrequency',
    parseAsInteger.withDefault(DEFAULT_REFRESH_FREQUENCY),
  );

  const updateRelativeTimeInputValue = useCallback((interval: number) => {
    const label = getRelativeTimeOptionLabel(interval);
    if (label) {
      setDisplayedTimeInputValue(label);
    }
  }, []);

  useEffect(() => {
    if (isReady && isLive) {
      updateRelativeTimeInputValue(interval);
    }
    // we only want this to run on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRelativeTimeInputValue, searchedConfig.source, isReady]);

  useLiveUpdate({
    isLive,
    interval,
    refreshFrequency,
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
    updateRelativeTimeInputValue(interval);
    // Trigger collapsing all expanded rows
    setCollapseAllRows(true);
    // Reset the collapse trigger after a short delay
    setTimeout(() => setCollapseAllRows(false), 100);
  }, [interval, updateRelativeTimeInputValue, setIsLive]);

  const dbSqlRowTableConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    return {
      ...chartConfig,
      dateRange: searchedTimeRange,
    };
  }, [chartConfig, searchedTimeRange]);

  const displayedColumns = useMemo(
    () =>
      splitAndTrimWithBracket(
        dbSqlRowTableConfig?.select ?? defaultSearchConfig.select ?? '',
      ),
    [dbSqlRowTableConfig?.select, defaultSearchConfig.select],
  );

  const toggleColumn = useCallback(
    (column: string) => {
      const newSelectArray = displayedColumns.includes(column)
        ? displayedColumns.filter(s => s !== column)
        : [...displayedColumns, column];
      setValue('select', newSelectArray.join(', '));
      onSubmit();
    },
    [displayedColumns, setValue, onSubmit],
  );

  const generateSearchUrl = useCallback(
    ({
      where,
      whereLanguage,
      source,
    }: {
      where: SearchConfig['where'];
      whereLanguage: SearchConfig['whereLanguage'];
      source?: TSource;
    }) => {
      const qParams = new URLSearchParams({
        whereLanguage: whereLanguage || 'sql',
        from: searchedTimeRange[0].getTime().toString(),
        to: searchedTimeRange[1].getTime().toString(),
        isLive: 'false',
        liveInterval: interval.toString(),
      });

      // When generating a search based on a different source,
      // filters and select for the current source are not preserved.
      if (source && source.id !== searchedSource?.id) {
        qParams.append('where', where || '');
        qParams.append('source', source.id);
      } else {
        qParams.append('select', searchedConfig.select || '');
        qParams.append('where', where || searchedConfig.where || '');
        qParams.append('filters', JSON.stringify(searchedConfig.filters ?? []));
        qParams.append('source', searchedSource?.id || '');
      }

      return `/search?${qParams.toString()}`;
    },
    [
      interval,
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

  const aliasWith = useMemo(() => aliasMapToWithClauses(aliasMap), [aliasMap]);

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
      // Preserve the original table select string for "View Events" links
      eventTableSelect: searchedConfig.select,
      // In live mode, when the end date is aligned to the granularity, the end date does
      // not change on every query, resulting in cached data being re-used.
      alignDateRangeToGranularity: !isLive,
      ...variableConfig,
    };
  }, [
    chartConfig,
    searchedSource,
    aliasWith,
    searchedTimeRange,
    searchedConfig.select,
    isLive,
  ]);

  const onFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    e => {
      e.preventDefault();
      onSubmit();
      return false;
    },
    [onSubmit],
  );

  const onSortingChange = useCallback(
    (sortState: SortingState | null) => {
      setIsLive(false);
      const sort = sortState?.at(0);
      setSearchedConfig({
        orderBy: sort
          ? `${sort.id} ${sort.desc ? 'DESC' : 'ASC'}`
          : defaultSearchConfig.orderBy,
      });
    },
    [setIsLive, defaultSearchConfig.orderBy, setSearchedConfig],
  );
  // Parse the orderBy string into a SortingState. We need the string
  // version in other places so we keep this parser separate.
  const initialSortBy = useMemo(() => {
    const orderBy = parseAsSortingStateString.parse(
      searchedConfig.orderBy ?? '',
    );
    return orderBy ? [orderBy] : [];
  }, [searchedConfig.orderBy]);

  const handleTimeRangeSelect = useCallback(
    (d1: Date, d2: Date) => {
      onTimeRangeSelect(d1, d2);
      setIsLive(false);
    },
    [onTimeRangeSelect, setIsLive],
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

  const rowTableContext = useMemo(
    () => ({
      onPropertyAddClick: searchFilters.setFilterValue,
      displayedColumns,
      toggleColumn,
      generateSearchUrl,
      dbSqlRowTableConfig,
      isChildModalOpen: isDrawerChildModalOpen,
      setChildModalOpen: setDrawerChildModalOpen,
      source: searchedSource,
    }),
    [
      searchFilters.setFilterValue,
      searchedSource,
      dbSqlRowTableConfig,
      displayedColumns,
      toggleColumn,
      generateSearchUrl,
      isDrawerChildModalOpen,
    ],
  );

  const inputSourceTableConnection = useMemo(
    () => tcFromSource(inputSourceObj),
    [inputSourceObj],
  );

  const sourceSchemaPreview = useMemo(
    () => <SourceSchemaPreview source={inputSourceObj} variant="text" />,
    [inputSourceObj],
  );

  const onTimePickerSearch = useCallback(
    (range: string) => {
      setIsLive(false);
      onSearch(range);
    },
    [setIsLive, onSearch],
  );

  const onTimePickerRelativeSearch = useCallback(
    (rangeMs: number) => {
      const _range = parseRelativeTimeQuery(rangeMs);
      setIsLive(true);
      setInterval(rangeMs);
      onTimeRangeSelect(_range[0], _range[1], null);
    },
    [setIsLive, setInterval, onTimeRangeSelect],
  );

  const clearSaveSearchModalState = useCallback(
    () => setSaveSearchModalState(undefined),
    [setSaveSearchModalState],
  );

  const onModelFormExpandClose = useCallback(() => {
    setModelFormExpanded(false);
  }, [setModelFormExpanded]);

  const setNewSourceModalClosed = useCallback(
    () => setNewSourceModalOpened(false),
    [setNewSourceModalOpened],
  );

  const onNewSourceCreate = useCallback(
    (newSource: TSource) => {
      setValue('source', newSource.id);
      setNewSourceModalClosed();
    },
    [setValue, setNewSourceModalClosed],
  );

  return (
    <Flex
      direction="column"
      h="100vh"
      style={{ overflow: 'hidden' }}
      data-testid="search-page"
    >
      <Head>
        <title>
          {savedSearch ? `${savedSearch.name} Search` : 'Search'} - {brandName}
        </title>
      </Head>
      {!IS_LOCAL_MODE && isAlertModalOpen && (
        <DBSearchPageAlertModal
          id={savedSearch?.id}
          searchedConfig={searchedConfig}
          open={isAlertModalOpen}
          onClose={closeAlertModal}
        />
      )}
      <OnboardingModal />
      <form
        data-testid="search-form"
        onSubmit={onFormSubmit}
        className={searchPageStyles.searchForm}
      >
        {/* <DevTool control={control} /> */}
        <Flex gap="sm" px="sm" pt="sm" wrap="nowrap">
          <Group gap="4px" wrap="nowrap" style={{ minWidth: 150 }}>
            <SourceSelectControlled
              key={`${savedSearchId}`}
              size="xs"
              control={control}
              name="source"
              onCreate={openNewSourceModal}
              allowedSourceKinds={ALLOWED_SOURCE_KINDS}
              data-testid="source-selector"
              sourceSchemaPreview={sourceSchemaPreview}
            />
            <SourceEditMenu
              setModalOpen={setNewSourceModalOpened}
              setModelFormExpanded={setModelFormExpanded}
            />
          </Group>
          <Box style={{ flex: '1 1 0%', minWidth: 100 }}>
            <SQLInlineEditorControlled
              tableConnection={inputSourceTableConnection}
              control={control}
              name="select"
              defaultValue={defaultSearchConfig.select}
              placeholder={defaultSearchConfig.select || 'SELECT Columns'}
              onSubmit={onSubmit}
              label="SELECT"
              size="xs"
              allowMultiline
            />
          </Box>
          <Box style={{ maxWidth: 400, width: '20%' }}>
            <SQLInlineEditorControlled
              tableConnection={inputSourceTableConnection}
              control={control}
              name="orderBy"
              defaultValue={defaultSearchConfig.orderBy}
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
                  variant="secondary"
                  size="xs"
                  onClick={onSaveSearch}
                  style={{ flexShrink: 0 }}
                >
                  Save
                </Button>
              ) : (
                <Button
                  data-testid="update-search-button"
                  variant="secondary"
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
                  variant="secondary"
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
                      variant="secondary"
                      px="xs"
                      size="xs"
                      style={{ flexShrink: 0 }}
                    >
                      <IconTags size={14} className="me-1" />
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
        <SourceEditModal
          opened={modelFormExpanded}
          onClose={onModelFormExpandClose}
          inputSource={inputSource}
        />
        <NewSourceModal
          opened={newSourceModalOpened}
          onClose={setNewSourceModalClosed}
          onCreate={onNewSourceCreate}
        />
        <Flex gap="sm" mt="sm" px="sm">
          <SearchWhereInput
            tableConnection={inputSourceTableConnection}
            control={control}
            name="where"
            onSubmit={onSubmit}
            sqlQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_SQL}
            luceneQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_LUCENE}
            enableHotkey
            data-testid="search-input"
          />
          <TimePicker
            data-testid="time-picker"
            inputValue={displayedTimeInputValue}
            setInputValue={setDisplayedTimeInputValue}
            onSearch={onTimePickerSearch}
            onRelativeSearch={onTimePickerRelativeSearch}
            showLive={analysisMode === 'results'}
            isLiveMode={isLive}
            // Default to relative time mode if the user has made changes to interval and reloaded.
            defaultRelativeTimeMode={
              isLive && interval !== LIVE_TAIL_DURATION_MS
            }
          />
          {isLive && (
            <Tooltip label="Live tail refresh interval">
              <Box style={{ width: 80, minWidth: 80, flexShrink: 0 }}>
                <Select
                  size="sm"
                  w="100%"
                  data={LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS}
                  value={String(refreshFrequency)}
                  onChange={value =>
                    setRefreshFrequency(value ? parseInt(value, 10) : null)
                  }
                  allowDeselect={false}
                  comboboxProps={{
                    withinPortal: true,
                    zIndex: 1000,
                  }}
                />
              </Box>
            </Tooltip>
          )}
          <SearchSubmitButton isFormStateDirty={formState.isDirty} />
        </Flex>
      </form>
      {searchedConfig != null && searchedSource != null && (
        <SaveSearchModal
          opened={saveSearchModalState != null}
          onClose={clearSaveSearchModalState}
          searchedConfig={searchedConfig}
          isUpdate={saveSearchModalState === 'update'}
          savedSearchId={savedSearchId}
        />
      )}
      <Flex
        direction="column"
        style={{ overflow: 'hidden', height: '100%' }}
        className="bg-body"
      >
        {!queryReady ? (
          <Paper shadow="xs" p="xl" h="100%">
            <Center mih={100} h="100%">
              <Text size="sm">
                Please start by selecting a source and then click the play
                button to query data.
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
                  <Flex direction="column" w="100%" gap="0px" mih="0">
                    <Box className={searchPageStyles.searchStatsContainer}>
                      <Group justify="space-between" style={{ width: '100%' }}>
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
                        className={searchPageStyles.timeChartContainer}
                        mih="0"
                      >
                        <DBTimeChart
                          sourceId={searchedConfig.source ?? undefined}
                          showLegend={false}
                          config={histogramTimeChartConfig}
                          enabled={isReady}
                          showDisplaySwitcher={false}
                          showMVOptimizationIndicator={false}
                          showDateRangeIndicator={false}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onTimeRangeSelect={handleTimeRangeSelect}
                        />
                      </Box>
                    )}
                    <Box flex="1" mih="0" px="sm">
                      <PatternTable
                        source={searchedSource}
                        config={{
                          ...chartConfig,
                          dateRange: searchedTimeRange,
                        }}
                        bodyValueExpression={
                          searchedSource
                            ? (getEventBody(searchedSource) ?? '')
                            : (chartConfig.implicitColumnExpression ?? '')
                        }
                        totalCountConfig={histogramTimeChartConfig}
                        totalCountQueryKeyPrefix={QUERY_KEY_PREFIX}
                      />
                    </Box>
                  </Flex>
                )}
              {analysisMode === 'delta' && searchedSource != null && (
                <DBSearchHeatmapChart
                  chartConfig={{
                    ...chartConfig,
                    dateRange: searchedTimeRange,
                    with: aliasWith,
                  }}
                  isReady={isReady}
                  source={searchedSource}
                />
              )}
              {analysisMode === 'results' && (
                <Flex direction="column" mih="0">
                  {chartConfig && histogramTimeChartConfig && (
                    <>
                      <Box className={searchPageStyles.searchStatsContainer}>
                        <Group
                          justify="space-between"
                          style={{ width: '100%' }}
                        >
                          <SearchTotalCountChart
                            config={histogramTimeChartConfig}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            enableParallelQueries
                          />
                          <Group gap="sm" align="center">
                            {shouldShowLiveModeHint &&
                              denoiseResults != true && (
                                <ResumeLiveTailButton
                                  handleResumeLiveTail={handleResumeLiveTail}
                                />
                              )}
                            <SearchNumRows
                              config={{
                                ...chartConfig,
                                dateRange: searchedTimeRange,
                              }}
                              enabled={isReady}
                            />
                          </Group>
                        </Group>
                      </Box>
                      {!hasQueryError && (
                        <Box
                          className={searchPageStyles.timeChartContainer}
                          mih="0"
                        >
                          <DBTimeChart
                            sourceId={searchedConfig.source ?? undefined}
                            showLegend={false}
                            config={histogramTimeChartConfig}
                            enabled={isReady}
                            showDisplaySwitcher={false}
                            showMVOptimizationIndicator={false}
                            showDateRangeIndicator={false}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            onTimeRangeSelect={handleTimeRangeSelect}
                            enableParallelQueries
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
                    <Box flex="1" mih="0" px="sm">
                      {chartConfig &&
                        searchedConfig.source &&
                        dbSqlRowTableConfig && (
                          <DBSqlRowTableWithSideBar
                            context={rowTableContext}
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
                            onSortingChange={onSortingChange}
                            initialSortBy={initialSortBy}
                          />
                        )}
                    </Box>
                  )}
                </Flex>
              )}
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
