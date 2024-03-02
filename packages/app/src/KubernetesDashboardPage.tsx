import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import cx from 'classnames';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Anchor,
  Badge,
  Card,
  Flex,
  Grid,
  Group,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Table,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';

import { FormatPodStatus } from './components/KubeComponents';
import api from './api';
import {
  convertDateRangeToGranularityString,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from './ChartUtils';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import { withAppNav } from './layout';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import MetricTagValueSelect from './MetricTagValueSelect';
import NamespaceDetailsSidePanel from './NamespaceDetailsSidePanel';
import NodeDetailsSidePanel from './NodeDetailsSidePanel';
import PodDetailsSidePanel from './PodDetailsSidePanel';
import HdxSearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { KubePhase } from './types';
import { formatNumber, formatUptime } from './utils';

const makeId = () => Math.floor(100000000 * Math.random()).toString(36);

const getKubePhaseNumber = (phase: string) => {
  switch (phase) {
    case 'running':
      return KubePhase.Running;
    case 'succeeded':
      return KubePhase.Succeeded;
    case 'pending':
      return KubePhase.Pending;
    case 'failed':
      return KubePhase.Failed;
    default:
      return KubePhase.Unknown;
  }
};

const Th = React.memo<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  onSort?: (sortOrder: 'asc' | 'desc') => void;
  sort?: 'asc' | 'desc' | null;
}>(({ children, onSort, sort, style }) => {
  return (
    <Table.Th
      style={style}
      className={cx({ 'cursor-pointer': !!onSort }, 'text-nowrap')}
      onClick={() => onSort?.(sort === 'asc' ? 'desc' : 'asc')}
    >
      {children}
      {!!sort && (
        <i
          className={`ps-1 text-slate-400 fs-8.5 bi bi-caret-${
            sort === 'asc' ? 'up-fill' : 'down-fill'
          }`}
        />
      )}
    </Table.Th>
  );
});

type InfraPodsStatusTableColumn =
  | 'restarts'
  | 'uptime'
  | 'cpuLimit'
  | 'memLimit'
  | 'phase';

const TableLoading = () => {
  return (
    <Table horizontalSpacing="md" highlightOnHover>
      <Table.Tbody key="table-loader">
        <Table.Tr>
          <Table.Td>
            <Skeleton height={8} my={6} />
          </Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td>
            <Skeleton height={8} my={6} />
          </Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td>
            <Skeleton height={8} my={6} />
          </Table.Td>
        </Table.Tr>
        <Table.Tr>
          <Table.Td>
            <Skeleton height={8} my={6} />
          </Table.Td>
        </Table.Tr>
      </Table.Tbody>
    </Table>
  );
};

