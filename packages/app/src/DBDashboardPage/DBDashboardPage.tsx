import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import produce from 'immer';
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs';
import RGL from 'react-grid-layout';
import { useForm, useWatch } from 'react-hook-form';
import { convertToDashboardTemplate } from '@hyperdx/common-utils/dist/core/utils';
import {
  DashboardContainer as DashboardContainerSchema,
  DashboardFilter,
  Filter,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import { Box, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { DEFAULT_CHART_CONFIG } from '@/ChartUtils';
import { ContactSupportText } from '@/components/ContactSupportText';
import OnboardingModal from '@/components/OnboardingModal';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { useConnections } from '@/connection';
import {
  Dashboard,
  type Tile,
  useCreateDashboard,
  useDashboard,
  useDeleteDashboard,
} from '@/dashboard';
import DashboardFilters from '@/DashboardFilters';
import DashboardFiltersModal from '@/DashboardFiltersModal';
import useDashboardContainers from '@/hooks/useDashboardContainers';
import useDashboardFilters from '@/hooks/useDashboardFilters';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import useTileSelection from '@/hooks/useTileSelection';
import { withAppNav } from '@/layout';
import { useSources } from '@/source';
import { useBrandDisplayName } from '@/theme/ThemeProvider';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';
import { useConfirm } from '@/useConfirm';
import { parseAsJsonEncoded, parseAsStringEncoded } from '@/utils/queryParsers';
import { calculateNextTilePosition, makeId } from '@/utils/tilePositioning';

import { DashboardGrid } from './DashboardGrid';
import { DashboardHeader } from './DashboardHeader';
import { DashboardTile } from './DashboardTile';
import { DashboardToolbar } from './DashboardToolbar';
import { EditTileModal } from './EditTileModal';
import type { DashboardQueryFormValues, MoveTarget } from './types';
import {
  buildMoveTargets,
  downloadObjectAsJson,
  getAlertingTabIdsByContainer,
  getDashboardTableConnections,
  getTilesByContainerId,
  getUngroupedTiles,
  hasLayoutChanged,
  tileToLayoutItem,
  updateLayout,
} from './utils';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const whereLanguageParser = parseAsString.withDefault(
  typeof window !== 'undefined' ? (getStoredLanguage() ?? 'lucene') : 'lucene',
);

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
  const tableConnections = useMemo(
    () => getDashboardTableConnections({ dashboard, sources }),
    [dashboard, sources],
  );

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

  const { control, setValue, getValues, handleSubmit } =
    useForm<DashboardQueryFormValues>({
      defaultValues: {
        granularity: granularity ?? 'auto',
        where: where ?? '',
        whereLanguage:
          whereLanguage === 'sql' || whereLanguage === 'lucene'
            ? whereLanguage
            : (getStoredLanguage() ?? 'lucene'),
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
      setWhere(data.where);
      setWhereLanguage(data.whereLanguage ?? null);
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
  const moveTargetContainers = useMemo<MoveTarget[]>(
    () => buildMoveTargets(containers),
    [containers],
  );

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
      if (hasLayoutChanged({ currentLayout, newLayout })) {
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
  const tilesByContainerId = useMemo(
    () => getTilesByContainerId({ containers, allTiles }),
    [containers, allTiles],
  );

  const alertingTabIdsByContainer = useMemo(
    () => getAlertingTabIdsByContainer({ containers, tilesByContainerId }),
    [containers, tilesByContainerId],
  );

  const ungroupedTiles = useMemo(
    () => getUngroupedTiles({ hasContainers, allTiles, tilesByContainerId }),
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

      <DashboardHeader
        dashboard={dashboard}
        dashboardHash={dashboardHash}
        isLocalDashboard={isLocalDashboard}
        hasTiles={hasTiles}
        hasSavedQueryAndFilterDefaults={hasSavedQueryAndFilterDefaults}
        onCreateDashboard={onCreateDashboard}
        onRenameDashboard={editedName => {
          if (dashboard != null) {
            setDashboard({
              ...dashboard,
              name: editedName,
            });
          }
        }}
        onUpdateTags={handleUpdateTags}
        onExportDashboard={() => {
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
        onImportDashboard={() => {
          if (dashboard && !dashboard.tiles.length) {
            router.push(`/dashboards/import?dashboardId=${dashboard.id}`);
          } else {
            router.push('/dashboards/import');
          }
        }}
        onSaveQuery={handleSaveQuery}
        onRemoveSavedQuery={handleRemoveSavedQuery}
        onDeleteDashboard={() =>
          deleteDashboard.mutate(dashboard?.id ?? '', {
            onSuccess: () => {
              router.push('/dashboards');
            },
          })
        }
      />
      <DashboardToolbar
        tableConnections={tableConnections}
        control={control}
        setValue={setValue}
        displayedTimeInputValue={displayedTimeInputValue}
        setDisplayedTimeInputValue={setDisplayedTimeInputValue}
        onSubmit={onSubmit}
        onSearch={onSearch}
        isRefreshEnabled={isRefreshEnabled}
        granularityOverride={granularityOverride}
        isLive={isLive}
        setIsLive={setIsLive}
        refresh={refresh}
        manualRefreshCooloff={manualRefreshCooloff}
        onOpenFilters={() => setShowFiltersModal(true)}
      />
      <DashboardFilters
        filters={filters}
        filterValues={filterValues}
        onSetFilterValue={setFilterValue}
        dateRange={searchedTimeRange}
      />
      <DashboardGrid
        canRenderDashboard={dashboard != null && dashboard.tiles != null}
        hasTiles={Boolean(dashboard?.tiles.length)}
        containers={containers}
        ungroupedTiles={ungroupedTiles}
        selectedTileIds={selectedTileIds}
        setSelectedTileIds={setSelectedTileIds}
        onGroupSelected={handleGroupSelected}
        onReorderContainers={handleReorderContainers}
        onUngroupedLayoutChange={onUngroupedLayoutChange}
        renderTileComponent={renderTileComponent}
        tileToLayoutItem={tileToLayoutItem}
        tilesByContainerId={tilesByContainerId}
        isContainerCollapsed={isContainerCollapsed}
        getActiveTabId={getActiveTabId}
        alertingTabIdsByContainer={alertingTabIdsByContainer}
        onToggleCollapse={handleToggleCollapse}
        onToggleDefaultCollapsed={handleToggleDefaultCollapsed}
        onToggleCollapsible={handleToggleCollapsible}
        onToggleBordered={handleToggleBordered}
        onDeleteContainer={handleDeleteContainer}
        onAddTile={onAddTile}
        onAddContainer={handleAddContainer}
        onAddTab={handleAddTab}
        onRenameTab={handleRenameTab}
        onDeleteTab={handleDeleteTab}
        onRenameContainer={handleRenameContainer}
        onTabChange={handleTabChange}
        makeLayoutChangeHandler={makeOnLayoutChange}
      />
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
