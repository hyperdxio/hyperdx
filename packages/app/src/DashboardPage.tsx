import Head from 'next/head';
import {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import RGL, { WidthProvider } from 'react-grid-layout';
import produce from 'immer';
import HDXMarkdownChart from './HDXMarkdownChart';
import { Button, Form, Modal } from 'react-bootstrap';
import { useHotkeys } from 'react-hotkeys-hook';
import { useRouter } from 'next/router';
import { useQueryClient } from 'react-query';
import { toast } from 'react-toastify';
import {
  JsonParam,
  StringParam,
  useQueryParam,
  withDefault,
} from 'use-query-params';

import HDXLineChart from './HDXLineChart';
import AppNav from './AppNav';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { Granularity, convertDateRangeToGranularityString } from './ChartUtils';
import { FloppyIcon, Histogram } from './SVGIcons';
import SearchInput from './SearchInput';
import { hashCode } from './utils';
import TabBar from './TabBar';
import HDXHistogramChart from './HDXHistogramChart';
import api from './api';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import { parseTimeQuery, useNewTimeQuery, useTimeQuery } from './timeQuery';
import type { Alert } from './types';
import {
  EditSearchChartForm,
  EditMarkdownChartForm,
  EditHistogramChartForm,
  EditLineChartForm,
  EditNumberChartForm,
  EditTableChartForm,
} from './EditChartForm';
import HDXNumberChart from './HDXNumberChart';
import GranularityPicker from './GranularityPicker';
import HDXTableChart from './HDXTableChart';

import type { Chart } from './EditChartForm';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { ZIndexContext } from './zIndex';

const ReactGridLayout = WidthProvider(RGL);

type Dashboard = {
  id: string;
  name: string;
  charts: Chart[];
  alerts?: Alert[];
  query?: string;
};

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
      dateRange,
      onEditClick,
      onDeleteClick,
      query,
      queued,
      onSettled,
      granularity,
      hasAlert,

      // Properties forwarded by grid layout
      className,
      style,
      onMouseDown,
      onMouseUp,
      onTouchEnd,
      children,
    }: {
      chart: Chart;
      dateRange: [Date, Date];
      onEditClick: () => void;
      onDeleteClick: () => void;
      query: string;
      onSettled?: () => void;
      queued?: boolean;
      granularity: Granularity | undefined;
      hasAlert?: boolean;

      // Properties forwarded by grid layout
      className?: string;
      style?: React.CSSProperties;
      onMouseDown?: (e: React.MouseEvent) => void;
      onMouseUp?: (e: React.MouseEvent) => void;
      onTouchEnd?: (e: React.TouchEvent) => void;
      children?: React.ReactNode; // Resizer tooltip
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

    return (
      <div
        className={`bg-hdx-dark p-3 ${className} d-flex flex-column`}
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
            {hasAlert && (
              <div
                className="rounded px-1 text-muted bg-grey opacity-90 cursor-default"
                title="Has alert"
              >
                <span className="bi bi-bell" />
              </div>
            )}
            <Button
              variant="link"
              className="text-muted-hover p-0"
              size="sm"
              onClick={onEditClick}
            >
              <i className="bi bi-pencil"></i>
            </Button>
            <Button
              variant="link"
              className="text-muted-hover p-0"
              size="sm"
              onClick={onDeleteClick}
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
            {config.type === 'time' && (
              <HDXLineChart config={config} onSettled={onSettled} />
            )}
            {config.type === 'table' && (
              <HDXTableChart config={config} onSettled={onSettled} />
            )}
            {config.type === 'histogram' && (
              <HDXHistogramChart config={config} onSettled={onSettled} />
            )}
            {config.type === 'markdown' && <HDXMarkdownChart config={config} />}
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
          </div>
        )}
        {children}
      </div>
    );
  },
);

