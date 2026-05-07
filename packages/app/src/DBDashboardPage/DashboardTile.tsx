import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { formatRelative } from 'date-fns';
import { pick } from 'lodash';
import {
  displayTypeSupportsBuilderAlerts,
  displayTypeSupportsRawSqlAlerts,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  displayTypeRequiresSource,
  isBuilderChartConfig,
  isBuilderSavedChartConfig,
  isRawSqlChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AlertState,
  ChartConfigWithDateRange,
  DisplayType,
  Filter,
  getSampleWeightExpression,
  isLogSource,
  isTraceSource,
  SourceKind,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Flex,
  Group,
  Indicator,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
  IconArrowsMaximize,
  IconBell,
  IconCopy,
  IconCornerDownRight,
  IconPencil,
  IconTrash,
  IconZoomExclamation,
} from '@tabler/icons-react';

import { buildTableRowSearchUrl } from '@/ChartUtils';
import ChartContainer from '@/components/charts/ChartContainer';
import DBNumberChart from '@/components/DBNumberChart';
import { DBPieChart } from '@/components/DBPieChart';
import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import FullscreenPanelModal from '@/components/FullscreenPanelModal';
import { type Tile } from '@/dashboard';
import {
  getFirstTimestampValueExpression,
  useSource,
} from '@/source';
import { getMetricTableName } from '@/utils';

import { HeatmapTile } from './HeatmapTile';

export type MoveTarget = {
  containerId: string;
  tabId?: string;
  label: string;
  // For tabs: all tabs in order with the target tab ID
  allTabs?: { id: string; title: string }[];
};

type DashboardTileProps = {
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
};

export const DashboardTile = forwardRef(
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
    }: DashboardTileProps,
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
              'from',
              'metricTables',
            ]),
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
      const displayTypeSupportsAlerts = isRawSql
        ? displayTypeSupportsRawSqlAlerts(chart.config.displayType)
        : displayTypeSupportsBuilderAlerts(chart.config.displayType);
      return (
        <Flex
          gap="0px"
          onMouseDown={e => e.stopPropagation()}
          key="hover-toolbar"
          my={4} // Margin to ensure that the Alert Indicator doesn't clip on non-Line/Bar display types
          style={{ visibility: hovered ? 'visible' : 'hidden' }}
        >
          {displayTypeSupportsAlerts && (
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
          {onMoveToGroup && moveTargets && moveTargets.length > 0 && (
            <Menu width={200} position="bottom-end">
              <Menu.Target>
                <Tooltip label="Move to Group" position="top" withArrow>
                  <ActionIcon
                    data-testid={`tile-move-group-button-${chart.id}`}
                    variant="subtle"
                    size="sm"
                  >
                    <IconCornerDownRight size={14} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Move to Group</Menu.Label>
                {chart.containerId && (
                  <Menu.Item onClick={() => onMoveToGroup(undefined)}>
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
      moveTargets,
      chart.config,
      chart.id,
      chart.containerId,
      chart.tabId,
      hovered,
      onDeleteClick,
      onDuplicateClick,
      onEditClick,
      onMoveToGroup,
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
                {queriedConfig?.displayType === DisplayType.Heatmap &&
                  isBuilderChartConfig(queriedConfig) && (
                    <HeatmapTile
                      keyPrefix={keyPrefix}
                      chartId={chart.id}
                      title={title}
                      toolbar={toolbar}
                      queriedConfig={queriedConfig}
                      source={source}
                      dateRange={dateRange}
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
        filterWarning,
        isSourceMissing,
        isSourceUnset,
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
