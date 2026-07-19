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
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatDistanceToNow, formatRelative } from 'date-fns';
import produce from 'immer';
import { pick } from 'lodash';
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  useQueryState,
} from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import {
  convertToDashboardTemplate,
  displayTypeSupportsBuilderAlerts,
  displayTypeSupportsPromQLAlerts,
  displayTypeSupportsRawSqlAlerts,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  displayTypeRequiresSource,
  isBuilderChartConfig,
  isBuilderSavedChartConfig,
  isPromqlSavedChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AlertState,
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DashboardContainer as DashboardContainerSchema,
  DashboardFilter,
  DisplayType,
  Filter,
  getSampleWeightExpression,
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
  Alert,
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Flex,
  Group,
  Indicator,
  Menu,
  Modal,
  Paper,
  Popover,
  Portal,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue, useHotkeys, useInViewport } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconBell,
  IconBellPlus,
  IconChartBar,
  IconChevronsDown,
  IconChevronsUp,
  IconCopy,
  IconCornerDownRight,
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconFilterEdit,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSquaresDiagonal,
  IconTags,
  IconTimelineEvent,
  IconTrash,
  IconUpload,
  IconX,
  IconZoomExclamation,
} from '@tabler/icons-react';

import { IsolatedChartSyncProvider } from '@/chartSync';
import { ContactSupportText } from '@/components/ContactSupportText';
import DashboardContainer from '@/components/DashboardContainer';
import {
  EmptyContainerPlaceholder,
  SortableContainerWrapper,
} from '@/components/DashboardDndComponents';
import {
  DashboardDndProvider,
  type DragHandleProps,
} from '@/components/DashboardDndContext';
import DashboardTableOfContents from '@/components/DashboardTableOfContents';
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import DBNumberChart from '@/components/DBNumberChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { FavoriteButton } from '@/components/FavoriteButton';
import FullscreenPanelModal from '@/components/FullscreenPanelModal';
import { PageHeader } from '@/components/PageHeader';
import { PageLayout } from '@/components/PageLayout';
import { TimePicker } from '@/components/TimePicker';
import { parseTimeRangeInput } from '@/components/TimePicker/utils';
import {
  Dashboard,
  type Tile,
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
} from '@/dashboard';
import { useAlertAnnotations } from '@/hooks/useAlertAnnotations';
import useDashboardContainers, {
  TabDeleteAction,
} from '@/hooks/useDashboardContainers';
import { calculateNextTilePosition, makeId } from '@/utils/tilePositioning';

import ChartContainer, {
  ChartContainerCardHeaderProvider,
  CollapsedToolbarProvider,
  DASHBOARD_TILE_PADDING_INLINE,
} from './components/charts/ChartContainer';
import { DBBarChart } from './components/DBBarChart';
import DBHeatmapChart, {
  toHeatmapChartConfig,
} from './components/DBHeatmapChart';
import { DBPieChart } from './components/DBPieChart';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import OnboardingModal from './components/OnboardingModal';
import PatternTable from './components/PatternTable';
import SearchWhereInput, {
  getStoredLanguage,
} from './components/SearchInput/SearchWhereInput';
import { Tags } from './components/Tags';
import useDashboardFilters from './hooks/useDashboardFilters';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import useTileSelection from './hooks/useTileSelection';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { parseAsJsonEncoded, parseAsStringEncoded } from './utils/queryParsers';
import {
  buildEventsSearchUrl,
  buildTableRowSearchUrl,
  DEFAULT_CHART_CONFIG,
} from './ChartUtils';
import { useConnections } from './connection';
import { useDashboard } from './dashboard';
import DashboardFilters from './DashboardFilters';
import DashboardFiltersModal from './DashboardFiltersModal';
import { EditablePageName } from './EditablePageName';
import {
  GranularityPicker,
  GranularityPickerControlled,
} from './GranularityPicker';
import HDXMarkdownChart from './HDXMarkdownChart';
import { withAppNav } from './layout';
import {
  getEventBody,
  getFirstTimestampValueExpression,
  isSingleExpression,
  useSource,
  useSources,
} from './source';
import {
  dateRangeToString,
  parseTimeQuery,
  useNewTimeQuery,
} from './timeQuery';
import { useConfirm } from './useConfirm';
import { FormatTime } from './useFormatTime';
import { useUserPreferences } from './useUserPreferences';
import { getMetricTableName, useLocalStorage } from './utils';
import { useZIndex, ZIndexContext } from './zIndex';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

