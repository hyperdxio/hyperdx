import {
  FormEvent,
  FormEventHandler,
  Fragment,
  memo,
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
import { formatDistanceToNow } from 'date-fns';
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { tcFromSource } from '@berg/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@berg/common-utils/dist/core/searchChartConfig';
import {
  isBrowser,
  splitAndTrimWithBracket,
} from '@berg/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  TSource,
} from '@berg/common-utils/dist/types';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActionIcon,
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Card,
  Code,
  Flex,
  Grid,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedCallback, useDocumentVisibility } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowBarToRight,
  IconBolt,
  IconPlayerPlay,
  IconPlus,
  IconStack2,
  IconTags,
  IconX,
} from '@tabler/icons-react';
import { useIsFetching } from '@tanstack/react-query';
import { SortingState } from '@tanstack/react-table';
import CodeMirror from '@uiw/react-codemirror';

import { ClickHouseQueryError } from '@/clickhouse-types';
import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import { ContactSupportText } from '@/components/ContactSupportText';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { DBTimeChart } from '@/components/DBTimeChart';
import EmptyState from '@/components/EmptyState';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { FavoriteButton } from '@/components/FavoriteButton';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import SearchPageActionBar from '@/components/SearchPageActionBar';
import SearchTotalCountChart from '@/components/SearchTotalCountChart';
import { EditSourceModal } from '@/components/Sources/EditSourceModal';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { Tags } from '@/components/Tags';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { withAppNav } from '@/layout';
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import { useSource, useSources } from '@/source';
import { useAppTheme, useBrandDisplayName } from '@/theme/ThemeProvider';
import {
  parseRelativeTimeQuery,
  parseTimeQuery,
  useNewTimeQuery,
} from '@/timeQuery';
import { QUERY_LOCAL_STORAGE, useLocalStorage, usePrevious } from '@/utils';

import { SQLPreview } from './components/ChartSQLPreview';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import SourceSchemaPreview from './components/SourceSchemaPreview';
import {
  getRelativeTimeOptionLabel,
  LIVE_TAIL_DURATION_MS,
} from './components/TimePicker/utils';
import { useColumns, useTableMetadata } from './hooks/useMetadata';
import { useSqlSuggestions } from './hooks/useSqlSuggestions';
import {
  parseAsJsonEncoded,
  parseAsSortingStateString,
  parseAsStringEncoded,
} from './utils/queryParsers';
import { LOCAL_STORE_CONNECTIONS_KEY } from './connection';
import { EditablePageName } from './EditablePageName';
import { SearchConfig } from './types';
import { FormatTime } from './useFormatTime';

import searchPageStyles from '../styles/SearchPage.module.scss';

const LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS = [
  { value: '1000', label: '1s' },
  { value: '2000', label: '2s' },
  { value: '4000', label: '4s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
];
const DEFAULT_REFRESH_FREQUENCY = 10000;

// NOTE (Berg / Task 9): Single Source kind ('Table'); no kind-allowlist
// filtering happens here anymore. The picker just lists every Source the
// team has saved.
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

const QUERY_KEY_PREFIX = 'search';

/**
 * Substitute Athena/Trino synthetic column refs (`_col<N>`) in filter
 * conditions with the underlying SELECT expression.  Those names exist only
 * in the result-set metadata; referencing them from a WHERE clause fails
 * with COLUMN_NOT_FOUND.  Trino numbers `_col<N>` by result-set position,
 * so for `SELECT *, expr1, expr2` the expressions are at positions
 * `sourceColumnCount`, `sourceColumnCount + 1`, … among the non-`*`
 * unaliased SELECT entries (in order of appearance).
 */
export function rewriteSyntheticColRefsInFilters(
  filters: Filter[],
  selectStr: string,
  sourceColumnCount: number,
): Filter[] {
  if (!filters.length || !selectStr || sourceColumnCount <= 0) return filters;
  const exprs = splitAndTrimWithBracket(selectStr);
  const nonStarExprs = exprs.filter(
    e => e.trim() !== '*' && !/\bAS\s+\S/i.test(e),
  );
  if (nonStarExprs.length === 0) return filters;
  const resolve = (name: string): string | null => {
    const m = /^_col(\d+)$/.exec(name);
    if (!m) return null;
    const i = Number(m[1]) - sourceColumnCount;
    return i >= 0 && i < nonStarExprs.length ? nonStarExprs[i] : null;
  };
  let changed = false;
  const out = filters.map(filter => {
    if (filter.type !== 'sql') return filter;
    const next = filter.condition.replace(/\b_col\d+\b/g, m => resolve(m) ?? m);
    if (next === filter.condition) return filter;
    changed = true;
    return { ...filter, condition: next };
  });
  return changed ? out : filters;
}

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

function SourceEditModal({
  opened,
  onClose,
  inputSource,
}: {
  opened: boolean;
  onClose: () => void;
  inputSource: string | undefined;
}) {
  const { data: source } = useSource({ id: inputSource });
  return <EditSourceModal opened={opened} onClose={onClose} source={source} />;
}

function NewSourceModal({
  opened,
  onClose,
  onCreate: _onCreate,
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (source: TSource) => void;
}) {
  // New-source flow goes through Catalog now; this stays only as a fallback
  // entry point for the search page when no sources exist yet.
  return <EditSourceModal opened={opened} onClose={onClose} />;
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

function ExpandFiltersButton({ onExpand }: { onExpand: () => void }) {
  return (
    <Tooltip label="Show filters" position="bottom">
      <ActionIcon
        variant="subtle"
        size="xs"
        onClick={onExpand}
        aria-label="Show filters"
      >
        <IconArrowBarToRight size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

function SearchResultsCountGroup({
  isFilterSidebarCollapsed,
  onExpandFilters,
  histogramTimeChartConfig,
  enableParallelQueries,
}: {
  isFilterSidebarCollapsed: boolean;
  onExpandFilters: () => void;
  histogramTimeChartConfig: BuilderChartConfigWithDateRange;
  enableParallelQueries?: boolean;
}) {
  return (
    <Group gap={4} align="center">
      {isFilterSidebarCollapsed && (
        <ExpandFiltersButton onExpand={onExpandFilters} />
      )}
      <SearchTotalCountChart
        config={histogramTimeChartConfig}
        queryKeyPrefix={QUERY_KEY_PREFIX}
        enableParallelQueries={enableParallelQueries}
      />
    </Group>
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
    <Text size="xs">
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

  const { data: sourceObj } = useSource({
    id: searchedConfig.source,
  });
  const effectiveSelect = searchedConfig.select || '';
  void sourceObj;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    handleSubmit(async ({ name }) => {
      if (isUpdate) {
        if (savedSearchId == null) {
          throw new Error('savedSearchId is required for update');
        }

        updateSavedSearch.mutate(
          {
            id: savedSearchId,
            name,
            select: effectiveSelect,
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
            onError: error => {
              console.error('Error updating saved search:', error);
              notifications.show({
                color: 'red',
                title: 'Error',
                message:
                  'An error occurred while updating your saved search. Please try again.',
              });
            },
          },
        );
      } else {
        try {
          const savedSearch = await createSavedSearch.mutateAsync({
            name,
            select: effectiveSelect,
            where: searchedConfig.where ?? '',
            whereLanguage:
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
            tags: tags,
          });

          router.push(`/search/${savedSearch.id}${window.location.search}`);
          onClose();
        } catch (error) {
          console.error('Error creating saved search:', error);
          notifications.show({
            color: 'red',
            title: 'Error',
            message:
              'An error occurred while saving your search. Please try again.',
          });
        }
      }
    })();
  };

  const isPending = createSavedSearch.isPending || updateSavedSearch.isPending;

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
                {chartConfig?.from?.databaseName ?? '—'}.
                {chartConfig?.from?.tableName ?? '—'}
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
              <Text size="xs">{`${chartConfig.orderBy ?? ''}`}</Text>
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
            loading={isPending}
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
      const resolvedOrderBy =
        orderBy || defaultSearchConfig?.orderBy || defaultOrderBy;

      const chartConfig = buildSearchChartConfig(sourceObj, {
        where,
        whereLanguage,
        filters,
        select: select || defaultSearchConfig?.select || null,
        displayType: DisplayType.Search,
        // Stamp the source id onto the chart config's `connection` field.
        // Berg's bridge (`makeBergClient`/`postBergQuery`) keys the
        // schema-via-Glue and QueryExecutionContext lookups off this id;
        // an empty string here was silently routing every Lucene/More-
        // filters/Schema-modal lookup to the no-source fallback (which
        // returns an empty schema and rejects every column).
        connection: sourceObj.id,
        ...(resolvedOrderBy != null ? { orderBy: resolvedOrderBy } : {}),
      });

      return {
        data: chartConfig,
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

const implicitDateTimePrefixes = [
  'toStartOf',
  'toUnixTimestamp',
  'toDateTime',
  'Timestamp',
] as const;

function optimizeDefaultOrderBy(
  timestampExpr: string,
  displayedTimestampExpr: string | undefined,
  sortingKey: string | undefined,
) {
  const orderByArr: string[] = [];

  const timestampExprParts = splitAndTrimWithBracket(timestampExpr);
  const keys = splitAndTrimWithBracket(sortingKey ?? '');
  keys.push(...timestampExprParts);
  if (displayedTimestampExpr) {
    keys.push(displayedTimestampExpr.trim());
  }
  for (const key of keys) {
    if (
      !orderByArr.includes(key) &&
      (implicitDateTimePrefixes.some(v => key.startsWith(v)) ||
        timestampExprParts.includes(key) ||
        displayedTimestampExpr?.trim() === key)
    ) {
      orderByArr.push(key);
    }
  }

  return orderByArr.length > 1
    ? `(${orderByArr.join(', ')}) DESC`
    : `${orderByArr[0]} DESC`;
}

export function useDefaultOrderBy(sourceID: string | undefined | null) {
  const { data: source } = useSource({
    id: sourceID,
  });
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  // When source changes, make sure select and orderby fields are set to default
  return useMemo(() => {
    // If no source, return undefined so that the orderBy is not set incorrectly
    if (!source) return undefined;
    // Berg / Task 9: prefer the Source's explicit `defaultSort` when set;
    // otherwise build a default from the timestamp column (DESC). For
    // sources without any time field we leave it undefined and let the
    // row table fall back to its first column.
    if (source.defaultSort?.trim()) return source.defaultSort.trim();
    if (source.timestampColumn) {
      return `${source.timestampColumn} DESC`;
    }
    return optimizeDefaultOrderBy(
      source.timestampColumn ?? '',
      undefined,
      tableMetadata?.sorting_key,
    );
  }, [source, tableMetadata]);
}

// This is outside as it needs to be a stable reference
const queryStateMap = {
  source: parseAsString,
  where: parseAsStringEncoded,
  select: parseAsStringEncoded,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  filters: parseAsJsonEncoded<Filter[]>(),
  orderBy: parseAsStringEncoded,
};

export function DBSearchPage() {
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
  // Source schema column count is needed to resolve `_col<N>` filter
  // references (Trino numbers synthetic column names by result-set position,
  // and `*` consumes one position per source column).
  const { data: searchedSourceColumns } = useColumns(
    tcFromSource(searchedSource),
  );
  const chartSourceId = searchedConfig.source ?? '';

  // Berg / Task 9: a Berg Source either declares a `timestampColumn`
  // (Athena/Iceberg field name) or omits it. When set, the page renders
  // the time-picker + histogram + time-DESC default sort. When unset,
  // the time-related UI is hidden and the row table behaves as a flat
  // browser ordered by `defaultSort` (or the first column).
  //
  // We fall back to the legacy `timestampValueExpression` so older
  // Source documents keep working.
  const hasTimestamp = !!searchedSource?.timestampColumn;

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

  const [isFilterSidebarCollapsed, setIsFilterSidebarCollapsed] =
    useLocalStorage<boolean>('isFilterSidebarCollapsed', false);

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

  const { control, setValue, reset, handleSubmit, formState } =
    useForm<SearchConfigFromSchema>({
      values: {
        select: searchedConfig.select || '',
        where: searchedConfig.where || '',
        whereLanguage:
          searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
        source: searchedConfig.source || (savedSearchId ? '' : defaultSourceId),
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
        _savedSearch?.select ??
        (searchedSource?.defaultColumns
          ? searchedSource.defaultColumns.join(', ')
          : '*'),
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

    // Berg / Task 9: catalog deep-link — if /search?catalog=&database=&table=
    // matches an existing Source, switch to it. Otherwise the page renders a
    // banner suggesting "Save this table as a Source" (see header below).
    const params = new URLSearchParams(window.location.search);
    const catalog = params.get('catalog');
    const database = params.get('database');
    const table = params.get('table');
    if (savedSearchId == null && catalog && database && table) {
      const matched = sources?.find(
        s =>
          (s as any).catalog === catalog &&
          (s as any).database === database &&
          (s as any).table === table,
      );
      if (matched && matched.id !== source) {
        setSearchedConfig({
          source: matched.id,
          where: '',
          select: '',
          whereLanguage: getStoredLanguage() ?? 'lucene',
          filters: [],
          orderBy: '',
        });
        return;
      }
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

  // Berg / Task 9: read deep-link params and surface a banner when the
  // referenced table has no Source yet — gives the user a one-click path
  // to save it. The banner is rendered inside the page header further down.
  // We re-derive whenever the URL source param changes — the deep-link
  // params are ambient on window.location so we tag the dep manually.
  const deepLinkParams = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const catalog = params.get('catalog');
    const database = params.get('database');
    const table = params.get('table');
    if (!catalog || !database || !table) return null;
    return { catalog, database, table };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedConfig.source]);

  const deepLinkHasMatchingSource = useMemo(() => {
    if (!deepLinkParams || !sources) return false;
    return sources.some(
      s =>
        (s as any).catalog === deepLinkParams.catalog &&
        (s as any).database === deepLinkParams.database &&
        (s as any).table === deepLinkParams.table,
    );
  }, [deepLinkParams, sources]);

  const [_queryErrors, setQueryErrors] = useState<{
    [key: string]: Error | ClickHouseQueryError;
  }>({});

  // Berg / Task 9: cost-line state. Populated by useSearchQuery once the
  // row table is migrated off the legacy ClickHouse path; until then the
  // line just shows "Athena".
  const [searchCostStats] = useState<{
    scannedBytes?: number;
    cached?: boolean;
  } | null>(null);

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
  // Resolver: Athena/Trino synthetic column refs (`_col<N>`) → underlying
  // SELECT expression. Used so filter state never holds a result-set
  // synthetic name; URL/chip/facet labels then reflect the real expression.
  const watchedSelect = useWatch({ name: 'select', control });
  const sourceColumnCount = searchedSourceColumns?.length ?? 0;
  const resolveSyntheticColRef = useCallback(
    (key: string): string => {
      const m = /^_col(\d+)$/.exec(key);
      if (!m) return key;
      const selectStr =
        typeof watchedSelect === 'string'
          ? watchedSelect
          : (searchedConfig.select ?? '');
      if (!selectStr || sourceColumnCount <= 0) return key;
      const exprs = splitAndTrimWithBracket(selectStr);
      const nonStarExprs = exprs.filter(
        e => e.trim() !== '*' && !/\bAS\s+\S/i.test(e),
      );
      const i = Number(m[1]) - sourceColumnCount;
      return i >= 0 && i < nonStarExprs.length ? nonStarExprs[i] : key;
    },
    [watchedSelect, searchedConfig.select, sourceColumnCount],
  );
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange: handleSetFilters,
    resolveKey: resolveSyntheticColRef,
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
  const chartSearchConfig = useMemo(
    () => ({
      select: searchedConfig.select ?? '',
      source: chartSourceId,
      where: searchedConfig.where ?? '',
      whereLanguage:
        searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
      filters: rewriteSyntheticColRefsInFilters(
        searchedConfig.filters ?? [],
        searchedConfig.select ?? '',
        searchedSourceColumns?.length ?? 0,
      ),
      orderBy: searchedConfig.orderBy ?? '',
    }),
    [
      chartSourceId,
      searchedConfig.filters,
      searchedConfig.orderBy,
      searchedConfig.select,
      searchedConfig.where,
      searchedConfig.whereLanguage,
      searchedSourceColumns,
    ],
  );

  const { data: chartConfig, isLoading: isChartConfigLoading } =
    useSearchedConfigToChartConfig(chartSearchConfig, defaultSearchConfig);

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

  const displayedColumns = useMemo(() => {
    // `select` is typed as `string | DerivedColumn[]` upstream, but in the
    // search page we always supply a string. Guard for type safety.
    const rawSelect =
      dbSqlRowTableConfig?.select ?? defaultSearchConfig.select ?? '';
    return splitAndTrimWithBracket(
      typeof rawSelect === 'string' ? rawSelect : '',
    );
  }, [dbSqlRowTableConfig?.select, defaultSearchConfig.select]);

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

  useEffect(() => {
    if (isReady && queryReady && !isChartConfigLoading) {
      // Only trigger if we haven't searched yet (no time range in URL)
      const searchParams = new URLSearchParams(window.location.search);
      if (!searchParams.has('from') && !searchParams.has('to')) {
        onSearch('Live Tail');
      }
    }
  }, [isReady, queryReady, isChartConfigLoading, onSearch]);

  // Berg / Trino: WITH is CTE-only, no per-expression alias binding.
  // The CH-era pattern of feeding `aliasMapToWithClauses(...)` into the
  // chart config emitted `WITH (expr) AS "alias"` which Trino rejects
  // with SYNTAX_ERROR.  Histograms and filter charts don't reference
  // user-typed aliases (they're `count()` / value-distribution queries
  // over the same time range), so dropping the WITH entirely is
  // correct — we just stop passing it.
  const histogramTimeChartConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    // NOTE (Berg / Task 9): the histogram is only meaningful for sources
    // that carry a timestamp column. Source-kind-specific groupBy logic
    // (severity for logs, status for traces) was dropped along with the
    // observability strip; charts now group purely by user choice.
    const variableConfig: any = {};

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
      // Preserve the original table select string for "View Events" links
      eventTableSelect: searchedConfig.select,
      // In live mode, when the end date is aligned to the granularity, the end date does
      // not change on every query, resulting in cached data being re-used.
      alignDateRangeToGranularity: !isLive,
      ...variableConfig,
    };
  }, [chartConfig, searchedTimeRange, searchedConfig.select, isLive]);

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
      // Athena/Trino auto-names unaliased SELECT expressions in the
      // result set as `_col0`, `_col1`, …  Those labels exist only on
      // the response metadata — they cannot be referenced from
      // ORDER BY against the underlying table.  When the user
      // click-sorts a column whose id matches that pattern, look up
      // the original SELECT expression by ordinal so we emit
      // `ORDER BY <expression>` (Trino-legal) instead of
      // `ORDER BY _col0` (COLUMN_NOT_FOUND).
      const resolveSortColumn = (id: string): string => {
        const m = /^_col(\d+)$/.exec(id);
        if (!m) return id;
        const ordinal = Number(m[1]);
        const selectStr =
          typeof searchedConfig.select === 'string'
            ? searchedConfig.select
            : '';
        const expressions = splitAndTrimWithBracket(selectStr);
        return expressions[ordinal] ?? id;
      };
      setSearchedConfig({
        orderBy: sort
          ? `${resolveSortColumn(sort.id)} ${sort.desc ? 'DESC' : 'ASC'}`
          : defaultSearchConfig.orderBy,
      });
    },
    [
      setIsLive,
      defaultSearchConfig.orderBy,
      setSearchedConfig,
      searchedConfig.select,
    ],
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

  const filtersChartConfig = useMemo<BuilderChartConfigWithDateRange>(() => {
    const overrides = {
      orderBy: undefined,
      dateRange: searchedTimeRange,
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
  }, [chartConfig, searchedTimeRange]);

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

  const onEditSources = useCallback(() => {
    if (IS_LOCAL_MODE) {
      setModelFormExpanded(v => !v);
    } else {
      router.push('/team');
    }
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
      <OnboardingModal />
      {deepLinkParams && !deepLinkHasMatchingSource && (
        <Box
          p="sm"
          mx="sm"
          mt="sm"
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 4,
          }}
          data-testid="catalog-deeplink-cta"
        >
          <Group justify="space-between" align="center">
            <Text size="sm">
              No saved Source for{' '}
              <Code>
                {deepLinkParams.catalog}.{deepLinkParams.database}.
                {deepLinkParams.table}
              </Code>{' '}
              yet.
            </Text>
            <Button
              size="xs"
              variant="primary"
              onClick={openNewSourceModal}
              data-testid="save-as-source-cta"
            >
              Save this table as a Source
            </Button>
          </Group>
        </Box>
      )}
      {savedSearch && (
        <Stack mt="lg" mx="xs">
          <Group justify="space-between">
            <Breadcrumbs fz="sm">
              <Anchor component={Link} href="/search/list" fz="sm" c="dimmed">
                Saved Searches
              </Anchor>
              <Text fz="sm" c="dimmed" maw={400} truncate="end">
                {savedSearch.name}
              </Text>
            </Breadcrumbs>
            <Text size="xs" c="dimmed" lh={1}>
              {savedSearch.createdBy && (
                <span>
                  Created by{' '}
                  {savedSearch.createdBy.name || savedSearch.createdBy.email}.{' '}
                </span>
              )}
              {savedSearch.updatedAt && (
                <Tooltip
                  label={
                    <>
                      <FormatTime
                        value={savedSearch.updatedAt}
                        format="short"
                      />
                      {savedSearch.updatedBy
                        ? ` by ${savedSearch.updatedBy.name || savedSearch.updatedBy.email}`
                        : ''}
                    </>
                  }
                >
                  <span>{`Updated ${formatDistanceToNow(new Date(savedSearch.updatedAt), { addSuffix: true })}.`}</span>
                </Tooltip>
              )}
            </Text>
          </Group>
          <Group justify="space-between" align="flex-end">
            <div data-testid="saved-search-name">
              <EditablePageName
                key={savedSearch.id}
                name={savedSearch?.name ?? 'Untitled Search'}
                onSave={editedName => {
                  updateSavedSearch.mutate({
                    id: savedSearch.id,
                    name: editedName,
                  });
                }}
              />
            </div>

            <Group gap="xs">
              <FavoriteButton
                resourceType="savedSearch"
                resourceId={savedSearch.id}
              />
              <Tags
                allowCreate
                values={savedSearch.tags || []}
                onChange={handleUpdateTags}
              >
                <Button
                  data-testid="tags-button"
                  variant="secondary"
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
                      router.push('/search/list');
                    },
                  });
                }}
                onClickSaveAsNew={() => {
                  setSaveSearchModalState('create');
                }}
              />
            </Group>
          </Group>
        </Stack>
      )}
      <form
        data-testid="search-form"
        onSubmit={onFormSubmit}
        className={searchPageStyles.searchForm}
      >
        {/* <DevTool control={control} /> */}
        <Flex gap="sm" px="sm" pt="sm" wrap="nowrap">
          <SourceSelectControlled
            key={`${savedSearchId}`}
            size="xs"
            control={control}
            name="source"
            onCreate={openNewSourceModal}
            onEdit={onEditSources}
            data-testid="source-selector"
            sourceSchemaPreview={sourceSchemaPreview}
            style={{ minWidth: 150 }}
          />
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
          </>
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
        <Flex gap="sm" mt="sm" px="sm" wrap="wrap">
          <SearchWhereInput
            tableConnection={inputSourceTableConnection}
            control={control}
            name="where"
            onSubmit={onSubmit}
            sqlQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_SQL}
            luceneQueryHistoryType={QUERY_LOCAL_STORAGE.SEARCH_LUCENE}
            enableHotkey
            data-testid="search-input"
            minWidth="min(600px, 100%)"
          />
          <Flex
            gap="sm"
            style={{ flex: '0 1 500px', minWidth: 0 }}
            align="center"
          >
            {hasTimestamp ? (
              <>
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
                  width="100%"
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
                          setRefreshFrequency(
                            value ? parseInt(value, 10) : null,
                          )
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
              </>
            ) : (
              <Text
                size="xs"
                c="dimmed"
                data-testid="no-time-field-label"
                style={{ flex: '1 1 auto' }}
              >
                no time field
              </Text>
            )}
            <SearchSubmitButton isFormStateDirty={formState.isDirty} />
          </Flex>
        </Flex>
        <ActiveFilterPills searchFilters={searchFilters} mt={6} />
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
          <EmptyState
            h="100%"
            icon={<IconStack2 size={32} />}
            title="No data to display"
            description="Select a source and click the play button to query data."
          />
        ) : (
          <>
            <div
              className={searchPageStyles.searchPageContainer}
              style={{
                minHeight: 0,
                height: '100%',
              }}
            >
              {!isFilterSidebarCollapsed && (
                <ErrorBoundary message="Unable to render search filters">
                  <DBSearchPageFilters
                    denoiseResults={denoiseResults}
                    setDenoiseResults={setDenoiseResults}
                    isLive={isLive}
                    analysisMode={analysisMode}
                    setAnalysisMode={setAnalysisMode}
                    chartConfig={filtersChartConfig}
                    sourceId={inputSourceObj?.id}
                    showDelta={false}
                    onColumnToggle={toggleColumn}
                    displayedColumns={displayedColumns}
                    onCollapse={() => setIsFilterSidebarCollapsed(true)}
                    {...searchFilters}
                  />
                </ErrorBoundary>
              )}
              {analysisMode === 'pattern' &&
                histogramTimeChartConfig != null && (
                  <Flex direction="column" w="100%" gap="0px" mih="0" miw={0}>
                    <Box className={searchPageStyles.searchStatsContainer}>
                      <Group
                        justify="space-between"
                        align="center"
                        style={{ width: '100%' }}
                      >
                        <SearchResultsCountGroup
                          isFilterSidebarCollapsed={isFilterSidebarCollapsed}
                          onExpandFilters={() =>
                            setIsFilterSidebarCollapsed(false)
                          }
                          histogramTimeChartConfig={histogramTimeChartConfig}
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
                    {!hasQueryError && hasTimestamp && (
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
                          showDateRangeIndicator={false}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          onTimeRangeSelect={handleTimeRangeSelect}
                        />
                      </Box>
                    )}
                    {/* Berg has no log-pattern table view. */}
                  </Flex>
                )}
              {/* NOTE (Berg / Task 9): the trace-latency-heatmap delta mode
                  was observability-specific and has been removed. */}
              {analysisMode === 'results' && (
                <Flex direction="column" mih="0" miw={0}>
                  {chartConfig && histogramTimeChartConfig && (
                    <>
                      <Box className={searchPageStyles.searchStatsContainer}>
                        <Group
                          justify="space-between"
                          align="center"
                          style={{ width: '100%' }}
                        >
                          <SearchResultsCountGroup
                            isFilterSidebarCollapsed={isFilterSidebarCollapsed}
                            onExpandFilters={() =>
                              setIsFilterSidebarCollapsed(false)
                            }
                            histogramTimeChartConfig={histogramTimeChartConfig}
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
                      {!hasQueryError && hasTimestamp && (
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
                                <Fragment key={s.corrected()}>
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
                                </Fragment>
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
                              <SQLPreview
                                data={queryError.query}
                                formatData
                                enableLineWrapping
                              />
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
                            enableSmallFirstWindow
                          />
                        )}
                    </Box>
                  )}
                </Flex>
              )}
            </div>
          </>
        )}
        {/* Berg / Task 9: cost line — Athena workgroup-level scan stats.
            The exact bytes-scanned + cache flags come from the
            /api/v1/query response; until the row table is ported off
            DBSqlRowTable and onto useSearchQuery, this stays as a
            placeholder that surfaces the engine name. */}
        <Box
          px="sm"
          py={4}
          data-testid="search-cost-line"
          style={{
            borderTop: '1px solid var(--mantine-color-default-border)',
          }}
        >
          <Text size="xs" c="dimmed">
            Athena
            {searchCostStats?.scannedBytes != null && (
              <>
                {' · scanned '}
                {formatBytesShort(searchCostStats.scannedBytes)}
              </>
            )}
            {searchCostStats?.cached ? ' · cached' : ''}
          </Text>
        </Box>
      </Flex>
    </Flex>
  );
}

// Berg / Task 9: format bytes to a short MB/GB string for the cost line.
function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const DBSearchPageDynamic = dynamic(async () => DBSearchPage, { ssr: false });

// @ts-ignore
DBSearchPageDynamic.getLayout = withAppNav;

export default DBSearchPageDynamic;
