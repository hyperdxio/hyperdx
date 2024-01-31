import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import produce from 'immer';
import { Button, Form, Modal } from 'react-bootstrap';
import { ErrorBoundary } from 'react-error-boundary';
import RGL, { WidthProvider } from 'react-grid-layout';
import { useHotkeys } from 'react-hotkeys-hook';
import { useQueryClient } from 'react-query';
import { toast } from 'react-toastify';
import {
  JsonParam,
  StringParam,
  useQueryParam,
  withDefault,
} from 'use-query-params';
import {
  Badge,
  Box,
  Button as MButton,
  CopyButton,
  Flex,
  Group,
  Paper,
  Popover,
  ScrollArea,
  Text,
  Tooltip,
  Transition,
} from '@mantine/core';

import api from './api';
import { convertDateRangeToGranularityString, Granularity } from './ChartUtils';
import EditTileForm from './EditTileForm';
import GranularityPicker from './GranularityPicker';
import HDXHistogramChart from './HDXHistogramChart';
import HDXMarkdownChart from './HDXMarkdownChart';
import HDXMultiSeriesTableChart from './HDXMultiSeriesTableChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import HDXNumberChart from './HDXNumberChart';
import { dashboardToTerraform, dashboardToTerraformImport } from './iacUtils';
import { withAppNav } from './layout';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import SearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { FloppyIcon, TerraformFlatIcon } from './SVGIcons';
import { Tags } from './Tags';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';
import type { Alert, Chart, Dashboard } from './types';
import { useConfirm } from './useConfirm';
import { hashCode } from './utils';
import { ZIndexContext } from './zIndex';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const makeId = () => Math.floor(100000000 * Math.random()).toString(36);

const ReactGridLayout = WidthProvider(RGL);

const buildAndWhereClause = (query1: string, query2: string) => {
  if (!query1 && !query2) {
    return '';
  } else if (!query1) {
    return query2;
  } else if (!query2) {
    return query1;
  } else {
    return `${query1} (${query2})`;
  }
};

