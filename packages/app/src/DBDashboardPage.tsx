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
import { pick } from 'lodash';
import { parseAsString, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { convertToDashboardTemplate } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderChartConfig,
  isBuilderSavedChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AlertState,
  ChartConfigWithDateRange,
  DashboardContainer,
  DashboardFilter,
  DisplayType,
  Filter,
  isLogSource,
  isTraceSource,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  SQLInterval,
  TSource,
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
  IconLayoutList,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconTags,
  IconTrash,
  IconUpload,
  IconX,
  IconZoomExclamation,
} from '@tabler/icons-react';

import { ContactSupportText } from '@/components/ContactSupportText';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import DBNumberChart from '@/components/DBNumberChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import FullscreenPanelModal from '@/components/FullscreenPanelModal';
import SectionHeader from '@/components/SectionHeader';
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
import SearchWhereInput, {
  getStoredLanguage,
} from './components/SearchInput/SearchWhereInput';
import { Tags } from './components/Tags';
import useDashboardFilters from './hooks/useDashboardFilters';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { parseAsJsonEncoded, parseAsStringEncoded } from './utils/queryParsers';
import { buildTableRowSearchUrl, DEFAULT_CHART_CONFIG } from './ChartUtils';
import { useConnections } from './connection';
import { useDashboard } from './dashboard';
import DashboardFilters from './DashboardFilters';
import DashboardFiltersModal from './DashboardFiltersModal';
import { GranularityPickerControlled } from './GranularityPicker';
import HDXMarkdownChart from './HDXMarkdownChart';
import { withAppNav } from './layout';
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

const tileToLayoutItem = (chart: Tile): RGL.Layout => ({
  i: chart.id,
  x: chart.x,
  y: chart.y,
  w: chart.w,
  h: chart.h,
  minH: 1,
  minW: 1,
});

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const whereLanguageParser = parseAsString.withDefault(
  typeof window !== 'undefined' ? (getStoredLanguage() ?? 'lucene') : 'lucene',
);