export const InfraPodsStatusTable = ({
  dateRange,
  where,
}: {
  dateRange: [Date, Date];
  where: string;
}) => {
  const [phaseFilter, setPhaseFilter] = React.useState('running');
  const [sortState, setSortState] = React.useState<{
    column: InfraPodsStatusTableColumn;
    order: 'asc' | 'desc';
  }>({
    column: 'restarts',
    order: 'desc',
  });

  const groupBy = ['k8s.pod.name', 'k8s.namespace.name', 'k8s.node.name'];
  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        table: 'metrics',
        field: 'k8s.container.restarts - Gauge',
        type: 'table',
        aggFn: 'last_value',
        where,
        groupBy,
        ...(sortState.column === 'restarts' && {
          sortOrder: sortState.order,
        }),
      },
      {
        table: 'metrics',
        field: 'k8s.pod.uptime - Sum',
        type: 'table',
        aggFn: 'sum',
        where,
        groupBy,
        ...(sortState.column === 'uptime' && {
          sortOrder: sortState.order,
        }),
      },
      {
        table: 'metrics',
        field: 'k8s.pod.cpu.utilization - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.pod.cpu_limit_utilization - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
        ...(sortState.column === 'cpuLimit' && {
          sortOrder: sortState.order,
        }),
      },
      {
        table: 'metrics',
        field: 'k8s.pod.memory.usage - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.pod.memory_limit_utilization - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
        ...(sortState.column === 'memLimit' && {
          sortOrder: sortState.order,
        }),
      },
      {
        table: 'metrics',
        field: 'k8s.pod.phase - Gauge',
        type: 'table',
        aggFn: 'last_value',
        where,
        groupBy,
        ...(sortState.column === 'phase' && {
          sortOrder: sortState.order,
        }),
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
    ...(phaseFilter !== 'all' && {
      postGroupWhere: `series_6:${getKubePhaseNumber(phaseFilter)}`,
    }),
  });

  // TODO: Use useTable
  const podsList = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data.map((row: any) => {
      return {
        id: makeId(),
        name: row.group[0],
        namespace: row.group[1],
        node: row.group[2],
        restarts: row['series_0.data'],
        uptime: row['series_1.data'],
        cpuAvg: row['series_2.data'],
        cpuLimit: row['series_3.data'],
        memAvg: row['series_4.data'],
        memLimit: row['series_5.data'],
        phase: row['series_6.data'],
      };
    });
  }, [data]);

  const getLink = React.useCallback((podName: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('podName', `${podName}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  const getThSortProps = (column: InfraPodsStatusTableColumn) => ({
    onSort: (order: 'asc' | 'desc') => {
      setSortState({
        column,
        order,
      });
    },
    sort: sortState.column === column ? sortState.order : null,
  });

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Group align="center" justify="space-between">
          Pods
          <SegmentedControl
            size="xs"
            value={phaseFilter}
            onChange={setPhaseFilter}
            data={[
              { label: 'Running', value: 'running' },
              { label: 'Succeeded', value: 'succeeded' },
              { label: 'Pending', value: 'pending' },
              { label: 'Failed', value: 'failed' },
              { label: 'All', value: 'all' },
            ]}
          />
        </Group>
      </Card.Section>
      <Card.Section>
        <ScrollArea
          viewportProps={{
            style: { maxHeight: 300 },
          }}
        >
          {isLoading ? (
            <TableLoading />
          ) : isError ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              Unable to load pod metrics
            </div>
          ) : podsList.length === 0 ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              No pods found
            </div>
          ) : (
            <Table horizontalSpacing="md" highlightOnHover>
              <Table.Thead className="muted-thead">
                <Table.Tr>
                  <Th>Name</Th>
                  <Th>Namespace</Th>
                  <Th>Node</Th>
                  <Th {...getThSortProps('phase')} style={{ width: 130 }}>
                    Status
                  </Th>
                  <Th {...getThSortProps('cpuLimit')} style={{ width: 100 }}>
                    CPU/Limit
                  </Th>
                  <Th {...getThSortProps('memLimit')} style={{ width: 100 }}>
                    Mem/Limit
                  </Th>
                  <Th {...getThSortProps('uptime')} style={{ width: 80 }}>
                    Uptime
                  </Th>
                  <Th {...getThSortProps('restarts')} style={{ width: 100 }}>
                    Restarts
                  </Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {podsList.map(pod => (
                  <Link key={pod.id} href={getLink(pod.name)} legacyBehavior>
                    <Table.Tr className="cursor-pointer">
                      <Table.Td>{pod.name}</Table.Td>
                      <Table.Td>{pod.namespace}</Table.Td>
                      <Table.Td>{pod.node}</Table.Td>
                      <Table.Td>
                        <FormatPodStatus status={pod.phase} />
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          color="gray"
                          label={
                            formatNumber(
                              pod.cpuAvg,
                              K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                            ) + ' avg'
                          }
                        >
                          <span>
                            {formatNumber(
                              pod.cpuLimit,
                              K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                            )}
                          </span>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          color="gray"
                          label={
                            formatNumber(pod.memAvg, K8S_MEM_NUMBER_FORMAT) +
                            ' avg'
                          }
                        >
                          <span>
                            {formatNumber(
                              pod.memLimit,
                              K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                            )}
                          </span>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {pod.uptime ? formatUptime(pod.uptime) : '–'}
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="sm"
                          c={
                            pod.restarts >= 10
                              ? 'red.6'
                              : pod.restarts >= 5
                              ? 'yellow.3'
                              : 'grey.7'
                          }
                        >
                          {pod.restarts}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  </Link>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Card.Section>
    </Card>
  );
};

const NodesTable = ({
  where,
  dateRange,
}: {
  where: string;
  dateRange: [Date, Date];
}) => {
  const groupBy = ['k8s.node.name'];

  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        table: 'metrics',
        field: 'k8s.node.cpu.utilization - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.node.memory.usage - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.node.condition_ready - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.node.uptime - Sum',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy,
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const getLink = React.useCallback((nodeName: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('nodeName', `${nodeName}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  const nodesList = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data.map((row: any) => {
      return {
        name: row.group[0],
        namespace: row.group[1],
        cpuAvg: row['series_0.data'],
        memAvg: row['series_1.data'],
        ready: row['series_2.data'],
        uptime: row['series_3.data'],
      };
    });
  }, [data]);

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        Nodes
      </Card.Section>
      <Card.Section>
        <ScrollArea
          viewportProps={{
            style: { maxHeight: 300 },
          }}
        >
          {isLoading ? (
            <TableLoading />
          ) : isError ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              Unable to load nodes
            </div>
          ) : nodesList.length === 0 ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              No nodes found
            </div>
          ) : (
            <Table horizontalSpacing="md" highlightOnHover>
              <Table.Thead className="muted-thead">
                <Table.Tr>
                  <Table.Th>Node</Table.Th>
                  <Table.Th style={{ width: 130 }}>Status</Table.Th>
                  <Table.Th style={{ width: 130 }}>CPU</Table.Th>
                  <Table.Th style={{ width: 130 }}>Memory</Table.Th>
                  <Table.Th style={{ width: 130 }}>Uptime</Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {nodesList.map(node => (
                  <Link
                    key={node.name}
                    href={getLink(node.name)}
                    legacyBehavior
                  >
                    <Table.Tr className="cursor-pointer">
                      <Table.Td>{node.name || 'N/A'}</Table.Td>
                      <Table.Td>
                        {node.ready === 1 ? (
                          <Badge
                            variant="light"
                            color="green"
                            fw="normal"
                            tt="none"
                            size="md"
                          >
                            Ready
                          </Badge>
                        ) : (
                          <Badge
                            variant="light"
                            color="red"
                            fw="normal"
                            tt="none"
                            size="md"
                          >
                            Not Ready
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(
                          node.cpuAvg,
                          K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                        )}
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(node.memAvg, K8S_MEM_NUMBER_FORMAT)}
                      </Table.Td>
                      <Table.Td>
                        {node.uptime ? formatUptime(node.uptime) : '–'}
                      </Table.Td>
                    </Table.Tr>
                  </Link>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Card.Section>
    </Card>
  );
};

const NamespacesTable = ({
  where,
  dateRange,
}: {
  where: string;
  dateRange: [Date, Date];
}) => {
  const groupBy = ['k8s.namespace.name'];

  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        table: 'metrics',
        field: 'k8s.pod.cpu.utilization - Gauge',
        type: 'table',
        aggFn: 'sum',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.pod.memory.usage - Gauge',
        type: 'table',
        aggFn: 'sum',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.namespace.phase - Gauge',
        type: 'table',
        aggFn: 'last_value',
        where,
        groupBy,
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const namespacesList = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data.map((row: any) => {
      return {
        name: row.group[0],
        cpuAvg: row['series_0.data'],
        memAvg: row['series_1.data'],
        phase: row['series_2.data'],
      };
    });
  }, [data]);

  const getLink = React.useCallback((namespaceName: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('namespaceName', `${namespaceName}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        Namespaces
      </Card.Section>
      <Card.Section>
        <ScrollArea
          viewportProps={{
            style: { maxHeight: 300 },
          }}
        >
          {isLoading ? (
            <TableLoading />
          ) : isError ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              Unable to load namespaces
            </div>
          ) : namespacesList.length === 0 ? (
            <div className="p-4 text-center text-slate-500 fs-8">
              No namespaces found
            </div>
          ) : (
            <Table horizontalSpacing="md" highlightOnHover>
              <Table.Thead className="muted-thead">
                <Table.Tr>
                  <Table.Th>Namespace</Table.Th>
                  <Table.Th style={{ width: 130 }}>Phase</Table.Th>
                  <Table.Th style={{ width: 130 }}>CPU</Table.Th>
                  <Table.Th style={{ width: 130 }}>Memory</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {namespacesList.map(namespace => (
                  <Link
                    key={namespace.name}
                    href={getLink(namespace.name)}
                    legacyBehavior
                  >
                    <Table.Tr className="cursor-pointer">
                      <Table.Td>{namespace.name || 'N/A'}</Table.Td>
                      <Table.Td>
                        {namespace.phase === 1 ? (
                          <Badge
                            variant="light"
                            color="green"
                            fw="normal"
                            tt="none"
                            size="md"
                          >
                            Ready
                          </Badge>
                        ) : (
                          <Badge
                            variant="light"
                            color="red"
                            fw="normal"
                            tt="none"
                            size="md"
                          >
                            Terminating
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(
                          namespace.cpuAvg,
                          K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                        )}
                      </Table.Td>
                      <Table.Td>
                        {formatNumber(namespace.memAvg, K8S_MEM_NUMBER_FORMAT)}
                      </Table.Td>
                    </Table.Tr>
                  </Link>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </Card.Section>
    </Card>
  );
};

const K8sMetricTagValueSelect = ({
  metricAttribute,
  searchQuery,
  setSearchQuery,
  placeholder,
  dropdownClosedWidth,
  icon,
}: {
  metricAttribute: string;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  placeholder: string;
  dropdownClosedWidth: number;
  icon: React.ReactNode;
}) => {
  return (
    <MetricTagValueSelect
      metricName="k8s.pod.cpu.utilization - Gauge"
      metricAttribute={metricAttribute}
      value={''}
      onChange={v => {
        if (v) {
          const newQuery = `${metricAttribute}:"${v}"${
            searchQuery.includes(metricAttribute) ? ' OR' : ''
          } ${searchQuery}`.trim();
          setSearchQuery(newQuery);
        }
      }}
      placeholder={placeholder}
      size="sm"
      dropdownClosedWidth={dropdownClosedWidth}
      dropdownOpenWidth={350}
      leftSection={icon}
    />
  );
};

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const CHART_HEIGHT = 300;

export default function KubernetesDashboardPage() {
  const [activeTab, setActiveTab] = useQueryParam(
    'tab',
    withDefault(StringParam, 'pods'),
    { updateType: 'replaceIn' },
  );

  const [searchQuery, setSearchQuery] = useQueryParam(
    'q',
    withDefault(StringParam, ''),
    { updateType: 'replaceIn' },
  );

  const {
    searchedTimeRange: dateRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
  } = useTimeQuery({
    isUTC: false,
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const whereClause = searchQuery;

  const [_searchQuery, _setSearchQuery] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const onSearchSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearchQuery(_searchQuery || null);
    },
    [_searchQuery, setSearchQuery],
  );
  return (
    <div>
      <Head>
        <title>Kubernetes Dashboard</title>
      </Head>
      <PodDetailsSidePanel />
      <NodeDetailsSidePanel />
      <NamespaceDetailsSidePanel />
      <div className="d-flex flex-column">
        <Group
          px="md"
          py="xs"
          className="border-bottom border-dark"
          gap="xs"
          align="center"
        >
          <K8sMetricTagValueSelect
            metricAttribute="k8s.pod.name"
            setSearchQuery={v => {
              setSearchQuery(v);
              _setSearchQuery(v);
            }}
            searchQuery={_searchQuery ?? searchQuery}
            placeholder="Pod"
            dropdownClosedWidth={100}
            icon={<i className="bi bi-box"></i>}
          />
          <K8sMetricTagValueSelect
            metricAttribute="k8s.deployment.name"
            setSearchQuery={v => {
              setSearchQuery(v);
              _setSearchQuery(v);
            }}
            searchQuery={_searchQuery ?? searchQuery}
            placeholder="Deployment"
            dropdownClosedWidth={155}
            icon={<i className="bi bi-arrow-clockwise"></i>}
          />
          <K8sMetricTagValueSelect
            metricAttribute="k8s.node.name"
            setSearchQuery={v => {
              setSearchQuery(v);
              _setSearchQuery(v);
            }}
            searchQuery={_searchQuery ?? searchQuery}
            placeholder="Node"
            dropdownClosedWidth={110}
            icon={<i className="bi bi-hdd-rack"></i>}
          />
          <K8sMetricTagValueSelect
            setSearchQuery={v => {
              setSearchQuery(v);
              _setSearchQuery(v);
            }}
            searchQuery={_searchQuery ?? searchQuery}
            metricAttribute="k8s.namespace.name"
            placeholder="Namespace"
            dropdownClosedWidth={150}
            icon={<i className="bi bi-braces"></i>}
          />
          <div style={{ flex: 1 }}>
            <form onSubmit={onSearchSubmit}>
              <HdxSearchInput
                inputRef={searchInputRef}
                placeholder="Scope dashboard to..."
                value={_searchQuery ?? searchQuery}
                onChange={v => _setSearchQuery(v)}
                onSearch={() => {}}
                showHotkey={false}
              />
            </form>
          </div>
          <form
            className="d-flex"
            style={{ width: 350, height: 36 }}
            onSubmit={e => {
              e.preventDefault();
              onSearch(displayedTimeInputValue);
            }}
          >
            <SearchTimeRangePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={range => {
                onSearch(range);
              }}
            />
          </form>
        </Group>
      </div>
      <Tabs
        color="gray"
        variant="pills"
        defaultValue="infrastructure"
        radius="md"
        keepMounted={false}
        value={activeTab}
        onChange={setActiveTab}
      >
        <div className="px-3 py-2 border-bottom border-dark">
          <Tabs.List>
            <Tabs.Tab value="pods">Pods</Tabs.Tab>
            <Tabs.Tab value="nodes">Nodes</Tabs.Tab>
            <Tabs.Tab value="namespaces">Namespaces</Tabs.Tab>
            {/* <Tabs.Tab value="clusters">Clusters</Tabs.Tab> */}
          </Tabs.List>
        </div>

        <div className="p-3">
          <Tabs.Panel value="pods">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.pod.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.pod.cpu.utilization - Gauge',
                            numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.pod.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.pod.memory.usage - Gauge',
                            numberFormat: K8S_MEM_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <InfraPodsStatusTable
                  dateRange={dateRange}
                  where={whereClause}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    <Flex justify="space-between">
                      Latest Kubernetes Warning Events
                      <Link
                        href={`/search?q=${encodeURIComponent(
                          `${
                            whereClause.trim().length > 0
                              ? `(${whereClause.trim()}) `
                              : ''
                          }(k8s.resource.name:"events" -level:"normal")`,
                        )}&from=${dateRange[0].getTime()}&to=${dateRange[1].getTime()}`}
                        passHref
                        legacyBehavior
                      >
                        <Anchor size="xs" color="dimmed">
                          Search <i className="bi bi-box-arrow-up-right"></i>
                        </Anchor>
                      </Link>
                    </Flex>
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <LogTableWithSidePanel
                      config={{
                        dateRange,
                        where: `${
                          whereClause.trim().length > 0
                            ? `(${whereClause.trim()}) `
                            : ''
                        }(k8s.resource.name:"events" -level:"normal")`,
                        columns: [
                          'object.regarding.kind',
                          'object.regarding.name',
                        ],
                      }}
                      columnNameMap={{
                        'object.regarding.kind': 'Kind',
                        'object.regarding.name': 'Name',
                      }}
                      isLive={false}
                      isUTC={false}
                      setIsUTC={() => {}}
                      onPropertySearchClick={() => {}}
                      showServiceColumn={false}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="nodes">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.node.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.node.cpu.utilization - Gauge',
                            numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.node.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.node.memory.usage - Gauge',
                            numberFormat: K8S_MEM_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <NodesTable dateRange={dateRange} where={whereClause} />
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="namespaces">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.namespace.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'sum',
                            field: 'k8s.pod.cpu.utilization - Gauge',
                            numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['k8s.namespace.name'],
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'sum',
                            field: 'k8s.pod.memory.usage - Gauge',
                            numberFormat: K8S_MEM_NUMBER_FORMAT,
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <NamespacesTable dateRange={dateRange} where={whereClause} />
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="clusters">Clusters</Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}

KubernetesDashboardPage.getLayout = withAppNav;
