import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { formatRelative } from 'date-fns';
import produce from 'immer';
import { parseAsJson, parseAsString, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { convertToDashboardTemplate } from '@hyperdx/common-utils/dist/core/utils';
import {
  AlertState,
  DashboardFilter,
  SourceKind,
  TSourceUnion,
} from '@hyperdx/common-utils/dist/types';
import {
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  SearchCondition,
  SearchConditionLanguage,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Group,
  Indicator,
  Input,
  Menu,
  Modal,
  Paper,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useHotkeys, useHover } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowsMaximize,
  IconBell,
  IconCopy,
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconFilterEdit,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconTags,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';

import { ContactSupportText } from '@/components/ContactSupportText';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import DBNumberChart from '@/components/DBNumberChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import FullscreenPanelModal from '@/components/FullscreenPanelModal';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import {
  Dashboard,
  type Tile,
  useCreateDashboard,
  useDeleteDashboard,
} from '@/dashboard';

import ChartContainer from './components/charts/ChartContainer';
import { DBPieChart } from './components/DBPieChart';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import OnboardingModal from './components/OnboardingModal';
import { Tags } from './components/Tags';
import useDashboardFilters from './hooks/useDashboardFilters';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { parseAsStringWithNewLines } from './utils/queryParsers';
import { buildTableRowSearchUrl, DEFAULT_CHART_CONFIG } from './ChartUtils';
import { IS_LOCAL_MODE } from './config';
import { useDashboard } from './dashboard';
import DashboardFilters from './DashboardFilters';
import DashboardFiltersModal from './DashboardFiltersModal';
import { GranularityPickerControlled } from './GranularityPicker';
import HDXMarkdownChart from './HDXMarkdownChart';
import { withAppNav } from './layout';
import SearchInputV2 from './SearchInputV2';
import {
  getFirstTimestampValueExpression,
  useSource,
  useSources,
} from './source';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import { useConfirm } from './useConfirm';
import { getMetricTableName } from './utils';
import { useZIndex, ZIndexContext } from './zIndex';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const makeId = () => Math.floor(100000000 * Math.random()).toString(36);