const Tile = forwardRef(
  (
    {
      chart,
      alert,
      dateRange,
      onDuplicateClick,
      onEditClick,
      onDeleteClick,
      query,
      queued,
      onSettled,
      granularity,

      // Properties forwarded by grid layout
      className,
      style,
      onMouseDown,
      onMouseUp,
      onTouchEnd,
      children,
      isHighlighed,
    }: {
      chart: Chart;
      alert?: Alert;
      dateRange: [Date, Date];
      onDuplicateClick: () => void;
      onEditClick: () => void;
      onDeleteClick: () => void;
      query: string;
      onSettled?: () => void;
      queued?: boolean;
      granularity: Granularity | undefined;

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
    const config = useMemo(() => {
      const type = chart.series[0].type;
      return type === 'time'
        ? {
            type,
            table: chart.series[0].table ?? 'logs',
            aggFn: chart.series[0].aggFn,
            field: chart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: chart.series[0].groupBy[0],
            where: buildAndWhereClause(query, chart.series[0].where),
            granularity:
              granularity ?? convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: chart.series[0].numberFormat,
            seriesReturnType: chart.seriesReturnType,
            series: chart.series.map(s => ({
              ...s,
              where: buildAndWhereClause(
                query,
                s.type === 'time' ? s.where : '',
              ),
            })),
          }
        : type === 'table'
        ? {
            type,
            table: chart.series[0].table ?? 'logs',
            aggFn: chart.series[0].aggFn,
            field: chart.series[0].field ?? '', // TODO: Fix in definition
            groupBy: chart.series[0].groupBy[0],
            sortOrder: chart.series[0].sortOrder ?? 'desc', // TODO: Centralize this maybe?
            where: buildAndWhereClause(query, chart.series[0].where),
            granularity:
              granularity ?? convertDateRangeToGranularityString(dateRange, 60),
            dateRange,
            numberFormat: chart.series[0].numberFormat,
            series: chart.series.map(s => ({
              ...s,
              where: buildAndWhereClause(
                query,
                s.type === 'table' ? s.where : '',
              ),
            })),
            seriesReturnType: chart.seriesReturnType,
          }
        : type === 'histogram'
        ? {
            type,
            table: chart.series[0].table ?? 'logs',
            field: chart.series[0].field ?? '', // TODO: Fix in definition
            where: buildAndWhereClause(query, chart.series[0].where),
            dateRange,
          }
        : type === 'markdown'
        ? {
            type,
            content: chart.series[0].content,
          }
        : type === 'number'
        ? {
            type,
            table: chart.series[0].table ?? 'logs',
            aggFn: chart.series[0].aggFn,
            field: chart.series[0].field ?? '', // TODO: Fix in definition
            where: buildAndWhereClause(query, chart.series[0].where),
            dateRange,
            numberFormat: chart.series[0].numberFormat,
          }
        : {
            type,
            fields: chart.series[0].fields ?? [],
            where: buildAndWhereClause(query, chart.series[0].where),
            dateRange,
          };
    }, [query, chart, dateRange, granularity]);

    // Markdown doesn't have an onSettled function
    useEffect(() => {
      if (config.type === 'markdown') {
        onSettled?.();
      }
    }, [config.type, onSettled]);

    useEffect(() => {
      if (isHighlighed) {
        document
          .getElementById(`chart-${chart.id}`)
          ?.scrollIntoView({ behavior: 'smooth' });
      }
    }, []);

    return (
      <div
        className={`bg-hdx-dark p-3 ${className} d-flex flex-column ${
          isHighlighed && 'dashboard-chart-highlighted'
        }`}
        id={`chart-${chart.id}`}
        key={chart.id}
        ref={ref}
        style={style}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
      >
        <div className="d-flex justify-content-between align-items-center mb-3 cursor-grab">
          <div className="fs-7 text-muted">{chart.name}</div>
          <i className="bi bi-grip-horizontal text-muted" />
          <div className="fs-7 text-muted d-flex gap-2 align-items-center">
            {alert && (
              <Link href="/alerts">
                <div
                  className={`rounded px-1 text-muted cursor-pointer ${
                    alert.state === 'ALERT'
                      ? 'bg-danger effect-pulse'
                      : 'bg-grey opacity-90'
                  }`}
                >
                  <i
                    className="bi bi-bell text-white"
                    title={`Has alert and is in ${alert.state} state`}
                  />
                </div>
              </Link>
            )}

            <Button
              variant="link"
              className="text-muted-hover p-0"
              size="sm"
              onClick={onDuplicateClick}
              title="Duplicate"
            >
              <i className="bi bi-copy fs-8"></i>
            </Button>
            <Button
              variant="link"
              className="text-muted-hover p-0"
              size="sm"
              onClick={onEditClick}
              title="Edit"
            >
              <i className="bi bi-pencil"></i>
            </Button>
            <Button
              variant="link"
              className="text-muted-hover p-0"
              size="sm"
              onClick={onDeleteClick}
              title="Edit"
            >
              <i className="bi bi-trash"></i>
            </Button>
          </div>
        </div>
        {queued === true ? (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
            Waiting for other queries to finish...
          </div>
        ) : (
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
              {chart.series[0].type === 'time' && config.type === 'time' && (
                <HDXMultiSeriesTimeChart config={config} />
              )}
              {chart.series[0].type === 'table' && config.type === 'table' && (
                <HDXMultiSeriesTableChart config={config} />
              )}
              {config.type === 'histogram' && (
                <HDXHistogramChart config={config} onSettled={onSettled} />
              )}
              {config.type === 'markdown' && (
                <HDXMarkdownChart config={config} />
              )}
              {config.type === 'number' && (
                <HDXNumberChart config={config} onSettled={onSettled} />
              )}
              {config.type === 'search' && (
                <div style={{ height: '100%' }}>
                  <LogTableWithSidePanel
                    config={config}
                    isLive={false}
                    isUTC={false}
                    setIsUTC={() => {}}
                    onPropertySearchClick={() => {}}
                    onSettled={onSettled}
                  />
                </div>
              )}
            </ErrorBoundary>
          </div>
        )}
        {children}
      </div>
    );
  },
);

const EditTileModal = ({
  isLocalDashboard,
  chart,
  alerts,
  dateRange,
  onSave,
  show,
  onClose,
}: {
  isLocalDashboard: boolean;
  chart: Chart | undefined;
  alerts: Alert[];
  dateRange: [Date, Date];
  onSave: (chart: Chart, alerts?: Alert[]) => void;
  onClose: () => void;
  show: boolean;
}) => {
  return (
    <ZIndexContext.Provider value={1055}>
      <Modal
        aria-labelledby="contained-modal-title-vcenter"
        centered
        onHide={onClose}
        show={show}
        size="xl"
        enforceFocus={false}
      >
        <Modal.Body
          className="bg-hdx-dark rounded d-flex flex-column"
          style={{ minHeight: '80vh' }}
        >
          <EditTileForm
            isLocalDashboard={isLocalDashboard}
            chart={chart}
            alerts={alerts}
            onSave={onSave}
            onClose={onClose}
            dateRange={dateRange}
          />
        </Modal.Body>
      </Modal>
    </ZIndexContext.Provider>
  );
};

const updateLayout = (newLayout: RGL.Layout[]) => {
  return (dashboard: Dashboard) => {
    for (const chart of dashboard.charts) {
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

  return (
    <>
      {editing ? (
        <form
          className="d-flex align-items-center"
          onSubmit={e => {
            e.preventDefault();
            onSave(editedName);
            setEditing(false);
          }}
        >
          <Form.Control
            type="text"
            value={editedName}
            onChange={e => setEditedName(e.target.value)}
            placeholder="Dashboard Name"
          />
          <Button
            variant="outline-success"
            type="submit"
            className="ms-3 text-muted-hover-black text-nowrap"
          >
            Save Name
          </Button>
        </form>
      ) : (
        <div
          className="fs-4 d-flex align-items-center"
          style={{ minWidth: 100 }}
        >
          <div className="text-truncate" style={{ minWidth: 100 }}>
            {name}
          </div>
          <span
            role="button"
            className="ms-3 text-muted-hover fs-8"
            onClick={() => setEditing(true)}
          >
            <i className="bi bi-pencil"></i>
          </span>
        </div>
      )}
    </>
  );
}

function DashboardFilter({
  onSave,
  onSubmit,
  dashboardQuery,
}: {
  onSubmit: (query: string) => void;
  onSave: (query: string) => void;
  dashboardQuery: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputQuery, setInputQuery] = useState<string>(dashboardQuery);

  useHotkeys(
    '/',
    () => {
      inputRef.current?.focus();
    },
    { preventDefault: true },
    [inputRef],
  );

  return (
    <form
      className="d-flex w-100"
      onSubmit={e => {
        e.preventDefault();
        onSubmit(inputQuery);
      }}
    >
      <SearchInput
        inputRef={inputRef}
        value={inputQuery}
        onChange={value => setInputQuery(value)}
        onSearch={() => {}}
        placeholder="Filter charts by service, property, etc."
      />
      <Button
        variant="dark"
        type="submit"
        className="text-nowrap fs-8 ms-2 text-muted-hover d-flex align-items-center"
      >
        <div className="me-2 d-flex align-items-center">
          <i className="bi bi-funnel"></i>
        </div>
        Filter
      </Button>
      <Button
        variant="dark"
        onClick={() => onSave(inputQuery)}
        className="text-nowrap fs-8 ms-2 text-muted-hover d-flex align-items-center"
      >
        <div className="me-2 d-flex align-items-center">
          <FloppyIcon width={14} />
        </div>
        Save
      </Button>
    </form>
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
export default function DashboardPage() {
  const { data: dashboardsData, isLoading: isDashboardsLoading } =
    api.useDashboards();
  const { data: meData } = api.useMe();
  const updateDashboard = api.useUpdateDashboard();
  const createDashboard = api.useCreateDashboard();
  const saveAlert = api.useSaveAlert();
  const deleteAlert = api.useDeleteAlert();
  const updateAlert = api.useUpdateAlert();
  const router = useRouter();
  const { dashboardId, config } = router.query;
  const queryClient = useQueryClient();

  const confirm = useConfirm();

  const [localDashboard, setLocalDashboard] = useQueryParam<Dashboard>(
    'config',
    withDefault(JsonParam, {
      id: '',
      name: 'My New Dashboard',
      charts: [],
      alerts: [],
      query: '',
    }),
    { updateType: 'pushIn', enableBatching: true },
  );

  const isLocalDashboard = dashboardId == null;
  const dashboardHash =
    dashboardId != null ? dashboardId : hashCode(`${config}`);

  const dashboard: Dashboard | undefined = useMemo(() => {
    if (isLocalDashboard) {
      return localDashboard;
    }
    if (dashboardsData != null) {
      const matchedDashboard = dashboardsData.data.find(
        (d: any) => d._id === dashboardId,
      );
      return matchedDashboard;
    }
  }, [dashboardsData, dashboardId, isLocalDashboard, localDashboard]);

  // Update dashboard
  const [isSavedNow, _setSavedNow] = useState(false);
  const savedNowTimerRef = useRef<any>(null);
  const setSavedNow = useCallback(() => {
    if (savedNowTimerRef.current != null) {
      clearTimeout(savedNowTimerRef.current);
    }
    _setSavedNow(true);
    savedNowTimerRef.current = setTimeout(() => {
      _setSavedNow(false);
    }, 1500);
  }, []);

  const setDashboard = useCallback(
    (newDashboard: Dashboard) => {
      if (isLocalDashboard) {
        setLocalDashboard(newDashboard);
      } else {
        updateDashboard.mutate(
          {
            id: `${dashboardId}`,
            name: newDashboard.name,
            charts: newDashboard.charts,
            query: newDashboard.query ?? '',
            tags: newDashboard.tags,
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries(['dashboards']);
              setSavedNow();
            },
          },
        );
      }
    },
    [
      isLocalDashboard,
      setLocalDashboard,
      updateDashboard,
      dashboardId,
      queryClient,
      setSavedNow,
    ],
  );

  const [searchedQuery, setSearchedQuery] = useQueryParam(
    'q',
    withDefault(StringParam, undefined),
  );

  const [granularityQuery, setGranularityQuery] = useQueryParam(
    'granularity',
    withDefault<Granularity | undefined, Granularity | undefined>(
      // TODO: Validate?
      StringParam as any,
      undefined,
    ),
  );

  const dashboardQuery = searchedQuery ?? dashboard?.query ?? '';

  const deleteDashboard = api.useDeleteDashboard();

  const [editedChart, setEditedChart] = useState<undefined | Chart>();
  const editedChartAlerts = useMemo<Alert[]>(
    () => dashboard?.alerts?.filter(a => a.chartId === editedChart?.id) || [],
    [dashboard?.alerts, editedChart?.id],
  );

  const { searchedTimeRange, displayedTimeInputValue, onSearch } =
    useNewTimeQuery({
      isUTC: false,
      initialDisplayValue: 'Past 1h',
      initialTimeRange: defaultTimeRange,
    });

  const [input, setInput] = useState<string>(displayedTimeInputValue);
  useEffect(() => {
    setInput(displayedTimeInputValue);
  }, [displayedTimeInputValue]);

  const onAddChart = () => {
    setEditedChart({
      id: makeId(),
      name: 'My New Chart',
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      series: [
        {
          table: 'logs',
          type: 'time',
          aggFn: 'count',
          field: undefined,
          where: '',
          groupBy: [],
        },
      ],
      seriesReturnType: 'column',
    });
  };

  // Open new chart modal if it's a temp dashboard with 0 charts created
  useEffect(() => {
    if (isLocalDashboard && router.isReady && dashboard?.charts.length === 0) {
      onAddChart();
    }
  }, [isLocalDashboard, router, dashboard?.charts.length]);

  const [highlightedChartId] = useQueryParam('highlightedChartId');

  const tiles = useMemo(
    () =>
      (dashboard?.charts ?? []).map(chart => {
        return (
          <Tile
            key={chart.id}
            query={dashboardQuery}
            chart={chart}
            dateRange={searchedTimeRange}
            onEditClick={() => setEditedChart(chart)}
            granularity={granularityQuery}
            alert={dashboard?.alerts?.find(a => a.chartId === chart.id)}
            isHighlighed={highlightedChartId === chart.id}
            onDuplicateClick={async () => {
              if (dashboard != null) {
                if (!(await confirm(`Duplicate ${chart.name}?`, 'Duplicate'))) {
                  return;
                }
                setDashboard({
                  ...dashboard,
                  charts: [
                    ...dashboard.charts,
                    {
                      ...chart,
                      id: makeId(),
                      name: `${chart.name} (Copy)`,
                    },
                  ],
                });
              }
            }}
            onDeleteClick={async () => {
              if (dashboard != null) {
                if (!(await confirm(`Delete ${chart.name}?`, 'Delete'))) {
                  return;
                }
                setDashboard({
                  ...dashboard,
                  charts: dashboard.charts.filter(c => c.id !== chart.id),
                });
              }
            }}
          />
        );
      }),
    [
      dashboard,
      dashboardQuery,
      searchedTimeRange,
      granularityQuery,
      highlightedChartId,
      confirm,
      setDashboard,
    ],
  );

  const handleSaveChart = useCallback(
    (newChart: Chart, newAlerts?: Alert[]) => {
      if (dashboard == null) {
        return;
      }

      setDashboard(
        produce(dashboard, draft => {
          const chartIndex = draft.charts.findIndex(
            chart => chart.id === newChart.id,
          );
          // This is a new chart (probably?)
          if (chartIndex === -1) {
            draft.charts.push(newChart);
          } else {
            draft.charts[chartIndex] = newChart;
          }
        }),
      );

      // Using only the first alert for now
      const [editedChartAlert] = editedChartAlerts;
      const newAlert = newAlerts?.[0];

      if (editedChartAlert?._id) {
        // Update or delete
        if (newAlert != null) {
          updateAlert.mutate(
            {
              ...newAlert,
              id: editedChartAlert._id,
              dashboardId: dashboardId as string,
              chartId: editedChart?.id,
            },
            {
              onError: err => {
                console.error(err);
                toast.error('Failed to update alert.');
              },
            },
          );
        } else {
          deleteAlert.mutate(editedChartAlert._id, {
            onError: err => {
              console.error(err);
              toast.error('Failed to delete alert.');
            },
          });
        }
      } else if (newAlert) {
        // Create
        saveAlert.mutate(
          {
            ...newAlert,
            dashboardId: dashboardId as string,
            chartId: editedChart?.id,
          },
          {
            onError: err => {
              console.error(err);
              toast.error('Failed to save alert.');
            },
          },
        );
      }

      setEditedChart(undefined);
    },
    [
      dashboard,
      dashboardId,
      deleteAlert,
      editedChart?.id,
      editedChartAlerts,
      saveAlert,
      setDashboard,
      updateAlert,
    ],
  );

  const layout = (dashboard?.charts ?? []).map(chart => {
    return {
      i: chart.id,
      x: chart.x,
      y: chart.y,
      w: chart.w,
      h: chart.h,
      minH: 2,
      minW: 3,
    };
  });

  const tagsCount = dashboard?.tags?.length ?? 0;

  return (
    <div>
      <Head>
        <title>Dashboard - HyperDX</title>
      </Head>
      {dashboard != null ? (
        <EditTileModal
          isLocalDashboard={isLocalDashboard}
          dateRange={searchedTimeRange}
          key={editedChart?.id}
          chart={editedChart}
          alerts={editedChartAlerts}
          show={!!editedChart}
          onClose={() => setEditedChart(undefined)}
          onSave={handleSaveChart}
        />
      ) : null}
      <div className="flex-grow-1">
        <div className="d-flex justify-content-between p-3 align-items-center">
          {dashboard != null && (
            <div
              className="d-flex align-items-center"
              style={{ minWidth: 150 }}
            >
              <DashboardName
                key={`${dashboardHash}`}
                name={dashboard?.name}
                onSave={editedName =>
                  setDashboard({
                    ...dashboard,
                    name: editedName,
                  })
                }
              />
              {!isLocalDashboard && (
                <Tags
                  allowCreate
                  values={dashboard.tags || []}
                  onChange={tags => {
                    setDashboard({
                      ...dashboard,
                      tags,
                    });
                  }}
                >
                  <Badge
                    color={tagsCount ? 'blue' : 'gray'}
                    variant={tagsCount ? 'light' : 'filled'}
                    mx="sm"
                    fw="normal"
                    tt="none"
                    className="cursor-pointer"
                  >
                    <i className="bi bi-tags-fill me-1"></i>
                    {!tagsCount
                      ? 'Add Tag'
                      : tagsCount === 1
                      ? dashboard.tags[0]
                      : `${tagsCount} Tags`}
                  </Badge>
                </Tags>
              )}
              <Transition mounted={isSavedNow} transition="skew-down">
                {style => (
                  <Badge fw="normal" tt="none" ml="xs" style={style}>
                    Saved now
                  </Badge>
                )}
              </Transition>
              {isLocalDashboard && (
                <span className="text-muted ms-3">(Unsaved Dashboard)</span>
              )}
            </div>
          )}
          <div className="d-flex flex-grow-1 justify-content-end">
            <div className="me-2 flex-grow-1" style={{ maxWidth: 450 }}>
              <form
                className="d-flex align-items-center"
                onSubmit={e => {
                  e.preventDefault();
                  onSearch(input);
                }}
                style={{ height: 33 }}
              >
                <SearchTimeRangePicker
                  inputValue={input}
                  setInputValue={setInput}
                  onSearch={range => {
                    onSearch(range);
                  }}
                />
                <div style={{ width: 200 }} className="ms-2">
                  <GranularityPicker
                    value={granularityQuery}
                    onChange={setGranularityQuery}
                  />
                </div>
                <input
                  type="submit"
                  value="Search Time Range"
                  style={{
                    width: 0,
                    height: 0,
                    border: 0,
                    padding: 0,
                  }}
                />
              </form>
            </div>
            <Popover width={700} position="bottom" withArrow shadow="md">
              <Popover.Target>
                <Tooltip
                  label="Get Terraform configuration for this dashboard"
                  color="dark"
                >
                  <Button
                    variant="dark"
                    className="text-muted-hover-black me-2 text-nowrap"
                    size="sm"
                  >
                    <TerraformFlatIcon width={14} />
                  </Button>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown>
                <Badge size="xs" mb="sm">
                  Beta
                </Badge>
                {dashboard?._id != null && (
                  <>
                    <Flex justify="space-between" align="center" mb="md">
                      <Text size="lg" c="gray.4" span>
                        Terraform Resource Import Commands
                      </Text>
                      <CopyButton value={dashboardToTerraformImport(dashboard)}>
                        {({ copied, copy }) => (
                          <MButton
                            color={copied ? 'green' : 'dark.1'}
                            size="xs"
                            variant="subtle"
                            onClick={copy}
                          >
                            {copied
                              ? 'Commands Copied'
                              : 'Copy Import Commands'}
                          </MButton>
                        )}
                      </CopyButton>
                    </Flex>
                    <Paper shadow="none" radius="md" bg="dark.8" mb="md">
                      <ScrollArea p="sm">
                        <pre style={{ margin: 0 }}>
                          {dashboardToTerraformImport(dashboard)}
                        </pre>
                      </ScrollArea>
                    </Paper>
                  </>
                )}
                <Flex justify="space-between" align="center" mb="md">
                  <Text size="lg" c="gray.4" span>
                    Dashboard Configuration
                  </Text>
                  <CopyButton
                    value={dashboardToTerraform(
                      dashboard,
                      meData?.accessKey ?? 'YOUR_PERSONAL_API_ACCESS_KEY',
                    )}
                  >
                    {({ copied, copy }) => (
                      <MButton
                        color={copied ? 'green' : 'dark.1'}
                        size="xs"
                        variant="subtle"
                        onClick={copy}
                      >
                        {copied ? 'Configuration Copied' : 'Copy Configuration'}
                      </MButton>
                    )}
                  </CopyButton>
                </Flex>

                <Paper shadow="none" radius="md" bg="dark.8">
                  <ScrollArea h={450} p="sm">
                    <pre>
                      {dashboardToTerraform(
                        dashboard,
                        meData?.accessKey ?? 'YOUR_PERSONAL_API_ACCESS_KEY',
                      )}
                    </pre>
                  </ScrollArea>
                </Paper>
              </Popover.Dropdown>
            </Popover>
            <Button
              variant="outline-success"
              className="text-muted-hover-black me-2 text-nowrap"
              size="sm"
              onClick={onAddChart}
              style={{ minWidth: 120 }}
            >
              <i className="bi bi-plus me-1"></i>
              Add Tile
            </Button>
            {isLocalDashboard ? (
              <Button
                variant="outline-success"
                className="text-muted-hover-black d-flex align-items-center fs-7"
                onClick={() => {
                  createDashboard
                    .mutateAsync({
                      name: dashboard?.name ?? 'My New Dashboard',
                      charts: dashboard?.charts ?? [],
                      query: dashboard?.query ?? '',
                    })
                    .then((dashboard: any) => {
                      router.push(`/dashboards/${dashboard.data._id}`);
                      queryClient.invalidateQueries('dashboards');
                    });
                }}
              >
                <div className="pe-2 d-flex align-items-center">
                  <FloppyIcon width={14} />
                </div>
                Save Dashboard
              </Button>
            ) : (
              <Button
                variant="dark"
                className="text-muted-hover text-nowrap"
                size="sm"
                onClick={async () => {
                  if (
                    !(await confirm(`Delete ${dashboard?.name}?`, 'Delete'))
                  ) {
                    return;
                  }
                  deleteDashboard.mutate(
                    {
                      id: `${dashboardId}`,
                    },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries('dashboards');

                        const nextDashboard = dashboardsData?.data?.find(
                          (dashboard: any) => dashboard._id !== dashboardId,
                        );
                        if (nextDashboard != null) {
                          router.push(`/dashboards/${nextDashboard?._id}`);
                        } else {
                          // No other dashboard to go to, fall back to search
                          router.push('/search');
                        }
                      },
                    },
                  );
                }}
              >
                <i className="bi bi-trash"></i> Delete
              </Button>
            )}
          </div>
        </div>
        {dashboard != null && (
          <div className="px-3 my-2" key={`${dashboardHash}`}>
            <DashboardFilter
              key={dashboardQuery}
              dashboardQuery={dashboardQuery}
              onSave={query => {
                setDashboard({
                  ...dashboard,
                  query,
                });
                setSearchedQuery(undefined);
                toast.success('Dashboard filter saved and applied.');
              }}
              onSubmit={query => {
                setSearchedQuery(query);
              }}
            />
          </div>
        )}
        {isDashboardsLoading && (
          <div className="d-flex justify-content-center align-items-center">
            Loading Dashboard...
          </div>
        )}
        {dashboard?.charts.length === 0 && (
          <div className="d-flex justify-content-center align-items-center mt-4 bg-hdx-dark p-4 rounded mx-3">
            No charts added yet. Click the {'"'}Add Tile{'"'} button to get
            started.
          </div>
        )}
        {dashboard != null && dashboard.charts != null ? (
          <ReactGridLayout
            layout={layout}
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
            cols={12}
            rowHeight={160}
          >
            {tiles}
          </ReactGridLayout>
        ) : null}
      </div>
    </div>
  );
}

DashboardPage.getLayout = withAppNav;
