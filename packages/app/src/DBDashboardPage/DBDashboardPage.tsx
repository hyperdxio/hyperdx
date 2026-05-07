import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { formatDistanceToNow } from 'date-fns';
import produce from 'immer';
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { useForm, useWatch } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { convertToDashboardTemplate } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AlertState,
  DashboardContainer as DashboardContainerSchema,
  DashboardFilter,
  Filter,
  SearchCondition,
  SearchConditionLanguage,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Breadcrumbs,
  Button,
  Flex,
  Group,
  Menu,
  Modal,
  Paper,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChartBar,
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconFilterEdit,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSquaresDiagonal,
  IconTags,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';

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
import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import { FavoriteButton } from '@/components/FavoriteButton';
import { TimePicker } from '@/components/TimePicker';
import {
  Dashboard,
  type Tile,
  useCreateDashboard,
  useDeleteDashboard,
} from '@/dashboard';
import useDashboardContainers, {
  TabDeleteAction,
} from '@/hooks/useDashboardContainers';
import { calculateNextTilePosition, makeId } from '@/utils/tilePositioning';

import OnboardingModal from '@/components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { Tags } from '@/components/Tags';
import useDashboardFilters from '@/hooks/useDashboardFilters';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import useTileSelection from '@/hooks/useTileSelection';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseAsJsonEncoded, parseAsStringEncoded } from '@/utils/queryParsers';
import { DEFAULT_CHART_CONFIG } from '@/ChartUtils';
import { useConnections } from '@/connection';
import { useDashboard } from '@/dashboard';
import DashboardFilters from '@/DashboardFilters';
import DashboardFiltersModal from '@/DashboardFiltersModal';
import { EditablePageName } from '@/EditablePageName';
import { GranularityPickerControlled } from '@/GranularityPicker';
import { withAppNav } from '@/layout';
import { useSources } from '@/source';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { useConfirm } from '@/useConfirm';
import { FormatTime } from '@/useFormatTime';
import { getMetricTableName } from '@/utils';
import { useZIndex, ZIndexContext } from '@/zIndex';

import { DashboardTile, type MoveTarget } from './DashboardTile';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

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
            autoRun
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
    (chart: Tile) => (
      <DashboardTile
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
        moveTargets={moveTargetContainers}
        onMoveToGroup={(containerId, tabId) =>
          handleMoveTileToGroup(chart.id, containerId, tabId)
        }
        isSelected={selectedTileIds.has(chart.id)}
        onSelect={handleToggleTileSelect}
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

      {isLocalDashboard ? (
        <>
          <Breadcrumbs mb="xs" mt="xs" fz="sm">
            <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
              Dashboards
            </Anchor>
            <Text fz="sm" c="dimmed">
              Temporary Dashboard
            </Text>
          </Breadcrumbs>
          <Paper my="lg" p="md" data-testid="temporary-dashboard-banner">
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
        </>
      ) : (
        <Group align="flex-start" mb="xs" mt="xs" justify="space-between">
          <Breadcrumbs fz="sm">
            <Anchor component={Link} href="/dashboards/list" fz="sm" c="dimmed">
              Dashboards
            </Anchor>
            <Text fz="sm" c="dimmed" maw={500} truncate="end" lh={1}>
              {dashboard?.name ?? 'Untitled'}
            </Text>
          </Breadcrumbs>
          {!isLocalDashboard && dashboard && (
            <Text size="xs" c="dimmed">
              {dashboard.createdBy && (
                <span>
                  Created by{' '}
                  {dashboard.createdBy.name || dashboard.createdBy.email}.{' '}
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
          )}
        </Group>
      )}
      <Flex mt="xs" mb="md" justify="space-between" align="flex-start">
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
        <Group gap="xs">
          {!isLocalDashboard && dashboard?.id && (
            <FavoriteButton
              resourceType="dashboard"
              resourceId={dashboard.id}
            />
          )}
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
                        if (newTabId) handleTabChange(container.id, newTabId);
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
            variant={dashboard?.tiles.length === 0 ? 'primary' : 'secondary'}
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