const ReactGridLayout = WidthProvider(RGL);

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const Tile = forwardRef(
  (
    {
      chart,
      dateRange,
      onDuplicateClick,
      onEditClick,
      onDeleteClick,
      onUpdateChart,
      granularity,
      onTimeRangeSelect,
      filters,

      // Properties forwarded by grid layout
      className,
      style,
      onMouseDown,
      onMouseUp,
      onTouchEnd,
      children,
      isHighlighted,
    }: {
      chart: Tile;
      dateRange: [Date, Date];
      onDuplicateClick: () => void;
      onEditClick: () => void;
      onAddAlertClick?: () => void;
      onDeleteClick: () => void;
      onUpdateChart?: (chart: Tile) => void;
      onSettled?: () => void;
      granularity: SQLInterval | undefined;
      onTimeRangeSelect: (start: Date, end: Date) => void;
      filters?: Filter[];

      // Properties forwarded by grid layout
      className?: string;
      style?: React.CSSProperties;
      onMouseDown?: (e: React.MouseEvent) => void;
      onMouseUp?: (e: React.MouseEvent) => void;
      onTouchEnd?: (e: React.TouchEvent) => void;
      children?: React.ReactNode; // Resizer tooltip
      isHighlighted?: boolean;
    },
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
      if (isHighlighted) {
        document
          .getElementById(`chart-${chart.id}`)
          ?.scrollIntoView({ behavior: 'smooth' });
      }
    }, [chart.id, isHighlighted]);

    // YouTube-style 'f' key shortcut for fullscreen toggle
    useHotkeys([['f', () => isFocused && setIsFullscreen(prev => !prev)]]);

    const [queriedConfig, setQueriedConfig] = useState<
      ChartConfigWithDateRange | undefined
    >(undefined);

    const { data: source } = useSource({
      id: chart.config.source,
    });

    useEffect(() => {
      if (source != null) {
        const isMetricSource = source.kind === SourceKind.Metric;

        // TODO: will need to update this when we allow for multiple metrics per chart
        const firstSelect = chart.config.select[0];
        const metricType =
          isMetricSource && typeof firstSelect !== 'string'
            ? firstSelect?.metricType
            : undefined;
        const tableName = getMetricTableName(source, metricType);
        if (source.connection) {
          setQueriedConfig({
            ...chart.config,
            connection: source.connection,
            dateRange,
            granularity,
            timestampValueExpression: source.timestampValueExpression,
            from: {
              databaseName: source.from?.databaseName || 'default',
              tableName: tableName || '',
            },
            implicitColumnExpression: source.implicitColumnExpression,
            filters,
            metricTables: isMetricSource ? source.metricTables : undefined,
          });
        }
      }
    }, [source, chart, dateRange, granularity, filters]);

    const [hovered, setHovered] = useState(false);

    const alert = chart.config.alert;
    const alertIndicatorColor = useMemo(() => {
      if (!alert) {
        return 'transparent';
      }
      if (alert.state === AlertState.OK) {
        return 'green';
      }
      if (alert.silenced?.at) {
        return 'yellow';
      }
      return 'red';
    }, [alert]);

    const alertTooltip = useMemo(() => {
      if (!alert) {
        return 'Add alert';
      }
      let tooltip = `Has alert and is in ${alert.state} state`;
      if (alert.silenced?.at) {
        const silencedAt = new Date(alert.silenced.at);
        tooltip += `. Ack'd ${formatRelative(silencedAt, new Date())}`;
      }
      return tooltip;
    }, [alert]);

    const hoverToolbar = useMemo(() => {
      return (
        <Flex
          gap="0px"
          onMouseDown={e => e.stopPropagation()}
          key="hover-toolbar"
          style={{ visibility: hovered ? 'visible' : 'hidden' }}
        >
          {(chart.config.displayType === DisplayType.Line ||
            chart.config.displayType === DisplayType.StackedBar ||
            chart.config.displayType === DisplayType.Number) && (
            <Indicator
              size={alert?.state === AlertState.OK ? 6 : 8}
              zIndex={1}
              color={alertIndicatorColor}
              processing={alert?.state === AlertState.ALERT}
              label={!alert && <span className="fs-8">+</span>}
              mr={4}
            >
              <Tooltip label={alertTooltip} withArrow>
                <ActionIcon
                  data-testid={`tile-alerts-button-${chart.id}`}
                  variant="subtle"
                  size="sm"
                  onClick={onEditClick}
                >
                  <IconBell size={16} />
                </ActionIcon>
              </Tooltip>
            </Indicator>
          )}

          <ActionIcon
            data-testid={`tile-duplicate-button-${chart.id}`}
            variant="subtle"
            size="sm"
            onClick={onDuplicateClick}
            title="Duplicate"
          >
            <IconCopy size={14} />
          </ActionIcon>
          <ActionIcon
            data-testid={`tile-fullscreen-button-${chart.id}`}
            variant="subtle"
            size="sm"
            onClick={e => {
              e.stopPropagation();
              setIsFullscreen(true);
            }}
            title="View Fullscreen (f)"
          >
            <IconArrowsMaximize size={14} />
          </ActionIcon>
          <ActionIcon
            data-testid={`tile-edit-button-${chart.id}`}
            variant="subtle"
            size="sm"
            onClick={onEditClick}
            title="Edit"
          >
            <IconPencil size={14} />
          </ActionIcon>
          <ActionIcon
            data-testid={`tile-delete-button-${chart.id}`}
            variant="subtle"
            size="sm"
            onClick={onDeleteClick}
            title="Delete"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Flex>
      );
    }, [
      alert,
      alertIndicatorColor,
      alertTooltip,
      chart.config.displayType,
      chart.id,
      hovered,
      onDeleteClick,
      onDuplicateClick,
      onEditClick,
    ]);

    const title = useMemo(
      () => (
        <Text size="sm" ms="xs">
          {chart.config.name}
        </Text>
      ),
      [chart.config.name],
    );

    // Render chart content (used in both tile and fullscreen views)
    const renderChartContent = useCallback(
      (hideToolbar: boolean = false, isFullscreenView: boolean = false) => {
        const toolbar = hideToolbar ? [] : [hoverToolbar];
        const keyPrefix = isFullscreenView ? 'fullscreen' : 'tile';

        return (
          <ErrorBoundary
            onError={console.error}
            fallback={
              <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                An error occurred while rendering the chart.
              </div>
            }
          >
            {(queriedConfig?.displayType === DisplayType.Line ||
              queriedConfig?.displayType === DisplayType.StackedBar) && (
              <DBTimeChart
                key={`${keyPrefix}-${chart.id}`}
                title={title}
                toolbarPrefix={toolbar}
                sourceId={chart.config.source}
                showDisplaySwitcher={true}
                config={queriedConfig}
                onTimeRangeSelect={onTimeRangeSelect}
                setDisplayType={displayType => {
                  onUpdateChart?.({
                    ...chart,
                    config: {
                      ...chart.config,
                      displayType,
                    },
                  });
                }}
              />
            )}
            {queriedConfig?.displayType === DisplayType.Table && (
              <Box p="xs" h="100%">
                <DBTableChart
                  key={`${keyPrefix}-${chart.id}`}
                  title={title}
                  toolbarPrefix={toolbar}
                  config={queriedConfig}
                  variant="muted"
                  getRowSearchLink={row =>
                    buildTableRowSearchUrl({
                      row,
                      source,
                      config: queriedConfig,
                      dateRange: dateRange,
                    })
                  }
                />
              </Box>
            )}
            {queriedConfig?.displayType === DisplayType.Number && (
              <DBNumberChart
                key={`${keyPrefix}-${chart.id}`}
                title={title}
                toolbarPrefix={toolbar}
                config={queriedConfig}
              />
            )}
            {queriedConfig?.displayType === DisplayType.Pie && (
              <DBPieChart
                key={`${keyPrefix}-${chart.id}`}
                title={title}
                toolbarPrefix={toolbar}
                config={queriedConfig}
              />
            )}
            {/* Markdown charts may not have queriedConfig, if source is not set */}
            {(queriedConfig?.displayType === DisplayType.Markdown ||
              (!queriedConfig &&
                chart.config.displayType === DisplayType.Markdown)) && (
              <HDXMarkdownChart
                key={`${keyPrefix}-${chart.id}`}
                title={title}
                toolbarItems={toolbar}
                config={queriedConfig ?? chart.config}
              />
            )}
            {queriedConfig?.displayType === DisplayType.Search && (
              <ChartContainer
                title={title}
                toolbarItems={toolbar}
                disableReactiveContainer
              >
                <DBSqlRowTableWithSideBar
                  key={`${keyPrefix}-${chart.id}`}
                  enabled
                  sourceId={chart.config.source}
                  config={{
                    ...queriedConfig,
                    orderBy: [
                      {
                        ordering: 'DESC',
                        valueExpression: getFirstTimestampValueExpression(
                          queriedConfig.timestampValueExpression,
                        ),
                      },
                    ],
                    dateRange,
                    select:
                      queriedConfig.select ||
                      source?.defaultTableSelectExpression ||
                      '',
                    groupBy: undefined,
                    granularity: undefined,
                  }}
                  isLive={false}
                  queryKeyPrefix={'search'}
                  variant="muted"
                />
              </ChartContainer>
            )}
          </ErrorBoundary>
        );
      },
      [
        hoverToolbar,
        queriedConfig,
        title,
        chart,
        onTimeRangeSelect,
        onUpdateChart,
        source,
        dateRange,
      ],
    );

    return (
      <>
        <div
          data-testid={`dashboard-tile-${chart.id}`}
          className={`p-2 pt-0 ${className} d-flex flex-column bg-muted cursor-grab rounded ${
            isHighlighted && 'dashboard-chart-highlighted'
          }`}
          id={`chart-${chart.id}`}
          onMouseOver={() => {
            setHovered(true);
            setIsFocused(true);
          }}
          onMouseLeave={() => {
            setHovered(false);
            setIsFocused(false);
          }}
          key={chart.id}
          ref={ref}
          style={{
            ...style,
          }}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onTouchEnd={onTouchEnd}
        >
          <Group justify="center" py={4}>
            <Box bg={hovered ? 'gray' : undefined} w={100} h={2}></Box>
          </Group>
          <div
            className="fs-7 text-muted flex-grow-1 overflow-hidden cursor-default"
            onMouseDown={e => e.stopPropagation()}
          >
            {renderChartContent()}
          </div>
          {children}
        </div>

        {/* Fullscreen Modal */}
        <FullscreenPanelModal
          opened={isFullscreen}
          onClose={() => setIsFullscreen(false)}
        >
          {isFullscreen && renderChartContent(true, true)}
        </FullscreenPanelModal>
      </>
    );
  },
);