function HeatmapTile({
  keyPrefix,
  chartId,
  title,
  toolbarPrefix,
  toolbarSuffix,
  queriedConfig,
  source,
  dateRange,
  enabled = true,
}: {
  keyPrefix: string;
  chartId: string;
  title: React.ReactNode;
  toolbarPrefix: React.ReactNode[];
  toolbarSuffix: React.ReactNode[];
  queriedConfig: BuilderChartConfigWithDateRange;
  source: TSource | undefined;
  dateRange: [Date, Date];
  enabled?: boolean;
}) {
  const { heatmapConfig, scaleType } = toHeatmapChartConfig(queriedConfig);

  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const eventDeltasUrl = useMemo(() => {
    if (!source) return null;
    const url = buildEventsSearchUrl({
      source,
      config: queriedConfig,
      dateRange,
    });
    if (!url) return null;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}mode=delta`;
  }, [source, queriedConfig, dateRange]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!eventDeltasUrl) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setClickPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [eventDeltasUrl],
  );

  const dismiss = useCallback(() => setClickPos(null), []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onClick={handleClick}
    >
      <DBHeatmapChart
        key={`${keyPrefix}-${chartId}`}
        title={title}
        toolbarPrefix={toolbarPrefix}
        toolbarSuffix={toolbarSuffix}
        config={heatmapConfig}
        scaleType={scaleType}
        enabled={enabled}
        showLegend
      />
      {clickPos != null && eventDeltasUrl != null && (
        <>
          <Portal>
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 199,
              }}
              onClick={e => {
                e.stopPropagation();
                e.preventDefault();
                dismiss();
              }}
              onMouseDown={e => e.stopPropagation()}
            />
          </Portal>
          <Popover
            opened
            onChange={opened => {
              if (!opened) dismiss();
            }}
            position="bottom-start"
            offset={4}
            withinPortal
            closeOnEscape
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <div
                style={{
                  position: 'absolute',
                  left: clickPos.x,
                  top: clickPos.y,
                  width: 1,
                  height: 1,
                  pointerEvents: 'none',
                }}
              />
            </Popover.Target>
            <Popover.Dropdown
              p="xs"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <Link
                data-testid="heatmap-view-event-deltas-link"
                href={eventDeltasUrl}
                onClick={dismiss}
              >
                <Group gap="xs">
                  <IconSearch size={16} />
                  View in Event Deltas
                </Group>
              </Link>
            </Popover.Dropdown>
          </Popover>
        </>
      )}
    </div>
  );
}

const ReactGridLayout = WidthProvider(RGL);

type MoveTarget = {
  containerId: string;
  tabId?: string;
  label: string;
  // For tabs: all tabs in order with the target tab ID
  allTabs?: { id: string; title: string }[];
};

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
      onMoveToGroup,
      moveTargets,
      granularity,
      onTimeRangeSelect,
      filters,
      showAlertAnnotations,

      // Properties forwarded by grid layout
      className,
      style,
      onMouseDown,
      onMouseUp,
      onTouchEnd,
      children,
      isHighlighted,
      isSelected,
      onSelect,
    }: {
      chart: Tile;
      dateRange: [Date, Date];
      onDuplicateClick: () => void;
      onEditClick: () => void;
      onAddAlertClick?: () => void;
      onDeleteClick: () => void;
      onUpdateChart?: (chart: Tile) => void;
      onMoveToGroup?: (containerId: string | undefined, tabId?: string) => void;
      moveTargets?: MoveTarget[];
      onSettled?: () => void;
      granularity: SQLInterval | undefined;
      onTimeRangeSelect: (start: Date, end: Date) => void;
      filters?: Filter[];
      // When true, draw alert firing/recovery annotations on this tile's chart.
      showAlertAnnotations?: boolean;

      // Properties forwarded by grid layout
      className?: string;
      style?: React.CSSProperties;
      onMouseDown?: (e: React.MouseEvent) => void;
      onMouseUp?: (e: React.MouseEvent) => void;
      onTouchEnd?: (e: React.TouchEvent) => void;
      children?: React.ReactNode; // Resizer tooltip
      isHighlighted?: boolean;
      isSelected?: boolean;
      onSelect?: (tileId: string) => void;
    },
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Lazy loading: only fetch a tile's data once it has scrolled into the
    // browser viewport. React Grid Layout mounts every tile up front, so
    // without this gating each tile would issue its ClickHouse query
    // immediately, regardless of whether it is visible. We debounce the
    // viewport signal (RGL briefly renders all tiles before the layout
    // settles) and make visibility "sticky" so that a tile keeps its data
    // once loaded instead of refetching every time it scrolls back into view.
    const { ref: inViewportRef, inViewport } = useInViewport();
    const [debouncedInViewport] = useDebouncedValue(inViewport, 200);
    // Latch to true the first time the tile becomes visible and never flip
    // back, so a loaded tile keeps its data instead of refetching every time
    // it scrolls out of and back into view. Adjusting state during render (the
    // React-recommended pattern for deriving state from changing inputs) is
    // cheaper than an effect and only fires once, since the condition is false
    // after the first visible render.
    const [hasBeenVisible, setHasBeenVisible] = useState(false);
    if (debouncedInViewport && !hasBeenVisible) {
      setHasBeenVisible(true);
    }

    const {
      userPreferences: { isUTC },
    } = useUserPreferences();

    // Date range and granularity state local to the fullscreen view so that
    // changing them does not propagate up to the dashboard.
    const [fullscreenDateRange, setFullscreenDateRange] =
      useState<[Date, Date]>(dateRange);
    const [fullscreenInputValue, setFullscreenInputValue] = useState<string>(
      () => dateRangeToString(dateRange, isUTC),
    );
    const [fullscreenGranularity, setFullscreenGranularity] = useState<
      Granularity | 'auto' | undefined
    >(() => (granularity as Granularity | undefined) ?? 'auto');

    const openFullscreen = useCallback(() => {
      // Reinitialize to the dashboard's current date range and granularity
      // each time the fullscreen view is opened.
      setFullscreenDateRange(dateRange);
      setFullscreenInputValue(dateRangeToString(dateRange, isUTC));
      setFullscreenGranularity(
        (granularity as Granularity | undefined) ?? 'auto',
      );
      setIsFullscreen(true);
    }, [dateRange, granularity, isUTC]);

    const handleFullscreenSearch = useCallback(
      (value: string) => {
        const [start, end] = parseTimeRangeInput(value, isUTC);
        if (start != null && end != null) {
          setFullscreenDateRange([start, end]);
        }
      },
      [isUTC],
    );

    useEffect(() => {
      if (isHighlighted) {
        document
          .getElementById(`chart-${chart.id}`)
          ?.scrollIntoView({ behavior: 'smooth' });
      }
    }, [chart.id, isHighlighted]);

    // YouTube-style 'f' key shortcut for fullscreen toggle
    useHotkeys([
      [
        'f',
        () => {
          if (!isFocused) return;
          if (isFullscreen) {
            setIsFullscreen(false);
          } else {
            openFullscreen();
          }
        },
      ],
    ]);

    const [queriedConfig, setQueriedConfig] = useState<
      ChartConfigWithDateRange | undefined
    >(undefined);

    const { data: source, isFetched: isSourceFetched } = useSource({
      id: chart.config.source,
    });

    const isSourceMissing =
      !!chart.config.source && isSourceFetched && source == null;
    const isSourceUnset =
      !!chart.config &&
      isBuilderSavedChartConfig(chart.config) &&
      displayTypeRequiresSource(chart.config.displayType) &&
      !chart.config.source;

    useEffect(() => {
      if (isPromqlSavedChartConfig(chart.config)) {
        if (source != null) {
          setQueriedConfig({
            ...chart.config,
            from: source.from,
            connection: source.connection,
            dateRange,
            granularity,
          });
        }
        return;
      }

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
            // Populate these columns from the source to support Lucene-based filters and metric table macros
            ...pick(source, [
              'implicitColumnExpression',
              'useTextIndexForImplicitColumn',
              'from',
              'metricTables',
            ]),
            ...(isLogSource(source)
              ? { bodyExpression: source.bodyExpression }
              : {}),
            sampleWeightExpression: getSampleWeightExpression(source),
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
            useTextIndexForImplicitColumn:
              isLogSource(source) || isTraceSource(source)
                ? source.useTextIndexForImplicitColumn
                : undefined,
            bodyExpression: isLogSource(source)
              ? source.bodyExpression
              : undefined,
            sampleWeightExpression: getSampleWeightExpression(source),
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
      if (alert.state === AlertState.PENDING) {
        return 'orange';
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

    // Firing/recovery markers for this tile's alert, scoped to the *visible*
    // window — the fullscreen range while the fullscreen view is open, else the
    // dashboard range (off unless the dashboard toggle is on).
    const alertAnnotations = useAlertAnnotations(
      alert?.id,
      isFullscreen ? fullscreenDateRange : dateRange,
      showAlertAnnotations,
    );

    const filterWarning = useMemo(() => {
      const doFiltersExist = !!filters?.filter(
        f => (f.type === 'lucene' || f.type === 'sql') && f.condition.trim(),
      )?.length;
      const doLuceneFiltersExist = !!filters?.filter(
        f => f.type === 'lucene' && f.condition.trim(),
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
      const isMetricsSourceWithLuceneFilter =
        source?.kind === SourceKind.Metric && doLuceneFiltersExist;

      if (
        !isMissingSourceForFiltering &&
        !isMissingFiltersMacro &&
        !isMetricsSourceWithLuceneFilter
      )
        return null;

      const message = isMissingFiltersMacro
        ? 'Filters are not applied because the SQL does not include the required $__filters macro'
        : isMetricsSourceWithLuceneFilter
          ? 'Lucene filters are not applied because they are not supported for metrics sources.'
          : 'Filters are not applied because no Source is set for this chart';

      return (
        <Tooltip multiline maw={500} label={message} key="filter-warning">
          <IconZoomExclamation size={16} color="var(--color-text-danger)" />
        </Tooltip>
      );
    }, [filters, queriedConfig, source]);

    const hoverToolbar = useMemo(() => {
      const isRawSql = isRawSqlSavedChartConfig(chart.config);
      const isPromQL = isPromqlSavedChartConfig(chart.config);
      const displayTypeSupportsAlerts = isRawSql
        ? displayTypeSupportsRawSqlAlerts(chart.config.displayType)
        : isPromQL
          ? displayTypeSupportsPromQLAlerts(chart.config.displayType)
          : displayTypeSupportsBuilderAlerts(chart.config.displayType);
      const canMoveToGroup =
        onMoveToGroup && moveTargets && moveTargets.length > 0;
      return (
        <Flex
          gap="0px"
          align="center"
          onMouseDown={e => e.stopPropagation()}
          key="hover-toolbar"
          my={2} // Margin to ensure that the Alert Indicator doesn't clip on non-Line/Bar display types
        >
          {displayTypeSupportsAlerts &&
            (alert ? (
              // Existing alert: bell with a colored status dot indicator.
              <Indicator
                size={alert.state === AlertState.OK ? 6 : 8}
                zIndex={1}
                color={alertIndicatorColor}
                processing={alert.state === AlertState.ALERT}
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
            ) : (
              // No alert yet: a dedicated "bell +" icon reads clearly on any
              // background, unlike an overlaid indicator badge.
              <Tooltip label={alertTooltip} withArrow>
                <ActionIcon
                  data-testid={`tile-alerts-button-${chart.id}`}
                  variant="subtle"
                  size="sm"
                  onClick={onEditClick}
                  mr={4}
                >
                  <IconBellPlus size={16} />
                </ActionIcon>
              </Tooltip>
            ))}

          <Menu width={220} position="bottom-end">
            <Menu.Target>
              <Tooltip label="More actions" position="top" withArrow>
                <ActionIcon
                  data-testid={`tile-actions-button-${chart.id}`}
                  variant="subtle"
                  size="sm"
                >
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown onMouseDown={e => e.stopPropagation()}>
              <Menu.Item
                data-testid={`tile-duplicate-button-${chart.id}`}
                leftSection={<IconCopy size={14} />}
                onClick={onDuplicateClick}
              >
                Duplicate
              </Menu.Item>
              <Menu.Item
                data-testid={`tile-fullscreen-button-${chart.id}`}
                leftSection={<IconArrowsMaximize size={14} />}
                onClick={() => openFullscreen()}
              >
                View fullscreen
              </Menu.Item>
              <Menu.Item
                data-testid={`tile-edit-button-${chart.id}`}
                leftSection={<IconPencil size={14} />}
                onClick={onEditClick}
              >
                Edit
              </Menu.Item>
              {canMoveToGroup && (
                <>
                  <Menu.Divider />
                  <Menu.Label>Move to Group</Menu.Label>
                  {chart.containerId && (
                    <Menu.Item
                      leftSection={<IconCornerDownRight size={14} />}
                      onClick={() => onMoveToGroup(undefined)}
                    >
                      (Ungrouped)
                    </Menu.Item>
                  )}
                  {moveTargets
                    .filter(
                      t =>
                        !(
                          t.containerId === chart.containerId &&
                          t.tabId === chart.tabId
                        ),
                    )
                    .map(t => (
                      <Menu.Item
                        key={`${t.containerId}-${t.tabId ?? ''}`}
                        leftSection={<IconCornerDownRight size={14} />}
                        onClick={() => onMoveToGroup(t.containerId, t.tabId)}
                      >
                        {t.allTabs ? (
                          <span>
                            {t.allTabs.map((tab, i) => (
                              <span key={tab.id}>
                                {i > 0 && (
                                  <span
                                    style={{
                                      color: 'var(--mantine-color-dimmed)',
                                    }}
                                  >
                                    {' | '}
                                  </span>
                                )}
                                <span
                                  style={
                                    tab.id !== t.tabId
                                      ? {
                                          color: 'var(--mantine-color-dimmed)',
                                        }
                                      : undefined
                                  }
                                >
                                  {tab.title}
                                </span>
                              </span>
                            ))}
                          </span>
                        ) : (
                          t.label
                        )}
                      </Menu.Item>
                    ))}
                </>
              )}
              <Menu.Divider />
              <Menu.Item
                data-testid={`tile-delete-button-${chart.id}`}
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={onDeleteClick}
              >
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Flex>
      );
    }, [
      alert,
      alertIndicatorColor,
      alertTooltip,
      moveTargets,
      chart.config,
      chart.id,
      chart.containerId,
      chart.tabId,
      onDeleteClick,
      onDuplicateClick,
      onEditClick,
      onMoveToGroup,
      openFullscreen,
    ]);

    // Flat Menu.Item list for the collapsed (narrow-tile) toolbar.
    // Merges the alert action + all kebab items into a single flat list
    // so ChartContainer can render them without nested menus.
    const collapsedMenuItems = useMemo(() => {
      const isRawSql = isRawSqlSavedChartConfig(chart.config);
      const isPromQL = isPromqlSavedChartConfig(chart.config);
      const showAlerts = isRawSql
        ? displayTypeSupportsRawSqlAlerts(chart.config.displayType)
        : isPromQL
          ? displayTypeSupportsPromQLAlerts(chart.config.displayType)
          : displayTypeSupportsBuilderAlerts(chart.config.displayType);
      const canMoveToGroup =
        onMoveToGroup && moveTargets && moveTargets.length > 0;
      return (
        <>
          {showAlerts && (
            <>
              <Menu.Item
                leftSection={
                  alert ? <IconBell size={14} /> : <IconBellPlus size={14} />
                }
                onClick={onEditClick}
              >
                {alertTooltip}
              </Menu.Item>
              <Menu.Divider />
            </>
          )}
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={onDuplicateClick}
          >
            Duplicate
          </Menu.Item>
          <Menu.Item
            leftSection={<IconArrowsMaximize size={14} />}
            onClick={() => openFullscreen()}
          >
            View fullscreen
          </Menu.Item>
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            onClick={onEditClick}
          >
            Edit
          </Menu.Item>
          {canMoveToGroup && (
            <>
              <Menu.Divider />
              <Menu.Label>Move to Group</Menu.Label>
              {chart.containerId && (
                <Menu.Item
                  leftSection={<IconCornerDownRight size={14} />}
                  onClick={() => onMoveToGroup(undefined)}
                >
                  (Ungrouped)
                </Menu.Item>
              )}
              {moveTargets
                .filter(
                  t =>
                    !(
                      t.containerId === chart.containerId &&
                      t.tabId === chart.tabId
                    ),
                )
                .map(t => (
                  <Menu.Item
                    key={`collapsed-${t.containerId}-${t.tabId ?? ''}`}
                    leftSection={<IconCornerDownRight size={14} />}
                    onClick={() => onMoveToGroup(t.containerId, t.tabId)}
                  >
                    {t.allTabs ? (
                      <span>
                        {t.allTabs.map((tab, i) => (
                          <span key={tab.id}>
                            {i > 0 && (
                              <span
                                style={{
                                  color: 'var(--mantine-color-dimmed)',
                                }}
                              >
                                {' | '}
                              </span>
                            )}
                            <span
                              style={
                                tab.id !== t.tabId
                                  ? {
                                      color: 'var(--mantine-color-dimmed)',
                                    }
                                  : undefined
                              }
                            >
                              {tab.title}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      t.label
                    )}
                  </Menu.Item>
                ))}
            </>
          )}
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={onDeleteClick}
          >
            Delete
          </Menu.Item>
        </>
      );
    }, [
      alert,
      alertTooltip,
      moveTargets,
      chart.config,
      chart.containerId,
      chart.tabId,
      onDeleteClick,
      onDuplicateClick,
      onEditClick,
      onMoveToGroup,
      openFullscreen,
    ]);

    const title = useMemo(
      () =>
        chart.config.name ? (
          <Text size="sm">{chart.config.name}</Text>
        ) : undefined,
      [chart.config.name],
    );

    // Render chart content (used in both tile and fullscreen views)
    const renderChartContent = useCallback(
      (hideToolbar: boolean = false, isFullscreenView: boolean = false) => {
        // Tile-level actions (alert bell + kebab) render as a suffix so they
        // sit to the right of each chart's own controls (display switcher,
        // granularity, etc.), keeping the kebab at the far right edge.
        const toolbarPrefixItems = [filterWarning];
        const toolbarSuffixItems = hideToolbar ? [] : [hoverToolbar];
        // Combined + ordered for containers that only accept `toolbarItems`
        // (they have no chart-specific controls to interleave).
        const toolbar = [...toolbarPrefixItems, ...toolbarSuffixItems];
        const keyPrefix = isFullscreenView ? 'fullscreen' : 'tile';

        // The fullscreen view is always visible, so it should always load.
        // In the tile (grid) view, gate data fetching on viewport visibility.
        const chartEnabled = isFullscreenView ? true : hasBeenVisible;

        // Use the fullscreen-local date range and granularity when rendering
        // inside the fullscreen modal so that changing them does not affect
        // the dashboard.
        const effectiveDateRange = isFullscreenView
          ? fullscreenDateRange
          : dateRange;
        const effectiveGranularity = isFullscreenView
          ? fullscreenGranularity
          : queriedConfig?.granularity;
        const effectiveQueriedConfig = queriedConfig
          ? {
              ...queriedConfig,
              dateRange: effectiveDateRange,
              granularity: effectiveGranularity,
            }
          : undefined;

        // Markdown charts may not have queriedConfig, if config.source is not set
        const effectiveMarkdownConfig = effectiveQueriedConfig ?? chart.config;

        return (
          <ErrorBoundary
            onError={console.error}
            fallback={
              <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                An error occurred while rendering the chart.
              </div>
            }
          >
            {isSourceMissing ? (
              <ChartContainer title={title} toolbarItems={toolbar}>
                <Stack align="center" justify="center" h="100%" p="md">
                  <Text size="sm" c="dimmed" ta="center">
                    The data source for this tile no longer exists. Edit the
                    tile to select a new source.
                  </Text>
                </Stack>
              </ChartContainer>
            ) : isSourceUnset ? (
              <ChartContainer title={title} toolbarItems={toolbar}>
                <Stack align="center" justify="center" h="100%" p="md">
                  <Text size="sm" c="dimmed" ta="center">
                    The data source for this tile is not set. Edit the tile to
                    select a data source.
                  </Text>
                </Stack>
              </ChartContainer>
            ) : (
              <>
                {(effectiveQueriedConfig?.displayType === DisplayType.Line ||
                  effectiveQueriedConfig?.displayType ===
                    DisplayType.StackedBar) && (
                  <DBTimeChart
                    key={`${keyPrefix}-${chart.id}`}
                    title={title}
                    toolbarPrefix={toolbarPrefixItems}
                    toolbarSuffix={toolbarSuffixItems}
                    sourceId={chart.config.source}
                    showDisplaySwitcher={true}
                    enabled={chartEnabled}
                    config={effectiveQueriedConfig}
                    annotations={alertAnnotations}
                    onTimeRangeSelect={
                      isFullscreenView
                        ? (start, end) => setFullscreenDateRange([start, end])
                        : onTimeRangeSelect
                    }
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
                {effectiveQueriedConfig?.displayType === DisplayType.Table && (
                  <Box h="100%">
                    <DBTableChart
                      key={`${keyPrefix}-${chart.id}`}
                      title={title}
                      toolbarPrefix={toolbarPrefixItems}
                      toolbarSuffix={toolbarSuffixItems}
                      enabled={chartEnabled}
                      config={effectiveQueriedConfig}
                      variant="default"
                      getRowSearchLink={
                        isBuilderChartConfig(effectiveQueriedConfig)
                          ? row =>
                              buildTableRowSearchUrl({
                                row,
                                source,
                                config: effectiveQueriedConfig,
                                dateRange: effectiveDateRange,
                              })
                          : undefined
                      }
                    />
                  </Box>
                )}
                {effectiveQueriedConfig?.displayType === DisplayType.Number && (
                  <DBNumberChart
                    key={`${keyPrefix}-${chart.id}`}
                    title={title}
                    toolbarPrefix={toolbarPrefixItems}
                    toolbarSuffix={toolbarSuffixItems}
                    enabled={chartEnabled}
                    config={effectiveQueriedConfig}
                  />
                )}
                {effectiveQueriedConfig?.displayType === DisplayType.Pie && (
                  <DBPieChart
                    key={`${keyPrefix}-${chart.id}`}
                    title={title}
                    toolbarPrefix={toolbarPrefixItems}
                    toolbarSuffix={toolbarSuffixItems}
                    enabled={chartEnabled}
                    config={effectiveQueriedConfig}
                  />
                )}
                {effectiveQueriedConfig?.displayType === DisplayType.Bar && (
                  <DBBarChart
                    key={`${keyPrefix}-${chart.id}`}
                    title={title}
                    toolbarPrefix={toolbarPrefixItems}
                    toolbarSuffix={toolbarSuffixItems}
                    enabled={chartEnabled}
                    config={effectiveQueriedConfig}
                  />
                )}
                {effectiveQueriedConfig?.displayType === DisplayType.Heatmap &&
                  isBuilderChartConfig(effectiveQueriedConfig) && (
                    <HeatmapTile
                      keyPrefix={keyPrefix}
                      chartId={chart.id}
                      title={title}
                      toolbarPrefix={toolbarPrefixItems}
                      toolbarSuffix={toolbarSuffixItems}
                      enabled={chartEnabled}
                      queriedConfig={effectiveQueriedConfig}
                      source={source}
                      dateRange={effectiveDateRange}
                    />
                  )}
                {effectiveMarkdownConfig?.displayType ===
                  DisplayType.Markdown &&
                  'markdown' in effectiveMarkdownConfig && (
                    <HDXMarkdownChart
                      key={`${keyPrefix}-${chart.id}`}
                      title={title}
                      toolbarItems={toolbar}
                      config={effectiveMarkdownConfig}
                    />
                  )}
                {effectiveQueriedConfig?.displayType === DisplayType.Search &&
                  isBuilderChartConfig(effectiveQueriedConfig) &&
                  isBuilderSavedChartConfig(chart.config) && (
                    <ChartContainer
                      title={title}
                      toolbarItems={toolbar}
                      disableReactiveContainer
                    >
                      <DBSqlRowTableWithSideBar
                        key={`${keyPrefix}-${chart.id}`}
                        enabled={chartEnabled}
                        sourceId={chart.config.source}
                        config={{
                          ...effectiveQueriedConfig,
                          orderBy: [
                            {
                              ordering: 'DESC',
                              valueExpression: getFirstTimestampValueExpression(
                                effectiveQueriedConfig.timestampValueExpression,
                              ),
                            },
                          ],
                          dateRange: effectiveDateRange,
                          select:
                            effectiveQueriedConfig.select ||
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
                        variant="default"
                        errorVariant="collapsible"
                      />
                    </ChartContainer>
                  )}
                {effectiveQueriedConfig?.displayType ===
                  DisplayType.EventPatterns &&
                  isBuilderChartConfig(effectiveQueriedConfig) &&
                  isBuilderSavedChartConfig(chart.config) && (
                    <ChartContainer
                      title={title}
                      toolbarItems={toolbar}
                      disableReactiveContainer
                    >
                      <PatternTable
                        key={`${keyPrefix}-${chart.id}`}
                        source={source}
                        config={{
                          ...effectiveQueriedConfig,
                          // PatternTable's usePatterns hook overrides `select`
                          // with pattern-specific columns, so clear the
                          // defaultTableSelectExpression to prevent
                          // source-specific columns from leaking through.
                          select: '',
                          displayType: DisplayType.Table,
                          dateRange: effectiveDateRange,
                          granularity: undefined,
                        }}
                        bodyValueExpression={
                          // Prefer the user's custom pattern expression
                          // (stored in select) when set. Reject
                          // multi-column strings — those are stale
                          // defaultTableSelectExpression values, not a
                          // single pattern expression. Uses bracket-aware
                          // splitting so expressions like COALESCE(a, b)
                          // are correctly treated as single.
                          (typeof effectiveQueriedConfig.select === 'string' &&
                          effectiveQueriedConfig.select.length > 0 &&
                          isSingleExpression(effectiveQueriedConfig.select)
                            ? effectiveQueriedConfig.select
                            : undefined) ??
                          (source ? (getEventBody(source) ?? '') : '')
                        }
                        totalCountConfig={{
                          ...effectiveQueriedConfig,
                          displayType: DisplayType.Table,
                          dateRange: effectiveDateRange,
                          select: 'count() as total',
                          groupBy: undefined,
                          orderBy: undefined,
                          granularity: undefined,
                        }}
                        totalCountQueryKeyPrefix={`dashboard-patterns-${chart.id}`}
                      />
                    </ChartContainer>
                  )}
              </>
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
        fullscreenDateRange,
        fullscreenGranularity,
        filterWarning,
        isSourceMissing,
        isSourceUnset,
        hasBeenVisible,
        alertAnnotations,
      ],
    );

    return (
      <>
        <div
          data-testid={`dashboard-tile-${chart.id}`}
          // `dashboard-chart-highlighted` triggers a one-shot flash animation
          // when the tile is deep-linked via the `highlightedTileId` query param.
          className={`pt-0 pb-2 ${className} d-flex flex-column bg-body border cursor-grab rounded ${
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
            ...(isSelected
              ? {
                  outline: '2px solid var(--color-outline-focus)',
                  outlineOffset: -2,
                }
              : {}),
          }}
          onClick={e => {
            if (e.shiftKey && onSelect) {
              e.preventDefault();
              onSelect(chart.id);
            }
          }}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onTouchEnd={onTouchEnd}
        >
          {hovered && (
            <div
              style={{
                position: 'absolute',
                top: 2,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 100,
                height: 3,
                background: 'var(--mantine-color-dimmed)',
                borderRadius: 2,
                zIndex: 1,
                opacity: 0.6,
              }}
            />
          )}
          <div
            ref={inViewportRef}
            className="fs-7 text-muted flex-grow-1 overflow-hidden cursor-default"
            style={{ paddingInline: DASHBOARD_TILE_PADDING_INLINE }}
            onMouseDown={e => e.stopPropagation()}
          >
            <CollapsedToolbarProvider
              menuItems={collapsedMenuItems}
              suffixCount={1}
            >
              <ChartContainerCardHeaderProvider>
                {renderChartContent()}
              </ChartContainerCardHeaderProvider>
            </CollapsedToolbarProvider>
          </div>
          {children}
        </div>

        {/* Fullscreen Modal */}
        <FullscreenPanelModal
          opened={isFullscreen}
          onClose={() => setIsFullscreen(false)}
        >
          {isFullscreen && (
            <Flex direction="column" gap="sm" h="100%" w="100%">
              <Flex justify="flex-end" gap="sm">
                <TimePicker
                  inputValue={fullscreenInputValue}
                  setInputValue={setFullscreenInputValue}
                  onSearch={handleFullscreenSearch}
                />
                <GranularityPicker
                  value={fullscreenGranularity}
                  onChange={setFullscreenGranularity}
                />
              </Flex>
              <Box style={{ flex: 1, minHeight: 0 }}>
                {renderChartContent(true, true)}
              </Box>
            </Flex>
          )}
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

  // Reset dirty state only when a *different* tile is opened, not on every
  // chart-object reference change (onSubmit recreates the chart object with
  // the same id, which would clear dirty state after display-settings Apply).
  const chartId = chart?.id;
  useEffect(() => {
    if (chartId != null) {
      setHasUnsavedChanges(false);
    }
  }, [chartId]);

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
          {/* Isolate chart cross-syncing to this edit modal: the preview chart
              must not drive shadow tooltips on the dashboard tiles behind it. */}
          <IsolatedChartSyncProvider>
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
              autoRun
            />
          </IsolatedChartSyncProvider>
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

function DashboardContainerRow({
  container,
  containerTiles,
  isCollapsed,
  activeTabId,
  alertingTabIds,
  onToggleCollapse,
  onToggleDefaultCollapsed,
  onToggleCollapsible,
  onToggleBordered,
  onDeleteContainer,
  onAddTile,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onRenameContainer,
  onTabChange,
  dragHandleProps,
  makeLayoutChangeHandler,
  tileToLayoutItem,
  renderTileComponent,
}: {
  container: DashboardContainerSchema;
  containerTiles: Tile[];
  isCollapsed: boolean;
  activeTabId: string | undefined;
  alertingTabIds?: Set<string>;
  onToggleCollapse: () => void;
  onToggleDefaultCollapsed: () => void;
  onToggleCollapsible: () => void;
  onToggleBordered: () => void;
  onDeleteContainer: (action: 'ungroup' | 'delete') => void;
  onAddTile: (containerId: string, tabId?: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newTitle: string) => void;
  onDeleteTab: (tabId: string, action: TabDeleteAction) => void;
  onRenameContainer: (newTitle: string) => void;
  onTabChange: (tabId: string) => void;
  dragHandleProps: DragHandleProps;
  makeLayoutChangeHandler: (tiles: Tile[]) => (newLayout: RGL.Layout[]) => void;
  tileToLayoutItem: (tile: Tile) => RGL.Layout;
  renderTileComponent: (tile: Tile) => React.ReactNode;
}) {
  const groupTabs = container.tabs ?? [];
  const hasTabs = groupTabs.length >= 2;
  // Tiles actually rendered inside RGL (active tab only for multi-tab
  // containers). Handler must be built from these so RGL's `newLayout` and our
  // `currentLayout` have matching sizes — otherwise every drag triggers a
  // bogus diff + setDashboard write.
  const visibleTiles = hasTabs
    ? containerTiles.filter(t => t.tabId === activeTabId)
    : containerTiles;
  const layoutChangeHandler = useMemo(
    () => makeLayoutChangeHandler(visibleTiles),
    [makeLayoutChangeHandler, visibleTiles],
  );

  return (
    <DashboardContainer
      container={container}
      collapsed={isCollapsed}
      defaultCollapsed={container.collapsed ?? false}
      onToggle={onToggleCollapse}
      onToggleDefaultCollapsed={onToggleDefaultCollapsed}
      onToggleCollapsible={onToggleCollapsible}
      onToggleBordered={onToggleBordered}
      onDelete={onDeleteContainer}
      tileCount={containerTiles.length}
      onAddTile={() =>
        onAddTile(container.id, hasTabs ? activeTabId : undefined)
      }
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      onAddTab={onAddTab}
      onRenameTab={onRenameTab}
      onDeleteTab={onDeleteTab}
      onRename={onRenameContainer}
      dragHandleProps={dragHandleProps}
      alertingTabIds={alertingTabIds}
    >
      {(currentTabId: string | undefined) => {
        const visibleTiles = currentTabId
          ? containerTiles.filter(t => t.tabId === currentTabId)
          : containerTiles;
        const visibleIsEmpty = visibleTiles.length === 0;
        return (
          <EmptyContainerPlaceholder
            containerId={currentTabId ?? container.id}
            isEmpty={visibleIsEmpty}
            onAddTile={() => onAddTile(container.id, currentTabId)}
          >
            {visibleTiles.length > 0 && (
              <ReactGridLayout
                layout={visibleTiles.map(tileToLayoutItem)}
                containerPadding={[0, 0]}
                onLayoutChange={layoutChangeHandler}
                cols={24}
                rowHeight={32}
              >
                {visibleTiles.map(renderTileComponent)}
              </ReactGridLayout>
            )}
          </EmptyContainerPlaceholder>
        );
      }}
    </DashboardContainer>
  );
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
  const { data: allDashboards } = useDashboards();

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
  // Toggle for overlaying alert firing/recovery markers on tile charts.
  // Ephemeral view state (URL param), not persisted on the dashboard.
  const [showAlertAnnotations, setShowAlertAnnotations] = useQueryState(
    'alertAnnotations',
    parseAsBoolean.withDefault(false),
  );

  // Track if we've initialized query for this dashboard
  const initializedDashboard = useRef<string>(undefined);

  const [showFiltersModal, setShowFiltersModal] = useState(false);

  const filters = dashboard?.filters ?? [];
  const {
    filterValues,
    setFilterValue,
    setFilterQueries,
    ignoredFilterExpressions,
    getFilterQueriesForSource,
  } = useDashboardFilters(filters);

  const dashboardReady =
    !!dashboard?.id &&
    router.isReady &&
    (isLocalDashboard || !isFetchingDashboard);

  // Warn when the URL has filter values that don't correspond to any declared
  // dashboard filter — they'd otherwise be silently dropped, and users who
  // arrive via a shared link, bookmark, or onClick action might not notice.
  // Only consider URL filters ignored once the dashboard has finished loading
  // so we don't flash the banner before `dashboard.filters` is available.
  //
  // Latched on dashboard load only — not on every URL change — so the banner
  // doesn't flash while navigating between dashboards due to nuqs state changing
  // before the next router state. Known limitation - when navigating to the current
  // dashboard with new and invalid filters in the URL, the banner will not show up.
  const [shouldShowIgnoredFiltersBanner, setShouldShowIgnoredFiltersBanner] =
    useState<boolean>(false);
  // dashboardReady will toggle when fetching dashboard due to a dashboard save -
  // in this case we don't want to show the banner again.
  const lastLoadedIdForBannerRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!dashboardReady || lastLoadedIdForBannerRef.current === dashboard?.id)
      return;
    setShouldShowIgnoredFiltersBanner(ignoredFilterExpressions.length > 0);
    lastLoadedIdForBannerRef.current = dashboard?.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.id, dashboardReady]);

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
    if (
      router.isReady &&
      watchedGranularity &&
      watchedGranularity !== granularity
    ) {
      setGranularity(watchedGranularity as SQLInterval);
    }
  }, [router.isReady, watchedGranularity, granularity, setGranularity]);

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
        const savedLanguage =
          dashboard.savedQueryLanguage ?? getStoredLanguage() ?? 'lucene';
        setValue('whereLanguage', savedLanguage);
        setWhereLanguage(savedLanguage);
      } else if (isSwitchingDashboards) {
        setValue('where', '');
        setWhere('');
        const storedLanguage = getStoredLanguage() ?? 'lucene';
        setValue('whereLanguage', storedLanguage);
        setWhereLanguage(storedLanguage);
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

  // Sync changes to the URL params into the form
  useEffect(() => {
    setValue('where', where);
    setValue(
      'whereLanguage',
      whereLanguage === 'sql' || whereLanguage === 'lucene'
        ? whereLanguage
        : (getStoredLanguage() ?? 'lucene'),
    );
  }, [setValue, where, whereLanguage]);

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

  const containers = useMemo(
    () => dashboard?.containers ?? [],
    [dashboard?.containers],
  );
  // Persisted right-rail Table of Contents visibility. Off by default;
  // discoverable via the dashboard "View" menu.
  const [tocVisible, setTocVisible] = useLocalStorage<boolean>(
    'dashboard-toc-visible',
    false,
  );
  // react-grid-layout's WidthProvider only listens to window resize events,
  // so when the TOC rail toggles and the grid's column width changes via
  // Flex, RGL keeps drawing tiles at the old width. Nudge it after the
  // layout has committed.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [tocVisible]);
  // URL-based collapse state: tracks which containers the current viewer has
  // explicitly collapsed/expanded. Falls back to the DB-stored default.
  const [urlCollapsedIds, setUrlCollapsedIds] = useQueryState(
    'collapsed',
    parseAsArrayOf(parseAsString).withOptions({ history: 'replace' }),
  );
  const [urlExpandedIds, setUrlExpandedIds] = useQueryState(
    'expanded',
    parseAsArrayOf(parseAsString).withOptions({ history: 'replace' }),
  );
  // Per-viewer active tab selection: `{ [containerId]: tabId }`.
  // Falls back to the first tab for any container not in the map.
  const [urlActiveTabs, setUrlActiveTabs] = useQueryState(
    'activeTabs',
    parseAsJsonEncoded<Record<string, string>>().withOptions({
      history: 'replace',
    }),
  );

  const collapsedIdSet = useMemo(
    () => new Set(urlCollapsedIds ?? []),
    [urlCollapsedIds],
  );
  const expandedIdSet = useMemo(
    () => new Set(urlExpandedIds ?? []),
    [urlExpandedIds],
  );

  const isContainerCollapsed = useCallback(
    (container: DashboardContainerSchema): boolean => {
      // URL state takes precedence over DB default
      if (collapsedIdSet.has(container.id)) return true;
      if (expandedIdSet.has(container.id)) return false;
      return container.collapsed ?? false;
    },
    [collapsedIdSet, expandedIdSet],
  );

  const getActiveTabId = useCallback(
    (container: DashboardContainerSchema): string | undefined => {
      const tabs = container.tabs ?? [];
      const urlTabId = urlActiveTabs?.[container.id];
      if (urlTabId && tabs.some(t => t.id === urlTabId)) return urlTabId;
      return tabs[0]?.id;
    },
    [urlActiveTabs],
  );

  const handleTabChange = useCallback(
    (containerId: string, tabId: string) => {
      setUrlActiveTabs(prev => ({ ...(prev ?? {}), [containerId]: tabId }));
    },
    [setUrlActiveTabs],
  );

  // When arriving via ?highlightedTileId, switch to the tile's tab if it
  // isn't already active so the tile is in the DOM for the Tile-level
  // scroll/highlight effect to take effect. Guard with a ref keyed on the
  // highlighted id so a user manually switching tabs afterwards doesn't
  // get reverted on the next render.
  const handledHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightedTileId || !dashboard) return;
    if (handledHighlightRef.current === highlightedTileId) return;
    handledHighlightRef.current = highlightedTileId;
    const tile = dashboard.tiles.find(t => t.id === highlightedTileId);
    if (!tile?.containerId || !tile.tabId) return;
    const container = containers.find(c => c.id === tile.containerId);
    if (!container || getActiveTabId(container) === tile.tabId) return;
    setUrlActiveTabs(prev => ({
      ...(prev ?? {}),
      [container.id]: tile.tabId!,
    }));
  }, [
    highlightedTileId,
    dashboard,
    containers,
    getActiveTabId,
    setUrlActiveTabs,
  ]);

  // Valid move targets: groups and individual tabs within groups
  const moveTargetContainers = useMemo<MoveTarget[]>(() => {
    const targets: MoveTarget[] = [];
    for (const c of containers) {
      const cTabs = c.tabs ?? [];
      if (cTabs.length >= 2) {
        for (const tab of cTabs) {
          targets.push({
            containerId: c.id,
            tabId: tab.id,
            label: tab.title,
            allTabs: cTabs.map(t => ({ id: t.id, title: t.title })),
          });
        }
      } else if (cTabs.length === 1) {
        // 1-tab group: show just the group name, target the single tab
        targets.push({
          containerId: c.id,
          tabId: cTabs[0].id,
          label: cTabs[0].title,
        });
      } else {
        targets.push({ containerId: c.id, label: c.title });
      }
    }
    return targets;
  }, [containers]);

  const hasContainers = containers.length > 0;
  const allTiles = useMemo(() => dashboard?.tiles ?? [], [dashboard?.tiles]);

  const {
    selectedTileIds,
    setSelectedTileIds,
    handleToggleTileSelect,
    handleGroupSelected,
  } = useTileSelection({ dashboard, setDashboard });

  const handleMoveTileToGroup = useCallback(
    (tileId: string, containerId: string | undefined, tabId?: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const tile = draft.tiles.find(t => t.id === tileId);
          if (!tile) return;

          if (containerId) tile.containerId = containerId;
          else delete tile.containerId;
          if (tabId) tile.tabId = tabId;
          else delete tile.tabId;

          const targetTiles = draft.tiles.filter(t => {
            if (t.id === tileId) return false;
            if (containerId) {
              if (t.containerId !== containerId) return false;
              return tabId ? t.tabId === tabId : true;
            }
            return !t.containerId;
          });
          const pos = calculateNextTilePosition(targetTiles, tile.w);
          tile.x = pos.x;
          tile.y = pos.y;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const renderTileComponent = useCallback(
    (chart: Tile) => {
      // Resolve the tile's source ID so per-source-scoped filters can be
      // narrowed to only the tiles they target. Builder and RawSQL configs
      // both carry a `source` field; markdown / other configs don't.
      const tileSourceId =
        'source' in chart.config ? chart.config.source : undefined;
      return (
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
            ...getFilterQueriesForSource(tileSourceId),
          ]}
          onTimeRangeSelect={onTimeRangeSelect}
          showAlertAnnotations={showAlertAnnotations}
          isHighlighted={highlightedTileId === chart.id}
          onUpdateChart={newChart => {
            if (!dashboard) return;
            setDashboard(
              produce(dashboard, draft => {
                const chartIndex = draft.tiles.findIndex(
                  c => c.id === chart.id,
                );
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
          moveTargets={moveTargetContainers}
          onMoveToGroup={(containerId, tabId) =>
            handleMoveTileToGroup(chart.id, containerId, tabId)
          }
          isSelected={selectedTileIds.has(chart.id)}
          onSelect={handleToggleTileSelect}
        />
      );
    },
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
      showAlertAnnotations,
      getFilterQueriesForSource,
      moveTargetContainers,
      handleMoveTileToGroup,
      selectedTileIds,
      handleToggleTileSelect,
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

  // Helpers for updating URL-based collapse sets via immer.
  const addToUrlSet = useCallback(
    (setter: typeof setUrlCollapsedIds, containerId: string) => {
      setter(prev =>
        produce(prev ?? [], draft => {
          if (!draft.includes(containerId)) draft.push(containerId);
        }),
      );
    },
    [],
  );

  const removeFromUrlSet = useCallback(
    (setter: typeof setUrlCollapsedIds, containerId: string) => {
      setter(prev => {
        const next = (prev ?? []).filter(id => id !== containerId);
        return next.length > 0 ? next : null;
      });
    },
    [],
  );

  // Toggle collapse in URL state only (per-viewer, shareable via link).
  // Does NOT persist to DB — the DB `collapsed` field is the default.
  const handleToggleCollapse = useCallback(
    (containerId: string) => {
      const container = dashboard?.containers?.find(s => s.id === containerId);
      const currentlyCollapsed = container
        ? isContainerCollapsed(container)
        : false;

      if (currentlyCollapsed) {
        addToUrlSet(setUrlExpandedIds, containerId);
        removeFromUrlSet(setUrlCollapsedIds, containerId);
      } else {
        addToUrlSet(setUrlCollapsedIds, containerId);
        removeFromUrlSet(setUrlExpandedIds, containerId);
      }
    },
    [
      dashboard?.containers,
      isContainerCollapsed,
      addToUrlSet,
      removeFromUrlSet,
      setUrlCollapsedIds,
      setUrlExpandedIds,
    ],
  );

  // Collapsible-only subset, used both for bulk collapse/expand and for
  // disabling the menu items when nothing can be toggled.
  const collapsibleContainers = useMemo(
    () => containers.filter(c => c.collapsible !== false),
    [containers],
  );

  // Bulk collapse: write all collapsible container IDs into the URL
  // `collapsed` set, clearing `expanded`. Per-viewer only — does not mutate
  // the dashboard's stored defaults.
  const handleCollapseAll = useCallback(() => {
    const ids = collapsibleContainers.map(c => c.id);
    setUrlCollapsedIds(ids.length > 0 ? ids : null);
    setUrlExpandedIds(null);
  }, [collapsibleContainers, setUrlCollapsedIds, setUrlExpandedIds]);

  const handleExpandAll = useCallback(() => {
    const ids = collapsibleContainers.map(c => c.id);
    setUrlExpandedIds(ids.length > 0 ? ids : null);
    setUrlCollapsedIds(null);
  }, [collapsibleContainers, setUrlCollapsedIds, setUrlExpandedIds]);

  // Toggle the DB-stored default collapsed state (menu action).
  // This changes what all viewers see by default when opening the dashboard.
  const handleToggleDefaultCollapsed = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const c = draft.containers?.find(s => s.id === containerId);
          if (c) c.collapsed = !c.collapsed;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleToggleCollapsible = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const c = draft.containers?.find(s => s.id === containerId);
          if (c) {
            c.collapsible = !(c.collapsible ?? true);
            // Ensure container is expanded when collapsing is disabled
            if (c.collapsible === false) c.collapsed = false;
          }
        }),
      );
      // Clear stale URL collapse state so re-enabling doesn't resurrect old state
      removeFromUrlSet(setUrlCollapsedIds, containerId);
      removeFromUrlSet(setUrlExpandedIds, containerId);
    },
    [
      dashboard,
      setDashboard,
      removeFromUrlSet,
      setUrlCollapsedIds,
      setUrlExpandedIds,
    ],
  );

  const handleToggleBordered = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const c = draft.containers?.find(s => s.id === containerId);
          if (c) c.bordered = !(c.bordered ?? true);
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const {
    handleAddContainer,
    handleRenameContainer,
    handleDeleteContainer,
    handleReorderContainers,
    handleAddTab,
    handleRenameTab,
    handleDeleteTab,
  } = useDashboardContainers({ dashboard, setDashboard });

  const onAddTile = (containerId?: string, tabId?: string) => {
    // Auto-expand collapsed container via URL state so the new tile is visible
    if (containerId) {
      const container = dashboard?.containers?.find(s => s.id === containerId);
      if (container && isContainerCollapsed(container)) {
        handleToggleCollapse(containerId);
      }
    }
    // Default new tile size: w=8 (1/3 width), h=10 — matches original behavior
    const newW = 8;
    const newH = 10;
    const targetTiles = (dashboard?.tiles ?? []).filter(t => {
      if (containerId) {
        if (t.containerId !== containerId) return false;
        return tabId ? t.tabId === tabId : true;
      }
      return !t.containerId;
    });
    const pos = calculateNextTilePosition(targetTiles, newW);
    setEditedTile({
      id: makeId(),
      x: pos.x,
      y: pos.y,
      w: newW,
      h: newH,
      config: {
        ...DEFAULT_CHART_CONFIG,
        source: sources?.[0]?.id ?? '',
      },
      ...(containerId ? { containerId } : {}),
      ...(tabId ? { tabId } : {}),
    });
  };

  // Orphaned tiles (containerId not matching any container) render as ungrouped.
  const tilesByContainerId = useMemo(() => {
    const map = new Map<string, Tile[]>();
    for (const c of containers) {
      map.set(
        c.id,
        allTiles.filter(t => t.containerId === c.id),
      );
    }
    return map;
  }, [containers, allTiles]);

  const alertingTabIdsByContainer = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const container of containers) {
      const tiles = tilesByContainerId.get(container.id) ?? [];
      const firstTabId = container.tabs?.[0]?.id;
      const alerting = new Set<string>();
      for (const tile of tiles) {
        if (tile.config.alert?.state === AlertState.ALERT) {
          const attributedTabId = tile.tabId ?? firstTabId;
          if (attributedTabId) alerting.add(attributedTabId);
        }
      }
      if (alerting.size > 0) map.set(container.id, alerting);
    }
    return map;
  }, [containers, tilesByContainerId]);

  const ungroupedTiles = useMemo(
    () =>
      hasContainers
        ? allTiles.filter(
            t => !t.containerId || !tilesByContainerId.has(t.containerId),
          )
        : allTiles,
    [hasContainers, allTiles, tilesByContainerId],
  );

  const onUngroupedLayoutChange = useMemo(
    () => makeOnLayoutChange(ungroupedTiles),
    [makeOnLayoutChange, ungroupedTiles],
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

  const dashboardMeta =
    !isLocalDashboard && dashboard ? (
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {dashboard.createdBy && (
          <span>
            Created by {dashboard.createdBy.name || dashboard.createdBy.email}.{' '}
          </span>
        )}
        {dashboard.updatedAt && (
          <Tooltip
            label={
              <>
                <FormatTime value={dashboard.updatedAt} format="short" />
                {dashboard.updatedBy
                  ? ` by ${dashboard.updatedBy.name || dashboard.updatedBy.email}`
                  : ''}
              </>
            }
          >
            <span>{`Updated ${formatDistanceToNow(new Date(dashboard.updatedAt), { addSuffix: true })}.`}</span>
          </Tooltip>
        )}
      </Text>
    ) : null;

  const pageBreadcrumbs = (
    <Flex justify="space-between" align="center" gap="sm" w="100%">
      <Breadcrumbs fz="sm">
        <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
          Dashboards
        </Anchor>
        <Text fz="sm" c="dimmed" maw={500} truncate="end" lh={1}>
          {isLocalDashboard
            ? 'Temporary Dashboard'
            : (dashboard?.name ?? 'Untitled')}
        </Text>
      </Breadcrumbs>
      {dashboardMeta}
    </Flex>
  );

  const dashboardName = (
    <EditablePageName
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
  );

  const dashboardActions = !isLocalDashboard ? (
    <Group gap="xs" wrap="nowrap">
      {dashboard?.id && (
        <FavoriteButton resourceType="dashboard" resourceId={dashboard.id} />
      )}
      {dashboard?.id && (
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
      {/* local dashboards cant be "deleted" */}
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
          {(hasTiles || containers.length > 0) && (
            <>
              <Menu.Label>View</Menu.Label>
              {hasTiles && (
                <Menu.Item
                  leftSection={<IconTimelineEvent size={16} />}
                  onClick={() => setShowAlertAnnotations(v => !v)}
                  data-testid="toggle-alert-annotations-menu-item"
                >
                  {showAlertAnnotations
                    ? 'Hide alert annotations'
                    : 'Show alert annotations'}
                </Menu.Item>
              )}
              {containers.length > 0 && (
                <>
                  <Menu.Item
                    leftSection={
                      tocVisible ? (
                        <IconLayoutSidebarRightCollapse size={16} />
                      ) : (
                        <IconLayoutSidebarRightExpand size={16} />
                      )
                    }
                    onClick={() => setTocVisible(v => !v)}
                    data-testid="toggle-toc-menu-item"
                  >
                    {tocVisible
                      ? 'Hide table of contents'
                      : 'Show table of contents'}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconChevronsUp size={16} />}
                    onClick={handleCollapseAll}
                    disabled={collapsibleContainers.length === 0}
                    data-testid="collapse-all-sections-menu-item"
                  >
                    Collapse all sections
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconChevronsDown size={16} />}
                    onClick={handleExpandAll}
                    disabled={collapsibleContainers.length === 0}
                    data-testid="expand-all-sections-menu-item"
                  >
                    Expand all sections
                  </Menu.Item>
                </>
              )}
              <Menu.Divider />
            </>
          )}
          {hasTiles && (
            <Menu.Item
              leftSection={<IconDownload size={16} />}
              data-testid="export-dashboard-menu-item"
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
                    sources,
                    connections,
                    allDashboards ?? [],
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
                router.push(`/dashboards/import?dashboardId=${dashboard.id}`);
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
                  router.push('/dashboards/list');
                },
              })
            }
          >
            Delete Dashboard
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  ) : null;

  const titleRow = (
    <Flex justify="space-between" align="flex-start" gap="sm">
      {dashboardName}
      {dashboardActions}
    </Flex>
  );

  const queryToolbar = (
    <Flex
      gap="sm"
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
  );

  // Extracted for the same reason as `KubernetesDashboardPage`: keeps the
  // `<PageLayout>` return shallow and prevents the tile-grid tree below
  // from being wrapped in an extra indentation level.
  const dashboardBody = (
    <>
      <Head>
        <title>
          {dashboard?.name ? `${dashboard.name}` : 'Dashboard'} – {brandName}
        </title>
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
        <Paper mt="xs" mb="md" p="md" data-testid="temporary-dashboard-banner">
          <Flex justify="space-between" align="center">
            <Text size="sm">
              This is a temporary dashboard and can not be saved.
            </Text>
            <Button
              variant="primary"
              fw={400}
              onClick={onCreateDashboard}
              data-testid="create-dashboard-button"
            >
              Create New Saved Dashboard
            </Button>
          </Flex>
        </Paper>
      )}
      {shouldShowIgnoredFiltersBanner &&
        ignoredFilterExpressions.length > 0 && (
          <Alert
            mt="sm"
            color="yellow"
            icon={<IconAlertTriangle size={16} />}
            title="Some filters could not be applied"
            data-testid="ignored-url-filters-banner"
            withCloseButton
            closeButtonLabel="Dismiss"
            onClose={() => setShouldShowIgnoredFiltersBanner(false)}
          >
            No dashboard filter(s) found for{' '}
            {ignoredFilterExpressions.length === 1
              ? 'expression'
              : 'expressions'}{' '}
            in the URL: {ignoredFilterExpressions.join(', ')}. Add a filter with
            a matching expression to apply these filters.
          </Alert>
        )}
      <DashboardFilters
        filters={filters}
        filterValues={filterValues}
        onSetFilterValue={setFilterValue}
        dateRange={searchedTimeRange}
      />
      {/* Selection indicator */}
      {selectedTileIds.size > 0 && (
        <Paper p="xs" mt="sm" withBorder>
          <Flex align="center" gap="sm">
            <Text size="sm">
              {selectedTileIds.size} tile{selectedTileIds.size > 1 ? 's' : ''}{' '}
              selected
            </Text>
            <Button
              size="xs"
              variant="primary"
              onClick={handleGroupSelected}
              title="Group selected tiles (Cmd+G)"
            >
              Group
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setSelectedTileIds(new Set())}
            >
              Clear
            </Button>
          </Flex>
        </Paper>
      )}
      <Flex gap="md" align="flex-start" mt="sm">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Box>
            {dashboard != null && dashboard.tiles != null ? (
              <ErrorBoundary
                onError={console.error}
                fallback={
                  <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                    An error occurred while rendering the dashboard.
                  </div>
                }
              >
                <DashboardDndProvider
                  containers={containers}
                  onReorderContainers={handleReorderContainers}
                >
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
                  {containers.map(container => (
                    <SortableContainerWrapper
                      key={container.id}
                      containerId={container.id}
                      containerTitle={container.title}
                    >
                      {(dragHandleProps: DragHandleProps) => (
                        <DashboardContainerRow
                          container={container}
                          containerTiles={
                            tilesByContainerId.get(container.id) ?? []
                          }
                          isCollapsed={isContainerCollapsed(container)}
                          activeTabId={getActiveTabId(container)}
                          alertingTabIds={alertingTabIdsByContainer.get(
                            container.id,
                          )}
                          onToggleCollapse={() =>
                            handleToggleCollapse(container.id)
                          }
                          onToggleDefaultCollapsed={() =>
                            handleToggleDefaultCollapsed(container.id)
                          }
                          onToggleCollapsible={() =>
                            handleToggleCollapsible(container.id)
                          }
                          onToggleBordered={() =>
                            handleToggleBordered(container.id)
                          }
                          onDeleteContainer={action =>
                            handleDeleteContainer(container.id, action)
                          }
                          onAddTile={onAddTile}
                          onAddTab={() => {
                            const newTabId = handleAddTab(container.id);
                            if (newTabId)
                              handleTabChange(container.id, newTabId);
                          }}
                          onRenameTab={(tabId, title) =>
                            handleRenameTab(container.id, tabId, title)
                          }
                          onDeleteTab={(tabId, action) =>
                            handleDeleteTab(container.id, tabId, action)
                          }
                          onRenameContainer={title =>
                            handleRenameContainer(container.id, title)
                          }
                          onTabChange={tabId =>
                            handleTabChange(container.id, tabId)
                          }
                          dragHandleProps={dragHandleProps}
                          makeLayoutChangeHandler={makeOnLayoutChange}
                          tileToLayoutItem={tileToLayoutItem}
                          renderTileComponent={renderTileComponent}
                        />
                      )}
                    </SortableContainerWrapper>
                  ))}
                </DashboardDndProvider>
              </ErrorBoundary>
            ) : null}
          </Box>
          <Menu position="top" width={200}>
            <Menu.Target>
              <Button
                data-testid="add-dropdown-button"
                variant={
                  dashboard?.tiles.length === 0 ? 'primary' : 'secondary'
                }
                mt="sm"
                fw={400}
                w="100%"
                leftSection={<IconPlus size={16} />}
              >
                Add
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                data-testid="add-new-tile-menu-item"
                leftSection={<IconChartBar size={16} />}
                onClick={() => onAddTile()}
              >
                New Tile
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                data-testid="add-new-group-menu-item"
                leftSection={<IconSquaresDiagonal size={16} />}
                onClick={() => handleAddContainer()}
              >
                New Group
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Box>
        {tocVisible && (
          <DashboardTableOfContents
            containers={containers}
            isCollapsed={isContainerCollapsed}
            onToggleCollapse={handleToggleCollapse}
            onClose={() => setTocVisible(false)}
          />
        )}
      </Flex>
      <DashboardFiltersModal
        opened={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onSaveFilter={handleSaveFilter}
        onRemoveFilter={handleRemoveFilter}
        isLoading={isSavingDashboard || isFetchingDashboard}
      />
    </>
  );

  return (
    <PageLayout
      data-testid="dashboard-page"
      header={
        <PageHeader breadcrumbs={pageBreadcrumbs} stickyRow={queryToolbar}>
          {titleRow}
        </PageHeader>
      }
      padded
      contentClassName="bg-sunken"
      content={dashboardBody}
    />
  );
}

const DBDashboardPageDynamic = dynamic(async () => DBDashboardPage, {
  ssr: false,
});

// @ts-expect-error for getLayout
DBDashboardPageDynamic.getLayout = withAppNav;

export default DBDashboardPageDynamic;
