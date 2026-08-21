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
import router from 'next/router';
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
import { zodResolver } from '@hookform/resolvers/zod';
import HyperDX from '@hyperdx/browser';
import {
  ClickHouseQueryError,
  ColumnMeta,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderBuilderConfigAsSqlTemplate } from '@hyperdx/common-utils/dist/core/builderToRawSql';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  aliasMapToWithClauses,
  isBrowser,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  isLogSource,
  isMetricSource as isMetricSourceGuard,
  isTraceSource,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Code,
  Flex,
  Grid,
  Group,
  Menu,
  Modal,
  Paper,
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
  IconArrowBarToRight,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCode,
  IconDotsVertical,
  IconDownload,
  IconLayoutGridAdd,
  IconPlayerPlay,
  IconPlus,
  IconStack2,
  IconTags,
  IconX,
} from '@tabler/icons-react';
import { keepPreviousData, useIsFetching } from '@tanstack/react-query';
import { SortingState } from '@tanstack/react-table';
import CodeMirror from '@uiw/react-codemirror';

import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import { ContactSupportText } from '@/components/ContactSupportText';
import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';
import { cleanClickHouseExpression } from '@/components/DBSearchPageFilters/utils';
import { DBTimeChart, type SeriesGroupFilter } from '@/components/DBTimeChart';
import EmptyState from '@/components/EmptyState';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { FavoriteButton } from '@/components/FavoriteButton';
import { InputControlled } from '@/components/InputControlled';
import OnboardingModal from '@/components/OnboardingModal';
import { SavedSearchesFlyout } from '@/components/SavedSearches/SavedSearchesFlyout';
import SaveToDashboardModal from '@/components/SaveToDashboardModal';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { useSearchTotalCount } from '@/components/SearchTotalCountChart';
import { TableSourceForm } from '@/components/Sources/SourceForm';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { Tags } from '@/components/Tags';
import { TimePicker } from '@/components/TimePicker';
import { IS_LOCAL_MODE } from '@/config';
import { useAliasMapFromChartConfig } from '@/hooks/useChartConfig';
import { useExplainQuery } from '@/hooks/useExplainQuery';
import { withAppNav } from '@/layout';
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearch,
  useUpdateSavedSearch,
} from '@/savedSearch';
import { useSearchPageFilterState } from '@/searchFilters';
import { getEventBody, useSource, useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import {
  parseRelativeTimeQuery,
  parseTimeQuery,
  useNewTimeQuery,
} from '@/timeQuery';
import { formatDurationMs, useLocalStorage, usePrevious } from '@/utils';

import ChartSQLPreview, { SQLPreview } from './components/ChartSQLPreview';
import { DBBarChart } from './components/DBBarChart';
import DBNumberChart from './components/DBNumberChart';
import { DBPieChart } from './components/DBPieChart';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import DBTableChart from './components/DBTableChart';
import { DBTreemapChart } from './components/DBTreemapChart';
import { ExploreContextBand } from './components/Explore/ExploreContextBand';
import { ExploreQueryEditor } from './components/Explore/ExploreQueryEditor';
import { ExploreResultsToolbar } from './components/Explore/ExploreResultsToolbar';
import { ExploreSeriesList } from './components/Explore/ExploreSeriesList';
import { type QueryConfigMode } from './components/Explore/QueryEditor';
import { SeveritySummary } from './components/Explore/SeveritySummary';
import PatternTable from './components/PatternTable';
import { DBSearchHeatmapChart } from './components/Search/DBSearchHeatmapChart';
import DirectTraceSidePanel from './components/Search/DirectTraceSidePanel';
import {
  type AggSortField,
  exploreSeriesHaveMetricNames,
  useSearchAggConfig,
} from './components/Search/SearchAggControls';
import { SearchColumnPicker } from './components/Search/SearchColumnPicker';
import { SearchSortMenu } from './components/Search/SearchSortMenu';
import {
  isAggregatedSearchView,
  SearchViewSwitcher,
  searchViewToDisplayType,
  useSearchView,
  viewShowsHistogram,
} from './components/Search/searchViews';
import SourceSchemaPreview, {
  isSourceSchemaPreviewEnabled,
} from './components/SourceSchemaPreview';
import {
  getRelativeTimeOptionLabel,
  LIVE_TAIL_DURATION_MS,
} from './components/TimePicker/utils';
import {
  useColumns,
  useMetadataWithSettings,
  useResolvedDateTimeColumns,
  useTableMetadata,
} from './hooks/useMetadata';
import { useSqlSuggestions } from './hooks/useSqlSuggestions';
import { useStableCallback } from './hooks/useStableCallback';
import {
  buildDirectTraceWhereClause,
  getDefaultDirectTraceDateRange,
} from './utils/directTrace';
import {
  parseAsJsonEncoded,
  parseAsSortingStateString,
  parseAsStringEncoded,
} from './utils/queryParsers';
import { LOCAL_STORE_CONNECTIONS_KEY } from './connection';
import { DBSearchPageAlertModal } from './DBSearchPageAlertModal';
import { SearchConfig } from './types';

import searchPageStyles from '@styles/SearchPage.module.scss';

const LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS = [
  { value: '1000', label: '1s' },
  { value: '2000', label: '2s' },
  { value: '4000', label: '4s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
];
const DEFAULT_REFRESH_FREQUENCY = 10000;

const ALLOWED_SOURCE_KINDS = [
  SourceKind.Log,
  SourceKind.Trace,
  SourceKind.Metric,
];
const SearchConfigSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']),
  // Query mode: 'builder' edits only the WHERE predicate (SQL/Lucene) and lets
  // the page assemble the rest; 'sql' is a full raw-SQL statement (sqlTemplate).
  configType: z.enum(['builder', 'sql']),
  sqlTemplate: z.string(),
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

// Clicks inside the results panel keep the row side panel open (so users can
// scroll the table or select a different row); clicks anywhere else on the page
// dismiss it.
const SEARCH_RESULTS_PANEL_KEEP_OPEN_SELECTOR =
  '[data-testid="search-results-panel"]';

// Helper function to get the default source id
function getDefaultSourceId(
  sources: { id: string; disabled?: boolean }[] | undefined,
  lastSelectedSourceId: string | undefined,
): string {
  if (!sources || sources.length === 0) return '';

  // Filter out disabled sources
  const enabledSources = sources.filter(s => !s.disabled);
  if (enabledSources.length === 0) return '';

  if (
    lastSelectedSourceId &&
    enabledSources.some(s => s.id === lastSelectedSourceId)
  ) {
    return lastSelectedSourceId;
  }
  return enabledSources[0].id;
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

/**
 * Grafana-style live-tail control rendered inside the datetime input. The bolt
 * starts/stops streaming; when live, an attached caret opens a menu to pick the
 * auto-refresh cadence (which also resumes live if it was paused).
 */
function SearchLiveControl({
  isLive,
  refreshFrequency,
  onToggle,
  onSelectCadence,
}: {
  isLive: boolean;
  refreshFrequency: number;
  onToggle: () => void;
  onSelectCadence: (ms: number) => void;
}) {
  const cadenceLabel =
    LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS.find(
      o => o.value === String(refreshFrequency),
    )?.label ?? `${Math.round(refreshFrequency / 1000)}s`;

  // Active state is signalled with brand-colored content (matching the "Live
  // Tail" treatment in the datetime input) rather than a fill, so both segments
  // stay the same variant and read as one connected control.
  const activeContentStyles = isLive
    ? {
        label: { color: 'var(--color-text-brand)' },
        section: { color: 'var(--color-text-brand)' },
      }
    : undefined;

  return (
    <Button.Group style={{ flexShrink: 0 }}>
      <Tooltip
        label={isLive ? 'Pause live tail' : 'Start live tail'}
        position="bottom"
      >
        <Button
          data-testid="live-tail-toggle"
          size="xs"
          variant="secondary"
          leftSection={<IconBolt size={13} />}
          aria-pressed={isLive}
          onClick={onToggle}
          styles={activeContentStyles}
        >
          Live
        </Button>
      </Tooltip>
      {isLive && (
        <Menu position="bottom-end" withinPortal shadow="md" width={150}>
          <Menu.Target>
            <Button
              data-testid="live-tail-cadence"
              aria-label="Live tail refresh interval"
              size="xs"
              variant="secondary"
              leftSection={<IconClock size={13} />}
              rightSection={<IconChevronDown size={12} />}
            >
              {cadenceLabel}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Refresh every</Menu.Label>
            {LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS.map(o => (
              <Menu.Item
                key={o.value}
                onClick={() => onSelectCadence(parseInt(o.value, 10))}
                rightSection={
                  String(refreshFrequency) === o.value ? (
                    <IconCheck size={14} />
                  ) : null
                }
              >
                {o.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Button.Group>
  );
}

function SearchRunControl({ isFormStateDirty }: { isFormStateDirty: boolean }) {
  return (
    <Button
      data-testid="search-submit-button"
      variant={isFormStateDirty ? 'primary' : 'secondary'}
      type="submit"
      leftSection={<IconPlayerPlay size={16} />}
      style={{ flexShrink: 0 }}
      size="xs"
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

// Abbreviate large scanned-row counts (1,157,950 -> "1.16M") to keep the stats
// line short. The headline result count stays fully grouped for precision.
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

// Single compact stats line for the results band: "<count> results ·
// <scanned> scanned · <elapsed>". Folds the result count (count query),
// scanned rows (EXPLAIN) and elapsed time into one dimmed line with the count
// emphasized, instead of three labeled fragments.
function ResultsStats({
  countConfig,
  explainConfig,
  enabled,
  searchElapsedMs,
  isSearching,
  isLiveTail = false,
}: {
  countConfig: BuilderChartConfigWithDateRange;
  explainConfig: ChartConfigWithDateRange;
  enabled: boolean;
  searchElapsedMs: number | null;
  isSearching: boolean;
  isLiveTail?: boolean;
}) {
  const {
    totalCount,
    isLoading: isCountLoading,
    isError: isCountError,
  } = useSearchTotalCount(countConfig, QUERY_KEY_PREFIX, {
    enableParallelQueries: true,
  });

  const { data, error: explainError } = useExplainQuery(explainConfig, {
    enabled,
    // Keep the previous row count on screen while a new EXPLAIN runs so the
    // scanned-rows value doesn't flash on every live-tail poll (each poll
    // changes the dateRange, and thus the query key).
    placeholderData: keepPreviousData,
  });

  if (!enabled) {
    return null;
  }

  const numRows = data?.[0]?.rows;
  const scanned =
    !explainError && numRows != null
      ? compactNumberFormatter.format(Number(numRows))
      : null;

  // During live tail we keep showing the last measured elapsed time and never
  // flash the loading state, so the value doesn't flicker between polls.
  const showElapsedLoading = isSearching && !isLiveTail;
  const showElapsed = showElapsedLoading || searchElapsedMs != null;

  const separator = (
    <Text span size="xs" c="dimmed" aria-hidden>
      &middot;
    </Text>
  );

  return (
    <Group
      gap={6}
      align="center"
      wrap="nowrap"
      data-testid="search-total-count"
    >
      <Text size="xs" c="dimmed">
        <Text span size="xs" fw={600} c="var(--mantine-color-text)">
          {isCountLoading ? (
            <span className="effect-pulse">&middot;&middot;&middot;</span>
          ) : totalCount != null && !isCountError ? (
            totalCount.toLocaleString('en-US')
          ) : (
            '0'
          )}
        </Text>{' '}
        results
      </Text>
      {scanned != null && (
        <>
          {separator}
          <Text size="xs" c="dimmed">
            {scanned} scanned
          </Text>
        </>
      )}
      {showElapsed && (
        <>
          {separator}
          <Text size="xs" c="dimmed">
            {showElapsedLoading ? (
              <span className="effect-pulse">&middot;&middot;&middot;</span>
            ) : (
              formatDurationMs(searchElapsedMs!)
            )}
          </Text>
        </>
      )}
    </Group>
  );
}

// Overflow (3-dots) menu for secondary results actions. Holds "Show generated
// SQL" (opens a modal for the current results/timeline config) and "Export".
// Kept out of the main controls row so it stays uncluttered.
function ResultsOverflowMenu({
  config,
  sqlConfig,
  showGeneratedSql = true,
}: {
  config: ChartConfigWithDateRange;
  sqlConfig?: ChartConfigWithDateRange;
  showGeneratedSql?: boolean;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={sqlConfig != null ? 'Generated SQL (Timeline)' : 'Generated SQL'}
        size="xl"
      >
        <ChartSQLPreview config={sqlConfig ?? config} enableCopy />
      </Modal>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            variant="secondary"
            size="xs"
            px={8}
            aria-label="More actions"
            data-testid="results-overflow-menu"
          >
            <IconDotsVertical size={16} />
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {showGeneratedSql && (
            <Menu.Item
              leftSection={<IconCode size={16} />}
              onClick={open}
              data-testid="generated-sql-button"
            >
              Show generated SQL
            </Menu.Item>
          )}
          <Menu.Item
            leftSection={<IconDownload size={16} />}
            disabled
            data-testid="export-button"
          >
            Export (coming soon)
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}

// "Add to dashboard" action for chart-tile views. Opens the shared
// SaveToDashboardModal with the current aggregation rendered as a tile config.
function AddToDashboardButton({ config }: { config: SavedChartConfig }) {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <>
      <SaveToDashboardModal
        chartConfig={config}
        opened={opened}
        onClose={close}
      />
      <Button
        variant="secondary"
        size="xs"
        onClick={open}
        leftSection={<IconLayoutGridAdd size={14} />}
        data-testid="add-to-dashboard-button"
      >
        Add to dashboard
      </Button>
    </>
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
    kinds: [SourceKind.Log, SourceKind.Trace],
  });
  const effectiveSelect =
    searchedConfig.select || sourceObj?.defaultTableSelectExpression || '';

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
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'sql',
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
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'sql',
            source: searchedConfig.source ?? '',
            orderBy: searchedConfig.orderBy ?? '',
            filters: searchedConfig.filters ?? [],
            tags: tags,
          });

          router.push(`/explore/${savedSearch.id}${window.location.search}`);
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
    kinds: [SourceKind.Log, SourceKind.Trace, SourceKind.Metric],
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

function useDefaultOrderBy(sourceID: string | undefined | null) {
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

function formatDroppedFiltersMessage(count: number): string {
  const noun = count === 1 ? 'filter' : 'filters';
  const verb = count === 1 ? 'was' : 'were';
  return `${count} ${noun} didn't apply to this source and ${verb} removed.`;
}

// This is outside as it needs to be a stable reference
const queryStateMap = {
  source: parseAsString,
  where: parseAsStringEncoded,
  select: parseAsStringEncoded,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  configType: parseAsStringEnum<'builder' | 'sql'>(['builder', 'sql']),
  sqlTemplate: parseAsStringEncoded,
  filters: parseAsJsonEncoded<Filter[]>(),
  orderBy: parseAsStringEncoded,
};

function useSearchTelemetry({
  isAnyQueryFetching,
  isLive,
  sourceId,
}: {
  isAnyQueryFetching: boolean;
  /** When true the hook suppresses recording and emission so live-tail
   * background refetches do not flood the metric. */
  isLive: boolean;
  sourceId: string | null;
}) {
  const searchStartTimeRef = useRef<number | null>(null);
  const wasFetchingRef = useRef(false);
  // Whether the in-flight cycle began as a live-tail refresh, captured on the
  // rising edge so a mid-cycle isLive flip can't change how it's treated.
  const cycleIsLiveRef = useRef(false);

  // Snapshot latency_ms and source_id together so a later sourceId change does
  // not cause the emission effect to re-fire with stale latency data. `emit`
  // records whether this cycle should be reported to telemetry (user-initiated
  // searches only); latency is still surfaced for display in every case.
  const [completedSearch, setCompletedSearch] = useState<{
    latency_ms: number;
    source_id: string;
    emit: boolean;
  } | null>(null);

  useEffect(() => {
    if (isAnyQueryFetching) {
      // Start the timer once per fetch cycle (for live tail too — we display
      // its elapsed time, we just don't emit telemetry for it).
      if (!wasFetchingRef.current) {
        searchStartTimeRef.current = performance.now();
        cycleIsLiveRef.current = isLive;
        // Only blank the displayed timer for user-initiated searches. During
        // live tail we keep the previous value so it doesn't flicker between
        // background refreshes.
        if (!isLive) {
          setCompletedSearch(null);
        }
      }
      wasFetchingRef.current = true;
    } else {
      if (searchStartTimeRef.current != null) {
        setCompletedSearch({
          latency_ms: Math.round(
            performance.now() - searchStartTimeRef.current,
          ),
          source_id: sourceId ?? '',
          emit: !cycleIsLiveRef.current,
        });
        searchStartTimeRef.current = null;
      }
      wasFetchingRef.current = false;
    }
  }, [isAnyQueryFetching, isLive, sourceId]);

  // completedSearch is the only dep here — sourceId was snapshotted at
  // completion time so changing source after a finished search does not
  // re-emit the previous run's latency against the new source. Live-tail
  // cycles are recorded for display but flagged emit=false so they never flood
  // telemetry.
  useEffect(() => {
    if (completedSearch == null || !completedSearch.emit) return;
    HyperDX.addAction('search executed', {
      latency_ms: completedSearch.latency_ms,
      source_id: completedSearch.source_id,
    });
  }, [completedSearch]);

  return { searchElapsedMs: completedSearch?.latency_ms ?? null };
}

function DBExplorePage() {
  const brandName = useBrandDisplayName();
  // Next router is laggy behind window.location, which causes race
  // conditions with useQueryStates, so we'll parse it directly
  const paths = window.location.pathname.split('/');
  const savedSearchId = paths.length === 3 ? paths[2] : null;

  const [searchedConfig, setSearchedConfig] = useQueryStates(queryStateMap);
  const [directTraceId, setDirectTraceId] = useQueryState(
    'traceId',
    parseAsStringEncoded,
  );

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
    kinds: [SourceKind.Log, SourceKind.Trace, SourceKind.Metric],
  });
  const directTraceSource =
    directTraceId != null && searchedSource?.kind === SourceKind.Trace
      ? searchedSource
      : undefined;
  // Metric sources have no raw rows to list — only aggregated chart views are
  // available, and the value expression is chosen via a metric name picker.
  const searchedMetricSource =
    searchedSource?.kind === SourceKind.Metric
      ? (searchedSource as TMetricSource)
      : undefined;
  const isMetricSource = searchedMetricSource != null;
  const chartSourceId =
    directTraceId != null && !directTraceSource
      ? ''
      : (searchedConfig.source ?? '');

  const [view, setView] = useSearchView();
  const [aggConfig, setAggConfig] = useSearchAggConfig();

  // Submitted query mode: drives query *execution* (the raw-SQL chart config)
  // so results only change on Run. The live form value (`isSqlUiMode`, defined
  // once the form exists) gates the SQL-mode UI/chrome instead.
  const searchedConfigType: QueryConfigMode =
    searchedConfig.configType ?? 'builder';
  const isSqlMode = searchedConfigType === 'sql';

  // Legacy 3-mode value still consumed by the filters sidebar (denoise gating)
  // and a few source-capability checks below. New view types collapse onto
  // 'results' for those purposes.
  const analysisMode: 'results' | 'delta' | 'pattern' =
    view === 'patterns' ? 'pattern' : view === 'heatmap' ? 'delta' : 'results';

  const [patternColumn, setPatternColumn] = useQueryState(
    'patternColumn',
    parseAsString,
  );
  const [draftPatternColumn, setDraftPatternColumn] = useState(
    patternColumn ?? '',
  );
  useEffect(() => {
    setDraftPatternColumn(patternColumn ?? '');
  }, [patternColumn]);

  const [isLive, setIsLive] = useQueryState(
    'isLive',
    parseAsBoolean.withDefault(true),
  );

  useEffect(() => {
    // Only the raw List view supports live tail.
    if (view !== 'list') {
      setIsLive(false);
    }
  }, [view, setIsLive]);

  useEffect(() => {
    // Metric sources can't render the raw List / heatmap / patterns views, so
    // fall back to the Time series view when one of those is active.
    if (isMetricSource && !isAggregatedSearchView(view)) {
      setView('timeseries');
    }
  }, [isMetricSource, view, setView]);

  useEffect(() => {
    // SQL mode renders a single raw-SQL statement as a chart display type, so
    // the raw List / heatmap / patterns views don't apply — default to the
    // Grouped table view when one of those is active.
    if (isSqlMode && !isAggregatedSearchView(view)) {
      setView('table');
    }
  }, [isSqlMode, view, setView]);

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

  const { control, setValue, getValues, reset, handleSubmit, formState } =
    useForm<SearchConfigFromSchema>({
      values: {
        select: searchedConfig.select || '',
        where: searchedConfig.where || '',
        whereLanguage:
          searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'sql',
        configType: searchedConfig.configType ?? 'builder',
        sqlTemplate: searchedConfig.sqlTemplate ?? '',
        source:
          searchedConfig.source ||
          (savedSearchId || directTraceId ? '' : defaultSourceId),
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
        (searchedSource?.kind === SourceKind.Log ||
        searchedSource?.kind === SourceKind.Trace
          ? searchedSource.defaultTableSelectExpression
          : undefined),
      where: _savedSearch?.where ?? '',
      whereLanguage: _savedSearch?.whereLanguage ?? 'sql',
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
          searchedConfig?.whereLanguage ?? getStoredLanguage() ?? 'sql',
        configType: searchedConfig?.configType ?? 'builder',
        sqlTemplate: searchedConfig?.sqlTemplate ?? '',
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

    if (savedSearchId == null && directTraceId != null && !source) {
      return;
    }

    // Landed on a new search - ensure we have a source selected
    if (savedSearchId == null && defaultSourceId && isSearchConfigEmpty) {
      setSearchedConfig({
        source: defaultSourceId,
        where: '',
        select: '',
        whereLanguage: getStoredLanguage() ?? 'sql',
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
    directTraceId,
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
      ({
        select,
        where,
        whereLanguage,
        configType,
        sqlTemplate,
        source,
        filters,
        orderBy,
      }) => {
        setSearchedConfig({
          select,
          where,
          whereLanguage,
          configType,
          sqlTemplate,
          source,
          filters,
          orderBy,
        });
      },
    )();
    setPatternColumn(draftPatternColumn || null);
    // clear query errors
    setQueryErrors({});
  }, [
    handleSubmit,
    setSearchedConfig,
    displayedTimeInputValue,
    onSearch,
    setQueryErrors,
    draftPatternColumn,
    setPatternColumn,
  ]);

  const debouncedSubmit = useDebouncedCallback(onSubmit, 1000);
  const handleSetFilters = useCallback(
    (filters: Filter[]) => {
      setValue('filters', filters);
      debouncedSubmit();
    },
    [debouncedSubmit, setValue],
  );

  // Top-level column names for the active source, used to quote
  // filter keys that contain special characters.
  const { data: inputSourceColumns } = useColumns(
    {
      databaseName: inputSourceObj?.from?.databaseName ?? '',
      tableName: inputSourceObj?.from?.tableName ?? '',
      connectionId: inputSourceObj?.connection ?? '',
    },
    { enabled: !!inputSourceObj },
  );
  const knownColumns = useMemo(
    () =>
      inputSourceColumns
        ? new Set(inputSourceColumns.map(c => c.name))
        : new Set<string>(),
    [inputSourceColumns],
  );

  const watchedSource = useWatch({
    control,
    name: 'source',
    // Watch will reset when changing saved search, so we need to default to the URL
    defaultValue: searchedConfig.source ?? undefined,
  });
  const prevSourceRef = useRef(watchedSource);
  // Set when the user switches sources via the dropdown. The follow-up
  // effect waits for the new source's columns to load and then drops any
  // sidebar filters that don't apply to the new schema.
  const pendingFilterReconcileRef = useRef<string | null>(null);

  const watchedSourceObj = useMemo(
    () => inputSourceObjs?.find(s => s.id === watchedSource),
    [inputSourceObjs, watchedSource],
  );
  const { data: watchedSourceColumns } = useColumns(
    {
      databaseName: watchedSourceObj?.from?.databaseName ?? '',
      tableName: watchedSourceObj?.from?.tableName ?? '',
      connectionId: watchedSourceObj?.connection ?? '',
    },
    { enabled: !!watchedSourceObj },
  );

  const { dateTimeColumns, onResolvedColumnsChange } =
    useResolvedDateTimeColumns(inputSourceColumns);

  const filters = useWatch({ name: 'filters', control });
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange: handleSetFilters,
    dateTimeColumns,
    knownColumns,
  });

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
          // Defer filter clearing: wait until the new source's columns load,
          // then keep filters whose root column exists on the new schema.
          pendingFilterReconcileRef.current = watchedSource ?? null;
          // If the user is in a saved search, prefer the saved search's select/orderBy if available
        } else {
          setValue('select', savedSearch?.select ?? '');
          setValue('orderBy', savedSearch?.orderBy ?? '');
          // Don't clear filters - we're loading from saved search
        }
        // Push the new source to URL/searchedConfig so the chart re-queries.
        // Debounced so a later filter reconcile (which also submits) collapses
        // into a single run.
        debouncedSubmit();
      }
    }
  }, [
    watchedSource,
    setValue,
    savedSearch,
    savedSearchId,
    inputSourceObjs,
    setLastSelectedSourceId,
    debouncedSubmit,
  ]);

  const retainCompatibleFilters = useStableCallback((columns: ColumnMeta[]) => {
    pendingFilterReconcileRef.current = null;

    const allowed = new Set(columns.map(c => c.name));

    const dropped = searchFilters.retainFiltersByColumns(allowed);

    if (dropped.length > 0) {
      notifications.show({
        color: 'yellow',
        message: formatDroppedFiltersMessage(dropped.length),
      });
    }
  });

  useEffect(() => {
    if (
      pendingFilterReconcileRef.current === watchedSource &&
      watchedSourceColumns
    ) {
      retainCompatibleFilters(watchedSourceColumns);
    }
  }, [watchedSource, watchedSourceColumns, retainCompatibleFilters]);

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
  const [
    savedSearchesFlyoutOpened,
    { open: openSavedSearchesFlyout, close: closeSavedSearchesFlyout },
  ] = useDisclosure(false);
  const chartSearchConfig = useMemo(
    () => ({
      select: searchedConfig.select ?? '',
      source: chartSourceId,
      where: searchedConfig.where ?? '',
      whereLanguage:
        searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'sql',
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
  const inputConfigType: QueryConfigMode =
    useWatch({ name: 'configType', control }) ?? 'builder';
  // Live SQL-mode flag: driven by the editor toggle (not the last-run config)
  // so builder-only chrome (histogram, severity, sort/columns, agg controls,
  // view switcher) hides the instant you switch to SQL. Query *execution* still
  // keys off `isSqlMode` (submitted) so nothing re-runs until Run.
  const isSqlUiMode = inputConfigType === 'sql';
  // query suggestion for 'where' if error
  const whereSuggestions = useSqlSuggestions({
    input: inputWhere,
    enabled: hasQueryError && inputWhereLanguage === 'sql',
  });

  const queryReady =
    chartConfig?.from?.databaseName &&
    // Metric sources have an empty `from.tableName`; the real table is resolved
    // per metric type from `metricTables` at query time.
    (chartConfig?.from?.tableName || isMetricSource) &&
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
              searchedConfig.whereLanguage ?? getStoredLanguage() ?? 'sql',
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

  const { searchElapsedMs } = useSearchTelemetry({
    isAnyQueryFetching,
    isLive: isLive ?? false,
    sourceId: chartConfig?.source ?? null,
  });

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

  // Stable key for persisting column widths in localStorage. Scoped per saved
  // search when one is loaded, else per source for ad-hoc searches.
  const columnSizeTableId = savedSearchId
    ? `db-search-saved-${savedSearchId}`
    : searchedConfig.source
      ? `db-search-source-${searchedConfig.source}`
      : undefined;

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

  // Available columns for the structured Columns picker (List view).
  const availableColumns = useMemo(
    () => (inputSourceColumns ?? []).map(c => c.name),
    [inputSourceColumns],
  );

  const applyColumns = useCallback(
    (columns: string[]) => {
      setValue('select', columns.join(', '));
      onSubmit();
    },
    [setValue, onSubmit],
  );

  // Current List-view sort parsed from the orderBy string.
  const listSort = useMemo(() => {
    const parsed = parseAsSortingStateString.parse(
      searchedConfig.orderBy ?? '',
    );
    return {
      field: parsed?.id as string | undefined,
      direction: (parsed?.desc ? 'desc' : 'asc') as 'asc' | 'desc',
    };
  }, [searchedConfig.orderBy]);

  const applyListSort = useCallback(
    (field: string, direction: 'asc' | 'desc') => {
      setIsLive(false);
      setSearchedConfig({
        orderBy: `${field} ${direction === 'desc' ? 'DESC' : 'ASC'}`,
      });
    },
    [setIsLive, setSearchedConfig],
  );

  const revertListSort = useCallback(() => {
    setSearchedConfig({ orderBy: defaultSearchConfig.orderBy });
  }, [setSearchedConfig, defaultSearchConfig.orderBy]);

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

      return `/explore?${qParams.toString()}`;
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

  useEffect(() => {
    if (isReady && queryReady && !isChartConfigLoading) {
      // Only trigger if we haven't searched yet (no time range in URL)
      const searchParams = new URLSearchParams(window.location.search);
      if (
        directTraceId == null &&
        !searchParams.has('from') &&
        !searchParams.has('to')
      ) {
        onSearch('Live Tail');
      }
    }
  }, [directTraceId, isReady, queryReady, isChartConfigLoading, onSearch]);

  const { data: aliasMap } = useAliasMapFromChartConfig(dbSqlRowTableConfig);

  const aliasWith = useMemo(() => aliasMapToWithClauses(aliasMap), [aliasMap]);

  const histogramTimeChartConfig = useMemo(() => {
    if (chartConfig == null) {
      return undefined;
    }

    const variableConfig: Partial<
      Pick<BuilderChartConfigWithDateRange, 'groupBy'>
    > = {};
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
      eventTableSelect: searchedConfig.select ?? undefined,
      // Never align to granularity boundaries on the search page: the histogram
      // and total count must reflect the user's exact selected range so they
      // match the rows shown in the results table. Aligning to bucket
      // boundaries (e.g. expanding a 2s selection to a 15s bucket) inflates
      // the count beyond what the table shows. In live mode this also avoids
      // stale cached data from an unchanging aligned end date.
      alignDateRangeToGranularity: false,
      // Make sure the end date is inclusive so that the histogram and table counts match
      dateRangeEndInclusive: true,
      ...variableConfig,
    } satisfies BuilderChartConfigWithDateRange;
  }, [
    chartConfig,
    searchedSource,
    aliasWith,
    searchedTimeRange,
    searchedConfig.select,
  ]);

  // Default group-by for aggregated views, mirroring the histogram's grouping.
  const defaultAggGroupBy = useMemo(() => {
    switch (searchedSource?.kind) {
      case SourceKind.Log:
        return searchedSource?.severityTextExpression;
      case SourceKind.Trace:
        return (
          searchedSource?.statusCodeExpression ??
          searchedSource?.serviceNameExpression
        );
      default:
        return undefined;
    }
  }, [searchedSource]);

  // Builds the chart config for an aggregated view (time series / number /
  // table / bar / pie / treemap) from the current search config plus the
  // inline aggregation controls. The renderers apply their own display-type
  // conversion (convertToCategoricalChartConfig, etc.).
  const aggViewChartConfig = useMemo(() => {
    if (chartConfig == null || !isAggregatedSearchView(view)) {
      return undefined;
    }
    // Metric queries require a chosen metric name — the renderer has no query
    // path for an empty metric. Hold off until every series has one.
    if (
      searchedMetricSource &&
      !exploreSeriesHaveMetricNames(aggConfig.series)
    ) {
      return undefined;
    }
    const groupBy =
      view === 'number'
        ? undefined
        : aggConfig.groupBy.trim() || defaultAggGroupBy || undefined;
    // Categorical + summary-table views support the structured Sort menu
    // (Value = the metric, Name = the group key). Alias a single aggregate as
    // "Value" so ordering by it is stable regardless of the expression.
    const isCategoricalLike =
      view === 'table' ||
      view === 'bar' ||
      view === 'pie' ||
      view === 'treemap';

    const select = aggConfig.series.map(series => {
      const isCount = series.aggFn === 'count';
      const alias =
        series.alias ||
        (isCategoricalLike && aggConfig.series.length === 1
          ? 'Value'
          : undefined);
      return {
        ...series,
        aggCondition: series.aggCondition ?? '',
        aggConditionLanguage: series.aggConditionLanguage ?? 'lucene',
        valueExpression: searchedMetricSource
          ? 'Value'
          : isCount
            ? ''
            : (series.valueExpression ?? ''),
        ...(alias != null ? { alias } : {}),
      };
    });

    let orderBy: string | undefined;
    if (isCategoricalLike) {
      const dir = aggConfig.sortDir.toUpperCase();
      if (aggConfig.sort === 'name' && groupBy) {
        orderBy = `${groupBy} ${dir}`;
      } else if (select[0]?.alias) {
        orderBy = `"${select[0].alias}" ${dir}`;
      }
    }

    return {
      ...chartConfig,
      ...(searchedMetricSource
        ? { metricTables: searchedMetricSource.metricTables }
        : {}),
      select,
      groupBy,
      orderBy,
      granularity: view === 'timeseries' ? 'auto' : undefined,
      dateRange: searchedTimeRange,
      displayType:
        view === 'timeseries'
          ? aggConfig.chartType === 'line'
            ? DisplayType.Line
            : DisplayType.StackedBar
          : searchViewToDisplayType(view),
      with: aliasWith,
      seriesLimit: view === 'timeseries' ? undefined : aggConfig.limit,
      alignDateRangeToGranularity: false,
      dateRangeEndInclusive: true,
    } as BuilderChartConfigWithDateRange;
  }, [
    chartConfig,
    view,
    aggConfig,
    defaultAggGroupBy,
    searchedTimeRange,
    aliasWith,
    searchedMetricSource,
  ]);

  // Dashboard-tile config for the "Add to dashboard" action: reuses the
  // aggregated chart config but references the source by id (as tiles do) and
  // drops the runtime-only date range so the tile follows the dashboard's own
  // time range.
  const addToDashboardConfig = useMemo<SavedChartConfig | undefined>(() => {
    if (!aggViewChartConfig || !searchedConfig.source) {
      return undefined;
    }
    return {
      name: savedSearch?.name || 'Explore chart',
      source: searchedConfig.source,
      displayType: aggViewChartConfig.displayType,
      select: aggViewChartConfig.select,
      where: searchedConfig.where ?? '',
      whereLanguage: searchedConfig.whereLanguage ?? 'sql',
      filters: searchedConfig.filters ?? [],
      groupBy: aggViewChartConfig.groupBy,
      orderBy: aggViewChartConfig.orderBy,
      granularity: aggViewChartConfig.granularity,
      seriesLimit: aggViewChartConfig.seriesLimit,
      with: aggViewChartConfig.with,
    } as SavedChartConfig;
  }, [aggViewChartConfig, savedSearch?.name, searchedConfig]);

  // Raw-SQL config for SQL mode. Bypasses buildSearchChartConfig entirely: the
  // user-authored sqlTemplate owns the whole statement, and the source metadata
  // is carried over so macros ($__sourceTable, $__filters) resolve. The display
  // type is picked from the current chart view (aggregated views map 1:1 to raw
  // SQL display types).
  const rawSqlChartConfig = useMemo<
    (RawSqlChartConfig & { dateRange: [Date, Date] }) | undefined
  >(() => {
    if (!isSqlMode || !searchedSource || !searchedConfig.source) {
      return undefined;
    }
    const displayType = isAggregatedSearchView(view)
      ? searchViewToDisplayType(view)
      : DisplayType.Table;
    return {
      configType: 'sql',
      sqlTemplate: searchedConfig.sqlTemplate ?? '',
      connection: searchedSource.connection,
      source: searchedConfig.source,
      from: searchedSource.from,
      displayType,
      granularity: view === 'timeseries' ? 'auto' : undefined,
      dateRange: searchedTimeRange,
      filters: searchedConfig.filters ?? [],
      implicitColumnExpression:
        isLogSource(searchedSource) || isTraceSource(searchedSource)
          ? searchedSource.implicitColumnExpression
          : undefined,
      bodyExpression: isLogSource(searchedSource)
        ? searchedSource.bodyExpression
        : undefined,
      useTextIndexForImplicitColumn:
        isLogSource(searchedSource) || isTraceSource(searchedSource)
          ? searchedSource.useTextIndexForImplicitColumn
          : undefined,
      metricTables: isMetricSourceGuard(searchedSource)
        ? searchedSource.metricTables
        : undefined,
    };
  }, [
    isSqlMode,
    searchedSource,
    searchedConfig.source,
    searchedConfig.sqlTemplate,
    searchedConfig.filters,
    view,
    searchedTimeRange,
  ]);

  // Dashboard-tile config for the "Add to dashboard" action in SQL mode: a raw
  // SQL SavedChartConfig (dashboards already support configType 'sql').
  const rawSqlAddToDashboardConfig = useMemo<
    RawSqlSavedChartConfig | undefined
  >(() => {
    if (!rawSqlChartConfig) return undefined;
    return {
      name: savedSearch?.name || 'Explore SQL chart',
      configType: 'sql',
      sqlTemplate: rawSqlChartConfig.sqlTemplate,
      connection: rawSqlChartConfig.connection,
      source: searchedConfig.source ?? undefined,
      displayType: rawSqlChartConfig.displayType ?? DisplayType.Table,
      granularity: rawSqlChartConfig.granularity,
    };
  }, [rawSqlChartConfig, savedSearch?.name, searchedConfig.source]);

  const metadata = useMetadataWithSettings();

  // Builder -> SQL prefill: on first switch to SQL mode, seed the empty SQL
  // editor with a macro-based template generated from the current builder
  // config so the user starts from a working statement.
  const handleQueryModeChange = useCallback(
    (mode: QueryConfigMode) => {
      setValue('configType', mode, { shouldDirty: true });
      if (mode !== 'sql') return;
      const current = getValues('sqlTemplate');
      if (current && current.trim()) return;

      // aggViewChartConfig already has a raw-SQL-compatible display type and an
      // array select; for non-aggregated views synthesize a simple count().
      const base =
        aggViewChartConfig ??
        (chartConfig
          ? {
              ...chartConfig,
              displayType: DisplayType.Table,
              select: [
                { aggFn: 'count', aggCondition: '', valueExpression: '' },
              ],
              groupBy: undefined,
              orderBy: undefined,
              granularity: undefined,
              dateRange: searchedTimeRange,
            }
          : undefined);
      if (!base) return;

      renderBuilderConfigAsSqlTemplate(
        base as BuilderChartConfigWithDateRange,
        metadata,
      )
        .then(result => {
          if (result.isError) return;
          // Don't clobber a hand-edit made while generation was in flight, and
          // only write while still in SQL mode.
          if (
            getValues('configType') === 'sql' &&
            !getValues('sqlTemplate')?.trim()
          ) {
            setValue('sqlTemplate', result.sql, { shouldDirty: true });
          }
        })
        .catch(() => {
          // Leave the editor empty (with its placeholder) if conversion fails.
        });
    },
    [
      setValue,
      getValues,
      aggViewChartConfig,
      chartConfig,
      searchedTimeRange,
      metadata,
    ],
  );

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

  // Focus a chart series into the actual search. The histogram is grouped by
  // severity/status, so a focused series maps to a real column value; applying
  // it as an "only" filter re-queries both the chart and the results table so
  // they stay in sync (the chart-only visual focus wouldn't touch the table).
  const handleFocusSeries = useCallback(
    (groupFilters: SeriesGroupFilter[]) => {
      // Apply all group filters in one update so a multi-group series focus
      // re-queries once, not once per column. setOnlyFilters keys on the clean
      // (unquoted) column expression; the chart hands us the raw groupBy one.
      searchFilters.setOnlyFilters(
        groupFilters.map(({ column, value }) => ({
          property: cleanClickHouseExpression(column),
          value,
        })),
      );
    },
    [searchFilters],
  );

  const filtersChartConfig = useMemo<BuilderChartConfigWithDateRange>(() => {
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

  // Severity expression for the current source (logs only). Used both to run
  // the error/warning summary counts and to know which column a severity pill
  // click should filter on.
  const severityExpression =
    searchedSource?.kind === SourceKind.Log
      ? searchedSource?.severityTextExpression
      : undefined;
  const severityProperty = severityExpression
    ? cleanClickHouseExpression(severityExpression)
    : undefined;

  // Grouped count (severity value → count) over the searched window, mirroring
  // the results query's filters. The SeveritySummary component buckets rows into
  // error/warning client-side and renders clickable pills.
  const severitySummaryConfig = useMemo<
    BuilderChartConfigWithDateRange | undefined
  >(() => {
    if (chartConfig == null || !severityExpression) {
      return undefined;
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
      groupBy: severityExpression,
      orderBy: undefined,
      granularity: undefined,
      dateRange: searchedTimeRange,
      displayType: DisplayType.Table,
      with: aliasWith,
      alignDateRangeToGranularity: false,
      dateRangeEndInclusive: true,
    } satisfies BuilderChartConfigWithDateRange;
  }, [chartConfig, severityExpression, searchedTimeRange, aliasWith]);

  // Severity pills reflect the structured filter for the severity column, so
  // they render as filter chips in the query bar alongside sidebar filters.
  const activeSeverityValues = useMemo<string[]>(() => {
    if (!severityProperty) return [];
    const included = searchFilters.filters[severityProperty]?.included;
    return included ? Array.from(included).map(String) : [];
  }, [searchFilters.filters, severityProperty]);

  const handleSeverityToggle = useCallback(
    (values: string[], isActive: boolean) => {
      if (!severityProperty) return;
      // Merge with any severity values already selected so error + warning can
      // be active at once (adding one bucket doesn't drop the other).
      const next = new Set(
        Array.from(searchFilters.filters[severityProperty]?.included ?? []).map(
          String,
        ),
      );
      for (const v of values) {
        if (isActive) next.delete(v);
        else next.add(v);
      }
      searchFilters.setIncludedValues(severityProperty, Array.from(next));
    },
    [searchFilters, severityProperty],
  );

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
      // The row side panel is only used by the List view (log/trace sources).
      source:
        searchedSource?.kind === SourceKind.Metric ? undefined : searchedSource,
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

  const [isSourceSchemaPreviewOpen, setIsSourceSchemaPreviewOpen] =
    useState(false);

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
          whereLanguage: getStoredLanguage() ?? 'sql',
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

  const clearSaveSearchModalState = useCallback(
    () => setSaveSearchModalState(undefined),
    [setSaveSearchModalState],
  );

  const onModelFormExpandClose = useCallback(() => {
    setModelFormExpanded(false);
  }, [setModelFormExpanded]);

  // `Edit source` (singular): operate on the currently selected source.
  // Local mode opens the inline edit modal seeded with `inputSource`;
  // non-local uses a hard navigation so the page's `useQueryStates`
  // (source/where/select/whereLanguage/filters/orderBy) can't merge
  // stale /search state into the destination URL, and so
  // `router.basePath` is correctly prepended for the /clickstack build.
  const onEditCurrentSource = useCallback(() => {
    if (IS_LOCAL_MODE) {
      setModelFormExpanded(true);
      return;
    }
    if (inputSource) {
      window.location.assign(`${router.basePath}/team#source-${inputSource}`);
    } else {
      window.location.assign(`${router.basePath}/team`);
    }
  }, [inputSource, setModelFormExpanded]);

  // `Manage sources`: open the all-sources list view. Only wired in
  // non-local mode; local has no list-view surface so the menu item
  // hides itself when this prop is undefined. We use `window.location`
  // for a hard navigation instead of `router.push` so the page's
  // `useQueryStates` (source/where/select/whereLanguage/filters/orderBy)
  // can't restore its state into the new URL during the client-side
  // transition, and so `router.basePath` is correctly prepended for
  // the /clickstack build.
  const onManageSources = useMemo(() => {
    if (IS_LOCAL_MODE) return undefined;
    return () => {
      window.location.assign(`${router.basePath}/team`);
    };
  }, []);

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
      data-testid="explore-page"
    >
      <Head>
        <title>
          {savedSearch ? `${savedSearch.name} Explore` : 'Explore'} -{' '}
          {brandName}
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
        {/* Band 1: Context */}
        <ExploreContextBand
          sourceSelect={
            <>
              <SourceSelectControlled
                key={`${savedSearchId}`}
                size="xs"
                control={control}
                name="source"
                onCreate={openNewSourceModal}
                onEdit={onEditCurrentSource}
                onManageSources={onManageSources}
                onSchemaPreview={() => setIsSourceSchemaPreviewOpen(true)}
                isSchemaPreviewEnabled={isSourceSchemaPreviewEnabled(
                  inputSourceObj,
                )}
                allowedSourceKinds={ALLOWED_SOURCE_KINDS}
                data-testid="source-selector"
                style={{ minWidth: 150 }}
              />
              <SourceSchemaPreview
                source={inputSourceObj}
                controlled
                open={isSourceSchemaPreviewOpen}
                onClose={() => setIsSourceSchemaPreviewOpen(false)}
              />
            </>
          }
          savedSearchId={savedSearchId}
          savedSearchName={savedSearch?.name}
          isDirty={formState.isDirty}
          isLocalMode={IS_LOCAL_MODE}
          alerts={savedSearch?.alerts}
          favoriteButton={
            savedSearch && (
              <FavoriteButton
                resourceType="savedSearch"
                resourceId={savedSearch.id}
              />
            )
          }
          tagsControl={
            savedSearch && (
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
            )
          }
          onOpenSavedViews={openSavedSearchesFlyout}
          onSaveView={onSaveSearch}
          onUpdate={() => setSaveSearchModalState('update')}
          onSaveAsNew={() => setSaveSearchModalState('create')}
          saveDisabled={inputConfigType === 'sql'}
          saveDisabledTooltip="SQL searches aren't savable yet"
          onOpenAlert={openAlertModal}
          onDelete={() =>
            deleteSavedSearch.mutate(savedSearch?.id ?? '', {
              onSuccess: () => {
                router.push('/explore');
              },
            })
          }
        />
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
        {/* Band 2: Query editor */}
        <Box px="sm" pt="sm">
          <ExploreQueryEditor
            tableConnection={inputSourceTableConnection}
            control={control}
            name="where"
            onSubmit={onSubmit}
            enableHotkey
            data-testid="search-input"
            dateRange={searchedTimeRange}
            sourceId={inputSource}
            queryMode={inputConfigType}
            onQueryModeChange={handleQueryModeChange}
            sqlTemplateName="sqlTemplate"
            rawSqlDisplayType={
              isAggregatedSearchView(view)
                ? searchViewToDisplayType(view)
                : DisplayType.Table
            }
            filtersSlot={
              <ActiveFilterPills
                searchFilters={searchFilters}
                chartConfig={filtersChartConfig}
                dateTimeColumns={dateTimeColumns}
              />
            }
            controls={
              <>
                <TimePicker
                  data-testid="time-picker"
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={onTimePickerSearch}
                  onRelativeSearch={onTimePickerRelativeSearch}
                  showLive={view === 'list'}
                  isLiveMode={isLive}
                  // Default to relative time mode if the user has made changes to interval and reloaded.
                  defaultRelativeTimeMode={
                    isLive && interval !== LIVE_TAIL_DURATION_MS
                  }
                  width="100%"
                  size="xs"
                />
                {view === 'list' && denoiseResults != true && (
                  <SearchLiveControl
                    isLive={isLive}
                    refreshFrequency={refreshFrequency}
                    onToggle={() =>
                      isLive ? setIsLive(false) : handleResumeLiveTail()
                    }
                    onSelectCadence={ms => {
                      setRefreshFrequency(ms);
                      if (!isLive) {
                        handleResumeLiveTail();
                      }
                    }}
                  />
                )}
                <SearchRunControl isFormStateDirty={formState.isDirty} />
              </>
            }
          />
        </Box>
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
      <SavedSearchesFlyout
        opened={savedSearchesFlyoutOpened}
        onClose={closeSavedSearchesFlyout}
        currentSavedSearchId={savedSearchId}
        linkPrefix="/explore"
      />
      <DirectTraceSidePanel
        opened={directTraceId != null}
        traceId={directTraceId ?? ''}
        traceSourceId={directTraceSource?.id ?? null}
        dateRange={searchedTimeRange}
        focusDate={directTraceFocusDate}
        onClose={closeDirectTraceSidePanel}
        onSourceChange={onDirectTraceSourceChange}
        keepOpenSelector={SEARCH_RESULTS_PANEL_KEEP_OPEN_SELECTOR}
      />
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
                    chartConfig={filtersChartConfig}
                    sourceId={inputSourceObj?.id}
                    showDelta={
                      !!(searchedSource?.kind === SourceKind.Trace
                        ? searchedSource.durationExpression
                        : undefined)
                    }
                    onColumnToggle={toggleColumn}
                    displayedColumns={displayedColumns}
                    onCollapse={() => setIsFilterSidebarCollapsed(true)}
                    {...searchFilters}
                  />
                </ErrorBoundary>
              )}
              {chartConfig && histogramTimeChartConfig && (
                <Flex direction="column" w="100%" gap="0px" mih="0" miw={0}>
                  <Box className={searchPageStyles.searchStatsContainer}>
                    <ExploreResultsToolbar
                      resultsCount={
                        !isMetricSource &&
                        !isSqlUiMode &&
                        histogramTimeChartConfig && (
                          <ResultsStats
                            countConfig={histogramTimeChartConfig}
                            explainConfig={{
                              ...chartConfig,
                              dateRange: searchedTimeRange,
                            }}
                            enabled={isReady}
                            searchElapsedMs={searchElapsedMs}
                            isSearching={isAnyQueryFetching}
                            isLiveTail={isLive ?? false}
                          />
                        )
                      }
                      stats={
                        !isMetricSource &&
                        !isSqlUiMode &&
                        severitySummaryConfig && (
                          <SeveritySummary
                            config={severitySummaryConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            activeValues={activeSeverityValues}
                            onToggle={handleSeverityToggle}
                          />
                        )
                      }
                      filterExpand={
                        isFilterSidebarCollapsed && (
                          <ExpandFiltersButton
                            onExpand={() => setIsFilterSidebarCollapsed(false)}
                          />
                        )
                      }
                      viewSwitcher={
                        <SearchViewSwitcher
                          value={view}
                          onChange={setView}
                          sourceKind={searchedSource?.kind}
                          chartTypesOnly={isSqlUiMode}
                        />
                      }
                      addToDashboard={
                        isSqlUiMode
                          ? rawSqlAddToDashboardConfig && (
                              <AddToDashboardButton
                                config={rawSqlAddToDashboardConfig}
                              />
                            )
                          : isAggregatedSearchView(view) &&
                            addToDashboardConfig && (
                              <AddToDashboardButton
                                config={addToDashboardConfig}
                              />
                            )
                      }
                      overflowMenu={
                        <ResultsOverflowMenu
                          config={
                            isSqlUiMode && rawSqlChartConfig
                              ? rawSqlChartConfig
                              : {
                                  ...chartConfig,
                                  dateRange: searchedTimeRange,
                                }
                          }
                          sqlConfig={
                            isSqlUiMode
                              ? undefined
                              : (histogramTimeChartConfig ?? undefined)
                          }
                          showGeneratedSql={!isMetricSource}
                        />
                      }
                      shapeControls={
                        !isSqlUiMode && isAggregatedSearchView(view) ? (
                          <ExploreSeriesList
                            view={view}
                            config={aggConfig}
                            onChange={setAggConfig}
                            defaultGroupBy={defaultAggGroupBy}
                            onSubmit={onSubmit}
                            tableSource={searchedSource}
                            dateRange={searchedTimeRange}
                          />
                        ) : undefined
                      }
                      shapeActions={
                        isSqlUiMode ? undefined : view === 'list' ? (
                          <>
                            <SearchColumnPicker
                              availableColumns={availableColumns}
                              selectedColumns={displayedColumns}
                              onApply={applyColumns}
                              sqlSlot={
                                <SQLInlineEditorControlled
                                  tableConnection={inputSourceTableConnection}
                                  control={control}
                                  name="select"
                                  defaultValue={defaultSearchConfig.select}
                                  placeholder={
                                    defaultSearchConfig.select ||
                                    'SELECT Columns'
                                  }
                                  onSubmit={onSubmit}
                                  label="SELECT"
                                  size="xs"
                                  allowMultiline
                                  dateRange={searchedTimeRange}
                                  sourceId={inputSource}
                                />
                              }
                            />
                            <SearchSortMenu
                              groupLabel="Sort by"
                              options={displayedColumns.map(column => ({
                                value: column,
                                label: column,
                              }))}
                              activeField={listSort.field}
                              direction={listSort.direction}
                              onChange={applyListSort}
                              onRevert={revertListSort}
                              canRevert={!!searchedConfig.orderBy}
                              sqlSlot={
                                <SQLInlineEditorControlled
                                  tableConnection={inputSourceTableConnection}
                                  control={control}
                                  name="orderBy"
                                  defaultValue={defaultSearchConfig.orderBy}
                                  onSubmit={onSubmit}
                                  label="ORDER BY"
                                  size="xs"
                                  dateRange={searchedTimeRange}
                                  sourceId={inputSource}
                                />
                              }
                            />
                          </>
                        ) : view === 'table' ||
                          view === 'bar' ||
                          view === 'pie' ||
                          view === 'treemap' ? (
                          <SearchSortMenu
                            groupLabel="Sort groups by"
                            options={[
                              { value: 'value', label: 'Value' },
                              { value: 'name', label: 'Name' },
                            ]}
                            activeField={aggConfig.sort}
                            direction={aggConfig.sortDir}
                            onChange={(field, dir) => {
                              setAggConfig({
                                sort: field as AggSortField,
                                sortDir: dir,
                              });
                              onSubmit();
                            }}
                            onRevert={() => {
                              setAggConfig({ sort: 'value', sortDir: 'desc' });
                              onSubmit();
                            }}
                            canRevert={
                              aggConfig.sort !== 'value' ||
                              aggConfig.sortDir !== 'desc'
                            }
                          />
                        ) : undefined
                      }
                    />
                  </Box>
                  {viewShowsHistogram(view) &&
                    !hasQueryError &&
                    !isSqlUiMode && (
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
                          onFocusSeries={handleFocusSeries}
                          enableParallelQueries
                        />
                      </Box>
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
                  ) : isSqlUiMode ? (
                    <Box flex="1" mih="0" px="sm" py="xs">
                      {rawSqlChartConfig ? (
                        view === 'timeseries' ? (
                          <DBTimeChart
                            sourceId={searchedConfig.source ?? undefined}
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            showMVOptimizationIndicator={false}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                          />
                        ) : view === 'number' ? (
                          <DBNumberChart
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            showMVOptimizationIndicator={false}
                            errorVariant="inline"
                          />
                        ) : view === 'bar' ? (
                          <DBBarChart
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            showMVOptimizationIndicator={false}
                            errorVariant="inline"
                          />
                        ) : view === 'pie' ? (
                          <DBPieChart
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            showMVOptimizationIndicator={false}
                            errorVariant="inline"
                          />
                        ) : view === 'treemap' ? (
                          <DBTreemapChart
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            showMVOptimizationIndicator={false}
                            errorVariant="inline"
                          />
                        ) : (
                          <DBTableChart
                            config={rawSqlChartConfig}
                            enabled={isReady}
                            queryKeyPrefix={QUERY_KEY_PREFIX}
                            showMVOptimizationIndicator={false}
                            errorVariant="inline"
                          />
                        )
                      ) : (
                        <Flex
                          h="100%"
                          align="center"
                          justify="center"
                          direction="column"
                          gap="xs"
                        >
                          <Text size="sm" c="dimmed">
                            Press Run to execute your SQL query.
                          </Text>
                        </Flex>
                      )}
                    </Box>
                  ) : view === 'patterns' ? (
                    <Box flex="1" mih="0" px="sm">
                      <PatternTable
                        source={searchedSource}
                        config={{
                          ...chartConfig,
                          dateRange: searchedTimeRange,
                          // Carry the source's select-alias definitions so the
                          // rebuilt pattern query can filter on aliased columns
                          // (e.g. `ServiceName as service`) without hitting
                          // "Unknown identifier". Mirrors the results,
                          // histogram, and heatmap configs.
                          with: aliasWith,
                        }}
                        bodyValueExpression={
                          searchedSource
                            ? (getEventBody(searchedSource) ?? '')
                            : (chartConfig.implicitColumnExpression ?? '')
                        }
                        patternColumn={patternColumn}
                        draftPatternColumn={draftPatternColumn}
                        onDraftPatternColumnChange={setDraftPatternColumn}
                        onSubmit={onSubmit}
                        totalCountConfig={histogramTimeChartConfig}
                        totalCountQueryKeyPrefix={QUERY_KEY_PREFIX}
                      />
                    </Box>
                  ) : view === 'heatmap' ? (
                    searchedSource != null && isTraceSource(searchedSource) ? (
                      <Box flex="1" mih="0">
                        <DBSearchHeatmapChart
                          chartConfig={{
                            ...chartConfig,
                            dateRange: searchedTimeRange,
                            with: aliasWith,
                          }}
                          isReady={isReady}
                          source={searchedSource}
                          onAddFilter={searchFilters.setFilterValue}
                        />
                      </Box>
                    ) : (
                      <Box flex="1" px="sm" pt="md">
                        <Text size="sm" c="dimmed">
                          Event deltas are only available for trace sources.
                        </Text>
                      </Box>
                    )
                  ) : isAggregatedSearchView(view) ? (
                    <Box flex="1" mih="0" px="sm" py="xs">
                      {isMetricSource &&
                        !exploreSeriesHaveMetricNames(aggConfig.series) && (
                          <Flex
                            h="100%"
                            align="center"
                            justify="center"
                            direction="column"
                            gap="xs"
                          >
                            <Text size="sm" c="dimmed">
                              Select a metric to visualize
                            </Text>
                            <Text size="xs" c="dimmed">
                              Choose a metric name from the series cards above.
                            </Text>
                          </Flex>
                        )}
                      {view === 'timeseries' && aggViewChartConfig && (
                        <DBTimeChart
                          sourceId={searchedConfig.source ?? undefined}
                          config={aggViewChartConfig}
                          enabled={isReady}
                          setDisplayType={type => {
                            setAggConfig({
                              chartType:
                                type === DisplayType.Line ? 'line' : 'bar',
                            });
                            onSubmit();
                          }}
                          showMVOptimizationIndicator={false}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                        />
                      )}
                      {view === 'number' && aggViewChartConfig && (
                        <DBNumberChart
                          config={aggViewChartConfig}
                          enabled={isReady}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          showMVOptimizationIndicator={false}
                          errorVariant="inline"
                        />
                      )}
                      {view === 'table' && aggViewChartConfig && (
                        <DBTableChart
                          config={aggViewChartConfig}
                          enabled={isReady}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          showMVOptimizationIndicator={false}
                          errorVariant="inline"
                        />
                      )}
                      {view === 'bar' && aggViewChartConfig && (
                        <DBBarChart
                          config={aggViewChartConfig}
                          enabled={isReady}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          showMVOptimizationIndicator={false}
                          errorVariant="inline"
                        />
                      )}
                      {view === 'pie' && aggViewChartConfig && (
                        <DBPieChart
                          config={aggViewChartConfig}
                          enabled={isReady}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          showMVOptimizationIndicator={false}
                          errorVariant="inline"
                        />
                      )}
                      {view === 'treemap' && aggViewChartConfig && (
                        <DBTreemapChart
                          config={aggViewChartConfig}
                          enabled={isReady}
                          queryKeyPrefix={QUERY_KEY_PREFIX}
                          showMVOptimizationIndicator={false}
                          errorVariant="inline"
                        />
                      )}
                    </Box>
                  ) : (
                    <Box
                      flex="1"
                      mih="0"
                      px="sm"
                      data-testid="search-results-panel"
                    >
                      {chartConfig &&
                        searchedConfig.source &&
                        dbSqlRowTableConfig && (
                          <DBSqlRowTableWithSideBar
                            context={rowTableContext}
                            config={dbSqlRowTableConfig}
                            sourceId={searchedConfig.source}
                            tableId={columnSizeTableId}
                            keepOpenSelector={
                              SEARCH_RESULTS_PANEL_KEEP_OPEN_SELECTOR
                            }
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
                            onResolvedColumnsChange={onResolvedColumnsChange}
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

const DBExplorePageDynamic = dynamic(async () => DBExplorePage, {
  ssr: false,
});

// @ts-expect-error next/dynamic component type does not include the getLayout static
DBExplorePageDynamic.getLayout = withAppNav;

export default DBExplorePageDynamic;