const EditTileModal = ({
  dashboardId,
  chart,
  onClose,
  onSave,
  isSaving,
  dateRange,
}: {
  dashboardId?: string;
  chart: Tile | undefined;
  onClose: () => void;
  dateRange: [Date, Date];
  isSaving?: boolean;
  onSave: (chart: Tile) => void;
}) => {
  const contextZIndex = useZIndex();
  const modalZIndex = contextZIndex + 10;
  const confirm = useConfirm();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (chart != null) {
      setHasUnsavedChanges(false);
    }
  }, [chart]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    if (hasUnsavedChanges) {
      confirm(
        'You have unsaved changes. Discard them and close the editor?',
        'Discard',
      ).then(ok => {
        if (ok) onClose();
      });
    } else {
      onClose();
    }
  }, [confirm, isSaving, hasUnsavedChanges, onClose]);

  return (
    <Modal
      opened={chart != null}
      onClose={handleClose}
      withCloseButton={false}
      centered
      size="90%"
      padding="xs"
      zIndex={modalZIndex}
    >
      {chart != null && (
        <ZIndexContext.Provider value={modalZIndex + 10}>
          <EditTimeChartForm
            dashboardId={dashboardId}
            chartConfig={chart.config}
            dateRange={dateRange}
            isSaving={isSaving}
            onSave={config => {
              onSave({
                ...chart,
                config: config,
              });
            }}
            onClose={handleClose}
            onDirtyChange={setHasUnsavedChanges}
          />
        </ZIndexContext.Provider>
      )}
    </Modal>
  );
};