const Tile = forwardRef(
  (
    {
      chart,
      dateRange,
      onDuplicateClick,
      onEditClick,
      onDeleteClick,
      onUpdateChart,
      onMoveToSection,
      containers: availableSections,
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
      onMoveToSection?: (containerId: string | undefined) => void;
      containers?: DashboardContainer[];
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
      if (isRawSqlSavedChartConfig(chart.config)) {
        // Some raw SQL charts don't have a source
        if (!chart.config.source) {
          setQueriedConfig({
            ...chart.config,
            dateRange,
            granularity,
            filters,
          });
        } else if (source != null) {
          setQueriedConfig({
            ...chart.config,
            // Populate these two columns from the source to support Lucene-based filters
            ...pick(source, ['implicitColumnExpression', 'from']),
            dateRange,
            granularity,
            filters,
          });
        }

        return;
      }

      if (source != null && isBuilderSavedChartConfig(chart.config)) {
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
            implicitColumnExpression:
              isLogSource(source) || isTraceSource(source)
                ? source.implicitColumnExpression
                : undefined,
            filters,
            metricTables: isMetricSource ? source.metricTables : undefined,
          });
        }
      }
    }, [source, chart, dateRange, granularity, filters]);

    const [hovered, setHovered] = useState(false);

    const alert = isBuilderSavedChartConfig(chart.config)
      ? chart.config.alert
      : undefined;
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
        // eslint-disable-next-line no-restricted-syntax
        tooltip += `. Ack'd ${formatRelative(silencedAt, new Date())}`;
      }
      return tooltip;
    }, [alert]);

    const filterWarning = useMemo(() => {
      const doFiltersExist = !!filters?.filter(
        f => (f.type === 'lucene' || f.type === 'sql') && f.condition.trim(),
      )?.length;

      if (
        !doFiltersExist ||
        !queriedConfig ||
        !isRawSqlChartConfig(queriedConfig)
      )
        return null;

      const isMissingSourceForFiltering = !queriedConfig.source;
      const isMissingFiltersMacro =
        !queriedConfig.sqlTemplate.includes('$__filters');

      if (!isMissingSourceForFiltering && !isMissingFiltersMacro) return null;

      const message = isMissingFiltersMacro
        ? 'Filters are not applied because the SQL does not include the required $__filters macro'
        : 'Filters are not applied because no Source is set for this chart';

      return (
        <Tooltip multiline maw={500} label={message} key="filter-warning">
          <IconZoomExclamation size={16} color="var(--color-text-danger)" />
        </Tooltip>
      );
    }, [filters, queriedConfig]);

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
          {onMoveToSection &&
            availableSections &&
            availableSections.length > 0 && (
              <Menu width={200} position="bottom-end">
                <Menu.Target>
                  <ActionIcon
                    data-testid={`tile-move-section-button-${chart.id}`}
                    variant="subtle"
                    size="sm"
                    title="Move to Section"
                  >
                    <IconLayoutList size={14} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Move to Section</Menu.Label>
                  {chart.containerId && (
                    <Menu.Item onClick={() => onMoveToSection(undefined)}>
                      (Ungrouped)
                    </Menu.Item>
                  )}
                  {availableSections
                    .filter(s => s.id !== chart.containerId)
                    .map(s => (
                      <Menu.Item
                        key={s.id}
                        onClick={() => onMoveToSection(s.id)}
                      >
                        {s.title}
                      </Menu.Item>
                    ))}
                </Menu.Dropdown>
              </Menu>
            )}
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
      availableSections,
      chart.config.displayType,
      chart.id,
      chart.containerId,
      hovered,
      onDeleteClick,
      onDuplicateClick,
      onEditClick,
      onMoveToSection,
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
        const toolbar = hideToolbar
          ? [filterWarning]
          : [hoverToolbar, filterWarning];
        const keyPrefix = isFullscreenView ? 'fullscreen' : 'tile';

        // Markdown charts may not have queriedConfig, if config.source is not set
        const effectiveMarkdownConfig = queriedConfig ?? chart.config;

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
                  getRowSearchLink={
                    isBuilderChartConfig(queriedConfig)
                      ? row =>
                          buildTableRowSearchUrl({
                            row,
                            source,
                            config: queriedConfig,
                            dateRange: dateRange,
                          })
                      : undefined
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
            {effectiveMarkdownConfig?.displayType === DisplayType.Markdown &&
              'markdown' in effectiveMarkdownConfig && (
                <HDXMarkdownChart
                  key={`${keyPrefix}-${chart.id}`}
                  title={title}
                  toolbarItems={toolbar}
                  config={effectiveMarkdownConfig}
                />
              )}
            {queriedConfig?.displayType === DisplayType.Search &&
              isBuilderChartConfig(queriedConfig) &&
              isBuilderSavedChartConfig(chart.config) && (
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
                        (source?.kind === SourceKind.Log ||
                        source?.kind === SourceKind.Trace
                          ? source.defaultTableSelectExpression
                          : '') ||
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
        filterWarning,
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
        if (ok) {
          // Reset dirty state before closing so any re-invocation of
          // handleClose (e.g. from Mantine focus management after the
          // confirm modal closes) doesn't re-show the confirm dialog.
          setHasUnsavedChanges(false);
          onClose();
        }
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
            isDashboardForm
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
  const { data: connections } = useConnections();

  const [highlightedTileId] = useQueryState('highlightedTileId');
  const tableConnections = useMemo(() => {
    if (!dashboard) return [];
    const tc: TableConnection[] = [];

    for (const { config } of dashboard.tiles) {
      if (!isBuilderSavedChartConfig(config)) continue;
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
    parseAsStringEncoded.withDefault(''),
  );
  const [whereLanguage, setWhereLanguage] = useQueryState(
    'whereLanguage',
    whereLanguageParser,
  );
  // Get raw filter queries from URL (not processed by hook)
  const [rawFilterQueries] = useQueryState(
    'filters',
    parseAsJsonEncoded<Filter[]>(),
  );

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
      whereLanguage:
        (whereLanguage as SearchConditionLanguage) ??
        getStoredLanguage() ??
        'lucene',
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
      : [];

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
        draft.savedFilterValues = [];
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

  const onAddTile = (containerId?: string) => {
    // Auto-expand collapsed section so the new tile is visible
    if (containerId && dashboard) {
      const section = dashboard.containers?.find(s => s.id === containerId);
      if (section?.collapsed) {
        setDashboard(
          produce(dashboard, draft => {
            const s = draft.containers?.find(c => c.id === containerId);
            if (s) s.collapsed = false;
          }),
        );
      }
    }
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
      ...(containerId ? { containerId } : {}),
    });
  };

  const sections = useMemo(
    () => dashboard?.containers ?? [],
    [dashboard?.containers],
  );
  const hasSections = sections.length > 0;
  const allTiles = useMemo(() => dashboard?.tiles ?? [], [dashboard?.tiles]);

  const handleMoveTileToSection = useCallback(
    (tileId: string, containerId: string | undefined) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const tile = draft.tiles.find(t => t.id === tileId);
          if (tile) {
            if (containerId) tile.containerId = containerId;
            else delete tile.containerId;
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const renderTileComponent = useCallback(
    (chart: Tile) => (
      <Tile
        key={chart.id}
        chart={chart}
        dateRange={searchedTimeRange}
        onEditClick={() => setEditedTile(chart)}
        granularity={
          isRefreshEnabled ? granularityOverride : (granularity ?? undefined)
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
          if (!dashboard) return;
          setDashboard(
            produce(dashboard, draft => {
              const chartIndex = draft.tiles.findIndex(c => c.id === chart.id);
              if (chartIndex === -1) return;
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
        containers={sections}
        onMoveToSection={containerId =>
          handleMoveTileToSection(chart.id, containerId)
        }
      />
    ),
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
      sections,
      handleMoveTileToSection,
    ],
  );

  const makeOnLayoutChange = useCallback(
    (gridTiles: Tile[]) => (newLayout: RGL.Layout[]) => {
      if (!dashboard) return;
      const currentLayout = gridTiles.map(tileToLayoutItem);
      let hasDiff = false;
      if (newLayout.length !== currentLayout.length) {
        hasDiff = true;
      } else {
        for (const curr of newLayout) {
          const old = currentLayout.find(l => l.i === curr.i);
          if (
            old?.x !== curr.x ||
            old?.y !== curr.y ||
            old?.h !== curr.h ||
            old?.w !== curr.w
          ) {
            hasDiff = true;
            break;
          }
        }
      }
      if (hasDiff) {
        setDashboard(produce(dashboard, updateLayout(newLayout)));
      }
    },
    [dashboard, setDashboard],
  );

  // Intentionally persists collapsed state to the server via setDashboard
  // (same pattern as tile drag/resize). This matches Grafana and Kibana
  // behavior where collapsed state is saved with the dashboard for all viewers.
  const handleToggleSection = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const section = draft.containers?.find(s => s.id === containerId);
          if (section) section.collapsed = !section.collapsed;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleAddSection = useCallback(() => {
    if (!dashboard) return;
    setDashboard(
      produce(dashboard, draft => {
        if (!draft.containers) draft.containers = [];
        draft.containers.push({
          id: makeId(),
          type: 'section',
          title: 'New Section',
          collapsed: false,
        });
      }),
    );
  }, [dashboard, setDashboard]);

  const handleRenameSection = useCallback(
    (containerId: string, newTitle: string) => {
      if (!dashboard || !newTitle.trim()) return;
      setDashboard(
        produce(dashboard, draft => {
          const section = draft.containers?.find(s => s.id === containerId);
          if (section) section.title = newTitle.trim();
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleDeleteSection = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          // Find the bottom edge of existing ungrouped tiles so freed
          // tiles are placed below them without collision.
          const sectionIds = new Set(draft.containers?.map(c => c.id) ?? []);
          let maxUngroupedY = 0;
          for (const tile of draft.tiles) {
            if (!tile.containerId || !sectionIds.has(tile.containerId)) {
              maxUngroupedY = Math.max(maxUngroupedY, tile.y + tile.h);
            }
          }

          for (const tile of draft.tiles) {
            if (tile.containerId === containerId) {
              tile.y += maxUngroupedY;
              delete tile.containerId;
            }
          }

          draft.containers = draft.containers?.filter(
            s => s.id !== containerId,
          );
        }),
      );
    },
    [dashboard, setDashboard],
  );

  // Group tiles by section; orphaned tiles (containerId not matching any
  // section) fall back to ungrouped to avoid silently hiding them.
  const tilesByContainerId = useMemo(() => {
    const map = new Map<string, Tile[]>();
    for (const section of sections) {
      map.set(
        section.id,
        allTiles.filter(t => t.containerId === section.id),
      );
    }
    return map;
  }, [sections, allTiles]);

  const ungroupedTiles = useMemo(
    () =>
      hasSections
        ? allTiles.filter(
            t => !t.containerId || !tilesByContainerId.has(t.containerId),
          )
        : allTiles,
    [hasSections, allTiles, tilesByContainerId],
  );

  const onUngroupedLayoutChange = useMemo(
    () => makeOnLayoutChange(ungroupedTiles),
    [makeOnLayoutChange, ungroupedTiles],
  );

  const sectionLayoutChangeHandlers = useMemo(() => {
    const map = new Map<string, (newLayout: RGL.Layout[]) => void>();
    for (const section of sections) {
      const tiles = tilesByContainerId.get(section.id) ?? [];
      map.set(section.id, makeOnLayoutChange(tiles));
    }
    return map;
  }, [sections, tilesByContainerId, makeOnLayoutChange]);

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
      {isLocalDashboard && (
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
                          sources,
                          connections,
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
                <Menu.Item
                  data-testid="add-new-section-button"
                  leftSection={<IconLayoutList size={16} />}
                  onClick={handleAddSection}
                >
                  Add Section
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
        wrap="wrap"
        component="form"
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <SearchWhereInput
          tableConnections={tableConnections}
          control={control}
          name="where"
          onSubmit={onSubmit}
          onLanguageChange={(lang: 'sql' | 'lucene') =>
            setValue('whereLanguage', lang)
          }
          label="WHERE"
          enableHotkey
          allowMultiline
          minWidth={300}
          data-testid="search-input"
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
            {hasSections ? (
              <>
                {ungroupedTiles.length > 0 && (
                  <ReactGridLayout
                    layout={ungroupedTiles.map(tileToLayoutItem)}
                    containerPadding={[0, 0]}
                    onLayoutChange={onUngroupedLayoutChange}
                    cols={24}
                    rowHeight={32}
                  >
                    {ungroupedTiles.map(renderTileComponent)}
                  </ReactGridLayout>
                )}
                {sections.map(section => {
                  const sectionTiles = tilesByContainerId.get(section.id) ?? [];
                  return (
                    <div key={section.id}>
                      <SectionHeader
                        section={section}
                        tileCount={sectionTiles.length}
                        onToggle={() => handleToggleSection(section.id)}
                        onRename={newTitle =>
                          handleRenameSection(section.id, newTitle)
                        }
                        onDelete={() => handleDeleteSection(section.id)}
                        onAddTile={() => onAddTile(section.id)}
                      />
                      {!section.collapsed && sectionTiles.length > 0 && (
                        <ReactGridLayout
                          layout={sectionTiles.map(tileToLayoutItem)}
                          containerPadding={[0, 0]}
                          onLayoutChange={sectionLayoutChangeHandlers.get(
                            section.id,
                          )}
                          cols={24}
                          rowHeight={32}
                        >
                          {sectionTiles.map(renderTileComponent)}
                        </ReactGridLayout>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              <ReactGridLayout
                layout={ungroupedTiles.map(tileToLayoutItem)}
                containerPadding={[0, 0]}
                onLayoutChange={onUngroupedLayoutChange}
                cols={24}
                rowHeight={32}
              >
                {ungroupedTiles.map(renderTileComponent)}
              </ReactGridLayout>
            )}
          </ErrorBoundary>
        ) : null}
      </Box>
      <Button
        data-testid="add-new-tile-button"
        variant={dashboard?.tiles.length === 0 ? 'primary' : 'secondary'}
        mt="sm"
        fw={400}
        onClick={() => onAddTile()}
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