const EditChartModal = ({
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
  const [tab, setTab] = useState<
    | 'time'
    | 'search'
    | 'histogram'
    | 'markdown'
    | 'number'
    | 'table'
    | undefined
  >(undefined);
  const displayedTab = tab ?? chart?.series?.[0]?.type ?? 'time';

  return (
    <ZIndexContext.Provider value={1055}>
      <Modal
        aria-labelledby="contained-modal-title-vcenter"
        centered
        onHide={onClose}
        show={show}
        size="xl"
      >
        <Modal.Body className="bg-hdx-dark rounded">
          <TabBar
            className="fs-8 mb-3"
            items={[
              {
                text: (
                  <span>
                    <i className="bi bi-graph-up" /> Line Chart
                  </span>
                ),
                value: 'time',
              },
              {
                text: (
                  <span>
                    <i className="bi bi-card-list" /> Search Results
                  </span>
                ),
                value: 'search',
              },
              {
                text: (
                  <span>
                    <i className="bi bi-table" /> Table
                  </span>
                ),
                value: 'table',
              },
              {
                text: (
                  <span>
                    <Histogram width={12} color="#fff" /> Histogram
                  </span>
                ),
                value: 'histogram',
              },
              {
                text: (
                  <span>
                    <i className="bi bi-123"></i> Number
                  </span>
                ),
                value: 'number',
              },
              {
                text: (
                  <span>
                    <i className="bi bi-markdown"></i> Markdown
                  </span>
                ),
                value: 'markdown',
              },
            ]}
            activeItem={displayedTab}
            onClick={v => {
              setTab(v);
            }}
          />
          {displayedTab === 'time' && chart != null && (
            <EditLineChartForm
              isLocalDashboard={isLocalDashboard}
              chart={produce(chart, draft => {
                draft.series[0].type = 'time';
              })}
              alerts={alerts}
              onSave={onSave}
              onClose={onClose}
              dateRange={dateRange}
            />
          )}
          {displayedTab === 'table' && chart != null && (
            <EditTableChartForm
              chart={produce(chart, draft => {
                draft.series[0].type = 'table';
              })}
              onSave={onSave}
              onClose={onClose}
              dateRange={dateRange}
            />
          )}
          {displayedTab === 'histogram' && chart != null && (
            <EditHistogramChartForm
              chart={produce(chart, draft => {
                draft.series[0].type = 'histogram';
              })}
              onSave={onSave}
              onClose={onClose}
              dateRange={dateRange}
            />
          )}
          {displayedTab === 'search' && chart != null && (
            <EditSearchChartForm
              chart={produce(chart, draft => {
                draft.series[0].type = 'search';
              })}
              onSave={onSave}
              onClose={onClose}
              dateRange={dateRange}
            />
          )}
          {displayedTab === 'number' && chart != null && (
            <EditNumberChartForm
              chart={produce(chart, draft => {
                draft.series[0].type = 'number';
              })}
              onSave={onSave}
              onClose={onClose}
              dateRange={dateRange}
            />
          )}
          {displayedTab === 'markdown' && chart != null && (
            <EditMarkdownChartForm
              chart={produce(chart, draft => {
                draft.series[0].type = 'markdown';
              })}
              onSave={onSave}
              onClose={onClose}
            />
          )}
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
        <div className="fs-4 d-flex align-items-center">
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
  const updateDashboard = api.useUpdateDashboard();
  const createDashboard = api.useCreateDashboard();
  const saveAlert = api.useSaveAlert();
  const deleteAlert = api.useDeleteAlert();
  const updateAlert = api.useUpdateAlert();
  const router = useRouter();
  const { dashboardId, config } = router.query;
  const queryClient = useQueryClient();

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
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries(['dashboards']);
            },
          },
        );
      }
    },
    [
      dashboardId,
      updateDashboard,
      queryClient,
      isLocalDashboard,
      setLocalDashboard,
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
      id: Math.floor(100000000 * Math.random()).toString(36),
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
    });
  };

  // Open new chart modal if it's a temp dashboard with 0 charts created
  useEffect(() => {
    if (isLocalDashboard && router.isReady && dashboard?.charts.length === 0) {
      onAddChart();
    }
  }, [isLocalDashboard, router, dashboard?.charts.length]);

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
            hasAlert={dashboard?.alerts?.some(a => a.chartId === chart.id)}
            onDeleteClick={() => {
              if (dashboard != null) {
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
      searchedTimeRange,
      setDashboard,
      dashboardQuery,
      granularityQuery,
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

  return (
    <div className="d-flex w-100">
      <Head>
        <title>Dashboard - HyperDX</title>
      </Head>
      <AppNav fixed />
      {dashboard != null ? (
        <EditChartModal
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
            <div className="d-flex align-items-center">
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
            <Button
              variant="outline-success"
              className="text-muted-hover-black me-2 text-nowrap"
              size="sm"
              onClick={onAddChart}
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
                onClick={() => {
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
