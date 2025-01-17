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
import produce from 'immer';
import { parseAsJson, parseAsString, useQueryState } from 'nuqs';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { Controller, useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  ChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DisplayType,
  SearchCondition,
  SearchConditionLanguage,
  SQLInterval,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CopyButton,
  Flex,
  Group,
  Indicator,
  Input,
  Menu,
  Modal,
  Paper,
  Popover,
  ScrollArea,
  Text,
  Title,
  Tooltip,
  Transition,
} from '@mantine/core';
import { useHover, usePrevious } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';

import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import DBNumberChart from '@/components/DBNumberChart';
import { DBSqlRowTable } from '@/components/DBRowTable';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import {
  Dashboard,
  type Tile,
  useCreateDashboard,
  useDeleteDashboard,
} from '@/dashboard';

import DBRowSidePanel from './components/DBRowSidePanel';
import OnboardingModal from './components/OnboardingModal';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import { DEFAULT_CHART_CONFIG } from './ChartUtils';
import { IS_LOCAL_MODE } from './config';
import { useDashboard } from './dashboard';
import GranularityPicker, {
  GranularityPickerControlled,
} from './GranularityPicker';
import HDXMarkdownChart from './HDXMarkdownChart';
import { withAppNav } from './layout';
import SearchInputV2 from './SearchInputV2';
import {
  getFirstTimestampValueExpression,
  useSource,
  useSources,
} from './source';
import { Tags } from './Tags';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import { useConfirm } from './useConfirm';
import { hashCode, omit } from './utils';
import { ZIndexContext } from './zIndex';

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
      onSettled,
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
      isHighlighed,
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
      isHighlighed?: boolean;
    },
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    useEffect(() => {
      if (isHighlighed) {
        document
          .getElementById(`chart-${chart.id}`)
          ?.scrollIntoView({ behavior: 'smooth' });
      }
    }, []);

    const [queriedConfig, setQueriedConfig] = useState<
      ChartConfigWithDateRange | undefined
    >(undefined);

    const { data: source } = useSource({
      id: chart.config.source,
    });

    // const prevSource = usePrevious(source);
    // const prevChart = usePrevious(chart);
    // const prevDateRange = usePrevious(dateRange);
    // const prevGranularity = usePrevious(granularity);
    // const prevFilters = usePrevious(filters);

    useEffect(() => {
      if (source != null) {
        setQueriedConfig({
          ...chart.config,
          connection: source.connection,
          dateRange,
          granularity,
          timestampValueExpression: source.timestampValueExpression,
          from: source.from,
          implicitColumnExpression: source.implicitColumnExpression,
          filters,
        });
      }
    }, [source, chart, dateRange, granularity, filters]);

    const [hovered, setHovered] = useState(false);

    // Search tile
    const [rowId, setRowId] = useQueryState('rowWhere');
    const [_, setRowSource] = useQueryState('rowSource');
    const handleRowExpandClick = useCallback(
      (rowWhere: string) => {
        setRowId(rowWhere);
        setRowSource(chart.config.source);
      },
      [chart.config.source, setRowId, setRowSource],
    );

    return (
      <div
        className={`p-2 ${className} d-flex flex-column ${
          isHighlighed && 'dashboard-chart-highlighted'
        }`}
        id={`chart-${chart.id}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        key={chart.id}
        ref={ref}
        style={{
          background:
            'linear-gradient(180deg, rgba(250,250,250,0.018) 0%, rgba(250,250,250,0.008) 100%)',
          borderRadius: 2,
          ...style,
        }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
      >
        <div className="d-flex justify-content-between align-items-center mb-2 cursor-grab">
          <Text size="sm" c="gray.2" ms="xs">
            {chart.config.name}
          </Text>
          {hovered ? (
            <Flex gap="0px">
              <Button
                variant="subtle"
                color="gray.4"
                size="xxs"
                onClick={onDuplicateClick}
                title="Duplicate"
              >
                <i className="bi bi-copy fs-8"></i>
              </Button>
              <Button
                variant="subtle"
                size="xxs"
                color="gray.4"
                onClick={onEditClick}
                title="Edit"
              >
                <i className="bi bi-pencil"></i>
              </Button>
              <Button
                variant="subtle"
                size="xxs"
                color="gray.4"
                onClick={onDeleteClick}
                title="Edit"
              >
                <i className="bi bi-trash"></i>
              </Button>
            </Flex>
          ) : (
            <Box h={22} />
          )}
        </div>
        <div
          className="fs-7 text-muted flex-grow-1 overflow-hidden"
          onMouseDown={e => e.stopPropagation()}
        >
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
                sourceId={chart.config.source}
                showDisplaySwitcher={false}
                config={queriedConfig}
                onTimeRangeSelect={onTimeRangeSelect}
              />
            )}
            {queriedConfig?.displayType === DisplayType.Table && (
              <Box p="xs" h="100%">
                <DBTableChart config={queriedConfig} />
              </Box>
            )}
            {queriedConfig?.displayType === DisplayType.Number && (
              <DBNumberChart config={queriedConfig} />
            )}
            {queriedConfig?.displayType === DisplayType.Markdown && (
              <HDXMarkdownChart config={queriedConfig} />
            )}
            {queriedConfig?.displayType === DisplayType.Search && (
              <DBSqlRowTable
                enabled
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
                  limit: { limit: 200 },
                  select:
                    queriedConfig.select ||
                    source?.defaultTableSelectExpression ||
                    '',
                  groupBy: undefined,
                  granularity: undefined,
                }}
                onRowExpandClick={handleRowExpandClick}
                highlightedLineId={rowId ?? undefined}
                onScroll={() => {}}
                isLive={false}
                queryKeyPrefix={'search'}
              />
            )}
          </ErrorBoundary>
        </div>
        {children}
      </div>
    );
  },
);

const EditTileModal = ({
  chart,
  onClose,
  onSave,
  dateRange,
}: {
  chart: Tile | undefined;
  onClose: () => void;
  dateRange: [Date, Date];
  onSave: (chart: Tile) => void;
}) => {
  return (
    <Modal
      opened={chart != null}
      onClose={onClose}
      withCloseButton={false}
      centered
      size="90%"
      padding="xs"
    >
      {chart != null && (
        <EditTimeChartForm
          chartConfig={chart.config}
          setChartConfig={config => {}}
          dateRange={dateRange}
          onSave={config => {
            onSave({
              ...chart,
              config: config,
            });
          }}
          onClose={onClose}
        />
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
            onChange={e => setEditedName(e.target.value)}
            placeholder="Dashboard Name"
          />
          <Button ms="sm" variant="outline" type="submit" color="green">
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
              color="gray.4"
              onClick={() => setEditing(true)}
            >
              <i className="bi bi-pencil"></i>
            </Button>
          )}
        </div>
      )}
    </Box>
  );
}

function DBDashboardPage({ presetConfig }: { presetConfig?: Dashboard }) {
  const confirm = useConfirm();

  const router = useRouter();
  const { dashboardId } = router.query;

  const {
    dashboard,
    setDashboard,
    dashboardHash,
    isLocalDashboard,
    isLocalDashboardEmpty,
  } = useDashboard({
    dashboardId: dashboardId as string | undefined,
    presetConfig,
  });

  const { data: sources } = useSources();

  const [highlightedChartId] = useQueryState('highlightedChartId');

  const [granularity, setGranularity] = useQueryState(
    'granularity',
    parseAsString,
    // TODO: Build parser
  ) as [SQLInterval | undefined, (value: SQLInterval | undefined) => void];
  const [where, setWhere] = useQueryState(
    'where',
    parseAsString.withDefault(''),
  );
  const [whereLanguage, setWhereLanguage] = useQueryState(
    'whereLanguage',
    parseAsString.withDefault('lucene'),
  );

  const { control, watch, setValue, handleSubmit } = useForm<{
    granularity: SQLInterval | 'auto';
    where: SearchCondition;
    whereLanguage: SearchConditionLanguage;
  }>({
    defaultValues: {
      granularity: 'auto',
      where: '',
      whereLanguage: 'lucene',
    },
    values: {
      granularity: granularity ?? 'auto',
      where: where ?? '',
      whereLanguage: (whereLanguage as SearchConditionLanguage) ?? 'lucene',
    },
  });
  watch((data, { name, type }) => {
    if (name === 'granularity' && type === 'change') {
      setGranularity(data.granularity as SQLInterval);
    }
  });

  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState('Past 1h');

  const {
    searchedTimeRange,
    // displayedTimeInputValue,
    // setDisplayedTimeInputValue,
    onSearch,
    onTimeRangeSelect,
  } = useNewTimeQuery({
    initialDisplayValue: 'Past 1h',
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
    // showRelativeInterval: isLive,
  });

  const onSubmit = () => {
    onSearch(displayedTimeInputValue);
    handleSubmit(data => {
      setWhere(data.where as SearchCondition);
      setWhereLanguage((data.whereLanguage as SearchConditionLanguage) ?? null);
    })();
  };

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
              granularity ?? undefined
              // isRefreshEnabled ? granularityOverride : granularityQuery
            }
            filters={[
              {
                type: whereLanguage === 'sql' ? 'sql' : 'lucene',
                condition: where,
              },
            ]}
            onTimeRangeSelect={onTimeRangeSelect}
            isHighlighed={highlightedChartId === chart.id}
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
                    `Duplicate ${chart.config.name}?`,
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
                    },
                  ],
                });
              }
            }}
            onDeleteClick={async () => {
              if (dashboard != null) {
                if (
                  !(await confirm(`Delete ${chart.config.name}?`, 'Delete'))
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
      // isRefreshEnabled,
      // granularityOverride,
      // granularityQuery,
      highlightedChartId,
      confirm,
      setDashboard,
      granularity,
      where,
      whereLanguage,
      onTimeRangeSelect,
    ],
  );

  const uniqueSources = useMemo(() => {
    return [...new Set(dashboard?.tiles.map(tile => tile.config.source))];
  }, [dashboard?.tiles]);
  const { data: defaultSource } = useSource({ id: uniqueSources[0] });
  const defaultDatabaseName = defaultSource?.from.databaseName;
  const defaultTableName = defaultSource?.from.tableName;

  const deleteDashboard = useDeleteDashboard();

  // Search tile
  const [rowId, setRowId] = useQueryState('rowWhere');
  const [rowSource, setRowSource] = useQueryState('rowSource');
  const { data: rowSidePanelSource } = useSource({ id: rowSource });
  const handleSidePanelClose = useCallback(() => {
    setRowId(null);
    setRowSource(null);
  }, [setRowId, setRowSource]);

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

  return (
    <Box p="sm">
      <Head>
        <title>Dashboard – HyperDX</title>
      </Head>
      <OnboardingModal />
      <EditTileModal
        chart={editedTile}
        onClose={() => setEditedTile(undefined)}
        dateRange={searchedTimeRange}
        onSave={newChart => {
          if (dashboard == null) {
            return;
          }

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
          );

          setEditedTile(undefined);
        }}
      />
      {IS_LOCAL_MODE === false && isLocalDashboard && isLocalDashboardEmpty && (
        <Paper my="lg" p="md">
          <Flex justify="space-between" align="center">
            <Text c="gray.4" size="sm">
              This is a temporary dashboard and can not be saved.
            </Text>
            <Button
              variant="outline"
              color="green"
              fw={400}
              onClick={onCreateDashboard}
            >
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
        {!isLocalDashboard /* local dashboards cant be "deleted" */ && (
          <Menu width={250}>
            <Menu.Target>
              <Button variant="outline" color="dark.2" px="xs" size="xs">
                <i className="bi bi-three-dots-vertical" />
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item
                leftSection={<i className="bi bi-trash-fill" />}
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
        {/* <Button variant="outline" color="gray.4" size="sm">
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
                connectionId={defaultSource?.connection}
                database={defaultDatabaseName}
                table={defaultTableName}
                control={control}
                name="where"
                placeholder="SQL WHERE clause (ex. column = 'foo')"
                onLanguageChange={lang => setValue('whereLanguage', lang)}
                language="sql"
                onSubmit={onSubmit}
                label="GLOBAL WHERE"
                enableHotkey
              />
            ) : (
              <SearchInputV2
                connectionId={defaultSource?.connection}
                database={defaultDatabaseName}
                table={defaultTableName}
                control={control}
                name="where"
                onLanguageChange={lang => setValue('whereLanguage', lang)}
                language="lucene"
                placeholder="Search your events w/ Lucene ex. column:foo"
                enableHotkey
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
        <Button variant="outline" type="submit" color="green">
          <i className="bi bi-play"></i>
        </Button>
      </Flex>
      <Box mt="sm">
        {dashboard != null && dashboard.tiles != null ? (
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
        ) : null}
      </Box>
      <Button
        variant="outline"
        mt="sm"
        color={dashboard?.tiles.length === 0 ? 'green' : 'dark.3'}
        fw={400}
        onClick={onAddTile}
        w="100%"
      >
        + Add New Tile
      </Button>
      {rowId && rowSidePanelSource && (
        <DBRowSidePanel
          source={rowSidePanelSource}
          rowId={rowId}
          onClose={handleSidePanelClose}
        />
      )}
    </Box>
  );
}

const DBDashboardPageDynamic = dynamic(async () => DBDashboardPage, {
  ssr: false,
});

// @ts-ignore
DBDashboardPageDynamic.getLayout = withAppNav;

export default DBDashboardPageDynamic;