const updateLayout = (newLayout: RGL.Layout[]) => {
  return (dashboard: Dashboard) => {
    for (const chart of dashboard.tiles) {
      const newChartLayout = newLayout.find(layout => layout.i === chart.id);
      if (newChartLayout) {
        chart.x = newChartLayout.x;
        chart.y = newChartLayout.y;
        chart.w = newChartLayout.w;
        chart.h = newChartLayout.h;
      }
    }
  };
};

function DashboardName({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedName, setEditedName] = useState(name);

  const { hovered, ref } = useHover();

  return (
    <Box
      ref={ref}
      pe="md"
      onDoubleClick={() => setEditing(true)}
      className="cursor-pointer"
      title="Double click to edit"
    >
      {editing ? (
        <form
          className="d-flex align-items-center"
          onSubmit={e => {
            e.preventDefault();
            onSave(editedName);
            setEditing(false);
          }}
        >
          <Input
            type="text"
            value={editedName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEditedName(e.target.value)
            }
            placeholder="Dashboard Name"
          />
          <Button ms="sm" variant="primary" type="submit">
            Save Name
          </Button>
        </form>
      ) : (
        <div className="d-flex align-items-center" style={{ minWidth: 100 }}>
          <Title fw={400} order={3}>
            {name}
          </Title>
          {hovered && (
            <Button
              ms="xs"
              variant="subtle"
              size="xs"
              onClick={() => setEditing(true)}
            >
              <IconPencil size={14} />
            </Button>
          )}
        </div>
      )}
    </Box>
  );
}

// Download an object to users computer as JSON using specified name
function downloadObjectAsJson(object: object, fileName = 'output') {
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(object));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute('href', dataStr);
  downloadAnchorNode.setAttribute('download', fileName + '.json');
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

function DBDashboardPage({ presetConfig }: { presetConfig?: Dashboard }) {
  const brandName = useBrandDisplayName();
  const confirm = useConfirm();

  const router = useRouter();
  const dashboardId = router.query.dashboardId as string | undefined;

  const {
    dashboard,
    setDashboard,
    dashboardHash,
    isLocalDashboard,
    isFetching: isFetchingDashboard,
    isSetting: isSavingDashboard,
  } = useDashboard({
    dashboardId: dashboardId as string | undefined,
    presetConfig,
  });

  const { data: sources } = useSources();

  const [highlightedTileId] = useQueryState('highlightedTileId');
  const tableConnections = useMemo(() => {
    if (!dashboard) return [];
    const tc: TableConnection[] = [];

    for (const { config } of dashboard.tiles) {
      const source = sources?.find(v => v.id === config.source);
      if (!source) continue;
      // TODO: will need to update this when we allow for multiple metrics per chart
      const firstSelect = config.select[0];
      const metricType =
        typeof firstSelect !== 'string' ? firstSelect?.metricType : undefined;
      const tableName = getMetricTableName(source, metricType);
      if (!tableName) continue;
      tc.push({
        databaseName: source.from.databaseName,
        tableName: tableName,
        connectionId: source.connection,
      });
    }

    return tc;
  }, [dashboard, sources]);

  const [granularity, setGranularity] = useQueryState(
    'granularity',
    parseAsString,
    // TODO: Build parser
  ) as [SQLInterval | undefined, (value: SQLInterval | undefined) => void];
  const [where, setWhere] = useQueryState(
    'where',
    parseAsStringWithNewLines.withDefault(''),
  );
  const [whereLanguage, setWhereLanguage] = useQueryState(
    'whereLanguage',
    parseAsString.withDefault('lucene'),
  );
  // Get raw filter queries from URL (not processed by hook)
  const [rawFilterQueries] = useQueryState('filters', parseAsJson<Filter[]>());

  // Track if we've initialized query for this dashboard
  const initializedDashboard = useRef<string>(undefined);

  const [showFiltersModal, setShowFiltersModal] = useState(false);

  const filters = dashboard?.filters ?? [];
  const { filterValues, setFilterValue, filterQueries, setFilterQueries } =
    useDashboardFilters(filters);

  const handleSaveFilter = (filter: DashboardFilter) => {
    if (!dashboard) return;

    setDashboard(
      produce(dashboard, draft => {
        const filterIndex =
          draft.filters?.findIndex(p => p.id === filter.id) ?? -1;
        if (draft.filters && filterIndex !== -1) {
          draft.filters[filterIndex] = filter;
        } else {
          draft.filters = [...(draft.filters ?? []), filter];
        }
      }),
    );
  };

  const handleRemoveFilter = (id: string) => {
    if (!dashboard) return;

    setDashboard({
      ...dashboard,
      filters: dashboard.filters?.filter(p => p.id !== id) ?? [],
    });
  };

  const [isLive, setIsLive] = useState(false);

  const { control, setValue, getValues, handleSubmit } = useForm<{
    granularity: SQLInterval | 'auto';
    where: SearchCondition;
    whereLanguage: SearchConditionLanguage;
  }>({
    defaultValues: {
      granularity: granularity ?? 'auto',
      where: where ?? '',
      whereLanguage: (whereLanguage as SearchConditionLanguage) ?? 'lucene',
    },
  });

  const watchedGranularity = useWatch({ control, name: 'granularity' });

  useEffect(() => {
    if (watchedGranularity && watchedGranularity !== granularity) {
      setGranularity(watchedGranularity as SQLInterval);
    }
  }, [watchedGranularity, granularity, setGranularity]);

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Past 1h');

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: 'Past 1h',
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const {
    granularityOverride,
    isRefreshEnabled,
    manualRefreshCooloff,
    refresh,
  } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(data => {
      setWhere(data.where as SearchCondition);
      setWhereLanguage((data.whereLanguage as SearchConditionLanguage) ?? null);
    })();
  }, [
    displayedTimeInputValue,
    handleSubmit,
    onSearch,
    setWhere,
    setWhereLanguage,
  ]);

  // Initialize query/filter state once when dashboard changes.
  useEffect(() => {
    if (!dashboard?.id || !router.isReady) return;
    if (!isLocalDashboard && isFetchingDashboard) return;
    if (initializedDashboard.current === dashboard.id) return;
    const isSwitchingDashboards =
      initializedDashboard.current != null &&
      initializedDashboard.current !== dashboard.id;

    const hasWhereInUrl = 'where' in router.query;
    const hasFiltersInUrl = 'filters' in router.query;

    // Query defaults: URL query overrides saved defaults. If switching to a
    // dashboard without defaults, clear query. On first load/reload, keep current state.
    if (!hasWhereInUrl) {
      if (dashboard.savedQuery) {
        setValue('where', dashboard.savedQuery);
        setWhere(dashboard.savedQuery);
        const savedLanguage = dashboard.savedQueryLanguage ?? 'lucene';
        setValue('whereLanguage', savedLanguage);
        setWhereLanguage(savedLanguage);
      } else if (isSwitchingDashboards) {
        setValue('where', '');
        setWhere('');
        setValue('whereLanguage', 'lucene');
        setWhereLanguage('lucene');
      }
    }

    // Filter defaults: URL filters override saved defaults. If switching to a
    // dashboard without defaults, clear selected filters.
    if (!hasFiltersInUrl) {
      if (dashboard.savedFilterValues) {
        setFilterQueries(dashboard.savedFilterValues);
      } else if (isSwitchingDashboards) {
        setFilterQueries(null);
      }
    }

    initializedDashboard.current = dashboard.id;
  }, [
    dashboard?.id,
    dashboard?.savedQuery,
    dashboard?.savedQueryLanguage,
    dashboard?.savedFilterValues,
    isLocalDashboard,
    isFetchingDashboard,
    router.isReady,
    router.query,
    setValue,
    setWhere,
    setWhereLanguage,
    setFilterQueries,
  ]);

  const handleSaveQuery = useCallback(() => {
    if (!dashboard || isLocalDashboard) return;

    // Execute the query first (updates URL)
    onSubmit();

    // Then save to database (reads from form values which were just submitted to URL)
    const formValues = getValues();
    const currentWhere = formValues.where || null;
    const currentWhereLanguage = currentWhere
      ? formValues.whereLanguage || 'lucene'
      : null;
    const currentFilterValues = rawFilterQueries?.length
      ? rawFilterQueries
      : null;

    setDashboard(
      produce(dashboard, draft => {
        draft.savedQuery = currentWhere;
        draft.savedQueryLanguage = currentWhereLanguage;
        draft.savedFilterValues = currentFilterValues;
      }),
      () => {
        notifications.show({
          color: 'green',
          title: 'Query saved and executed',
          message:
            'Filter query and dropdown values have been saved with the dashboard',
          autoClose: 3000,
        });
      },
    );
  }, [
    dashboard,
    isLocalDashboard,
    setDashboard,
    getValues,
    rawFilterQueries,
    onSubmit,
  ]);
  const handleRemoveSavedQuery = useCallback(() => {
    if (!dashboard || isLocalDashboard) return;

    setDashboard(
      produce(dashboard, draft => {
        draft.savedQuery = null;
        draft.savedQueryLanguage = null;
        draft.savedFilterValues = null;
      }),
      () => {
        notifications.show({
          color: 'green',
          title: 'Default query and filters removed',
          message: 'Dashboard will no longer auto-apply saved defaults',
          autoClose: 3000,
        });
      },
    );
  }, [dashboard, isLocalDashboard, setDashboard]);

  const [editedTile, setEditedTile] = useState<undefined | Tile>();

  const onAddTile = () => {
    setEditedTile({
      id: makeId(),
      x: 0,
      y: 0,
      w: 8,
      h: 10,
      config: {
        ...DEFAULT_CHART_CONFIG,
        source: sources?.[0]?.id ?? '',
      },
    });
  };

  const layout = (dashboard?.tiles ?? []).map(chart => {
    return {
      i: chart.id,
      x: chart.x,
      y: chart.y,
      w: chart.w,
      h: chart.h,
      minH: 1,
      minW: 1,
    };
  });

  const tiles = useMemo(
    () =>
      (dashboard?.tiles ?? []).map(chart => {
        return (
          <Tile
            key={chart.id}
            chart={chart}
            dateRange={searchedTimeRange}
            onEditClick={() => setEditedTile(chart)}
            granularity={
              isRefreshEnabled
                ? granularityOverride
                : (granularity ?? undefined)
            }
            filters={[
              {
                type: whereLanguage === 'sql' ? 'sql' : 'lucene',
                condition: where,
              },
              ...(filterQueries ?? []),
            ]}
            onTimeRangeSelect={onTimeRangeSelect}
            isHighlighted={highlightedTileId === chart.id}
            onUpdateChart={newChart => {
              if (!dashboard) {
                return;
              }
              setDashboard(
                produce(dashboard, draft => {
                  const chartIndex = draft.tiles.findIndex(
                    c => c.id === chart.id,
                  );
                  if (chartIndex === -1) {
                    return;
                  }
                  draft.tiles[chartIndex] = newChart;
                }),
              );
            }}
            onDuplicateClick={async () => {
              if (dashboard != null) {
                if (
                  !(await confirm(
                    <>
                      Duplicate {'"'}
                      <Text component="span" fw={700}>
                        {chart.config.name}
                      </Text>
                      {'"'}?
                    </>,
                    'Duplicate',
                  ))
                ) {
                  return;
                }
                setDashboard({
                  ...dashboard,
                  tiles: [
                    ...dashboard.tiles,
                    {
                      ...chart,
                      id: makeId(),
                      config: {
                        ...chart.config,
                        // Don't duplicate any alerts that may be set on the original tile
                        alert: undefined,
                      },
                    },
                  ],
                });
              }
            }}
            onDeleteClick={async () => {
              if (dashboard != null) {
                if (
                  !(await confirm(
                    <>
                      Delete{' '}
                      <Text component="span" fw={700}>
                        {chart.config.name}
                      </Text>
                      ?
                    </>,
                    'Delete',
                    { variant: 'danger' },
                  ))
                ) {
                  return;
                }
                setDashboard({
                  ...dashboard,
                  tiles: dashboard.tiles.filter(c => c.id !== chart.id),
                });
              }
            }}
          />
        );
      }),
    [
      dashboard,
      searchedTimeRange,
      isRefreshEnabled,
      granularityOverride,
      granularity,
      highlightedTileId,
      confirm,
      setDashboard,
      where,
      whereLanguage,
      onTimeRangeSelect,
      filterQueries,
    ],
  );

  const deleteDashboard = useDeleteDashboard();

  const handleUpdateTags = useCallback(
    (newTags: string[]) => {
      if (dashboard?.id) {
        setDashboard(
          {
            ...dashboard,
            tags: newTags,
          },
          () => {
            notifications.show({
              color: 'green',
              message: 'Tags updated successfully',
            });
          },
          () => {
            notifications.show({
              color: 'red',
              message: (
                <>
                  An error occurred. <ContactSupportText />
                </>
              ),
            });
          },
        );
      }
    },
    [dashboard, setDashboard],
  );

  const createDashboard = useCreateDashboard();
  const onCreateDashboard = useCallback(() => {
    createDashboard.mutate(
      {
        name: 'My Dashboard',
        tiles: [],
        tags: [],
      },
      {
        onSuccess: data => {
          router.push(`/dashboards/${data.id}`);
        },
      },
    );
  }, [createDashboard, router]);

  const [isSaving, setIsSaving] = useState(false);

  const hasTiles = dashboard && dashboard.tiles.length > 0;
  const hasSavedQueryAndFilterDefaults = Boolean(
    dashboard?.savedQuery || dashboard?.savedFilterValues?.length,
  );

  return (
    <Box p="sm" data-testid="dashboard-page">
      <Head>
        <title>Dashboard – {brandName}</title>
      </Head>
      <OnboardingModal />
      <EditTileModal
        dashboardId={dashboardId}
        chart={editedTile}
        onClose={() => {
          if (!isSaving) setEditedTile(undefined);
        }}
        dateRange={searchedTimeRange}
        isSaving={isSaving}
        onSave={newChart => {
          if (dashboard == null) {
            return;
          }
          setIsSaving(true);
          setDashboard(
            produce(dashboard, draft => {
              const chartIndex = draft.tiles.findIndex(
                chart => chart.id === newChart.id,
              );
              // This is a new chart (probably?)
              if (chartIndex === -1) {
                draft.tiles.push(newChart);
              } else {
                draft.tiles[chartIndex] = newChart;
              }
            }),
            () => {
              setEditedTile(undefined);
              setIsSaving(false);
            },
            () => {
              setIsSaving(false);
            },
          );
        }}
      />
      {IS_LOCAL_MODE === false && isLocalDashboard && (
        <Paper my="lg" p="md" data-testid="temporary-dashboard-banner">
          <Flex justify="space-between" align="center">
            <Text size="sm">
              This is a temporary dashboard and can not be saved.
            </Text>
            <Button variant="primary" fw={400} onClick={onCreateDashboard}>
              Create New Saved Dashboard
            </Button>
          </Flex>
        </Paper>
      )}
      <Flex mt="xs" mb="md" justify="space-between" align="center">
        <DashboardName
          key={`${dashboardHash}`}
          name={dashboard?.name ?? ''}
          onSave={editedName => {
            if (dashboard != null) {
              setDashboard({
                ...dashboard,
                name: editedName,
              });
            }
          }}
        />
        <Group gap="xs">
          {!isLocalDashboard && dashboard?.id && (
            <Tags
              allowCreate
              values={dashboard?.tags || []}
              onChange={handleUpdateTags}
            >
              <Button
                variant="secondary"
                px="xs"
                size="xs"
                style={{ flexShrink: 0 }}
              >
                <IconTags size={14} className="me-2" />
                {dashboard?.tags?.length || 0}{' '}
                {dashboard?.tags?.length === 1 ? 'Tag' : 'Tags'}
              </Button>
            </Tags>
          )}
          {!isLocalDashboard /* local dashboards cant be "deleted" */ && (
            <Menu width={250}>
              <Menu.Target>
                <ActionIcon
                  variant="secondary"
                  size="input-xs"
                  data-testid="dashboard-menu-button"
                >
                  <IconDotsVertical size={14} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                {hasTiles && (
                  <Menu.Item
                    leftSection={<IconDownload size={16} />}
                    onClick={() => {
                      if (!sources || !dashboard) {
                        notifications.show({
                          color: 'red',
                          message: 'Export Failed',
                        });
                        return;
                      }
                      downloadObjectAsJson(
                        convertToDashboardTemplate(
                          dashboard,
                          // TODO: fix this type issue
                          sources as TSourceUnion[],
                        ),
                        dashboard?.name,
                      );
                    }}
                  >
                    Export Dashboard
                  </Menu.Item>
                )}
                <Menu.Item
                  leftSection={<IconUpload size={16} />}
                  onClick={() => {
                    if (dashboard && !dashboard.tiles.length) {
                      router.push(
                        `/dashboards/import?dashboardId=${dashboard.id}`,
                      );
                    } else {
                      router.push('/dashboards/import');
                    }
                  }}
                >
                  {hasTiles ? 'Import New Dashboard' : 'Import Dashboard'}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  data-testid="save-default-query-filters-menu-item"
                  leftSection={<IconDeviceFloppy size={16} />}
                  onClick={handleSaveQuery}
                >
                  {hasSavedQueryAndFilterDefaults
                    ? 'Update Default Query & Filters'
                    : 'Save Query & Filters as Default'}
                </Menu.Item>
                {hasSavedQueryAndFilterDefaults && (
                  <Menu.Item
                    data-testid="remove-default-query-filters-menu-item"
                    leftSection={<IconX size={16} />}
                    color="red"
                    onClick={handleRemoveSavedQuery}
                  >
                    Remove Default Query & Filters
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconTrash size={16} />}
                  color="red"
                  onClick={() =>
                    deleteDashboard.mutate(dashboard?.id ?? '', {
                      onSuccess: () => {
                        router.push('/dashboards');
                      },
                    })
                  }
                >
                  Delete Dashboard
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        {/* <Button variant="outline" size="sm">
          Save
        </Button> */}
      </Flex>
      <Flex
        gap="sm"
        mt="sm"
        component="form"
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Controller
          control={control}
          name="whereLanguage"
          render={({ field }) =>
            field.value === 'sql' ? (
              <SQLInlineEditorControlled
                tableConnections={tableConnections}
                control={control}
                name="where"
                placeholder="SQL WHERE clause (ex. column = 'foo')"
                onLanguageChange={lang => setValue('whereLanguage', lang)}
                language="sql"
                onSubmit={onSubmit}
                label="GLOBAL WHERE"
                enableHotkey
                allowMultiline={true}
              />
            ) : (
              <SearchInputV2
                tableConnections={tableConnections}
                control={control}
                name="where"
                onLanguageChange={lang => setValue('whereLanguage', lang)}
                language="lucene"
                placeholder="Search your events w/ Lucene ex. column:foo"
                enableHotkey
                data-testid="search-input"
                onSubmit={onSubmit}
              />
            )
          }
        />
        <TimePicker
          inputValue={displayedTimeInputValue}
          setInputValue={setDisplayedTimeInputValue}
          onSearch={range => {
            onSearch(range);
          }}
        />
        <GranularityPickerControlled control={control} name="granularity" />
        <Tooltip
          withArrow
          label={
            isRefreshEnabled
              ? `Auto-refreshing with ${granularityOverride} interval`
              : 'Enable auto-refresh'
          }
          fz="xs"
          color="gray"
        >
          <Button
            onClick={() => setIsLive(prev => !prev)}
            size="sm"
            variant={isLive ? 'primary' : 'secondary'}
            title={isLive ? 'Disable auto-refresh' : 'Enable auto-refresh'}
          >
            Live
          </Button>
        </Tooltip>
        <Tooltip withArrow label="Refresh dashboard" fz="xs" color="gray">
          <ActionIcon
            onClick={refresh}
            loading={manualRefreshCooloff}
            disabled={manualRefreshCooloff}
            variant="secondary"
            title="Refresh dashboard"
            size="input-sm"
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
        {!IS_LOCAL_MODE && (
          <Tooltip withArrow label="Edit Filters" fz="xs" color="gray">
            <ActionIcon
              variant="secondary"
              onClick={() => setShowFiltersModal(true)}
              data-testid="edit-filters-button"
              size="input-sm"
            >
              <IconFilterEdit size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Button
          data-testid="search-submit-button"
          variant="primary"
          type="submit"
          leftSection={<IconPlayerPlay size={16} />}
          style={{ flexShrink: 0 }}
        >
          Run
        </Button>
      </Flex>
      <DashboardFilters
        filters={filters}
        filterValues={filterValues}
        onSetFilterValue={setFilterValue}
        dateRange={searchedTimeRange}
      />
      <Box mt="sm">
        {dashboard != null && dashboard.tiles != null ? (
          <ErrorBoundary
            onError={console.error}
            fallback={
              <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                An error occurred while rendering the dashboard.
              </div>
            }
          >
            <ReactGridLayout
              layout={layout}
              containerPadding={[0, 0]}
              onLayoutChange={newLayout => {
                // compare x, y, h, w between newLayout and layout to see if anything has changed
                // if so, update the dashboard
                // this will prevent spurious updates to the dashboard,
                // that messes with router/URL state due to
                // qparam being used to store dashboard state
                // also it reduced network requests
                let hasDiff = false;
                if (newLayout.length !== layout.length) {
                  hasDiff = true;
                } else {
                  for (let i = 0; i < newLayout.length; i++) {
                    const curr = newLayout[i];
                    const oldLayout = layout.find(l => l.i === curr.i);
                    if (
                      oldLayout?.x !== curr.x ||
                      oldLayout?.y !== curr.y ||
                      oldLayout?.h !== curr.h ||
                      oldLayout?.w !== curr.w
                    ) {
                      hasDiff = true;
                      break;
                    }
                  }
                }

                if (hasDiff) {
                  setDashboard(produce(dashboard, updateLayout(newLayout)));
                }
              }}
              cols={24}
              rowHeight={32}
            >
              {tiles}
            </ReactGridLayout>
          </ErrorBoundary>
        ) : null}
      </Box>
      <Button
        data-testid="add-new-tile-button"
        variant={dashboard?.tiles.length === 0 ? 'primary' : 'secondary'}
        mt="sm"
        fw={400}
        onClick={onAddTile}
        w="100%"
      >
        + Add New Tile
      </Button>
      <DashboardFiltersModal
        opened={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onSaveFilter={handleSaveFilter}
        onRemoveFilter={handleRemoveFilter}
        isLoading={isSavingDashboard || isFetchingDashboard}
      />
    </Box>
  );
}

const DBDashboardPageDynamic = dynamic(async () => DBDashboardPage, {
  ssr: false,
});

// @ts-expect-error for getLayout
DBDashboardPageDynamic.getLayout = withAppNav;

export default DBDashboardPageDynamic;
