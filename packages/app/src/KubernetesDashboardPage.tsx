import * as React from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import cx from 'classnames';
import sub from 'date-fns/sub';
import {
  parseAsFloat,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  SearchConditionLanguage,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Skeleton,
  Table,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';

import { TimePicker } from '@/components/TimePicker';

import { ConnectionSelectControlled } from './components/ConnectionSelect';
import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import { DBTimeChart } from './components/DBTimeChart';
import { FormatPodStatus } from './components/KubeComponents';
import { KubernetesFilters } from './components/KubernetesFilters';
import OnboardingModal from './components/OnboardingModal';
import { useQueriedChartConfig } from './hooks/useChartConfig';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import {
  convertDateRangeToGranularityString,
  convertV1ChartConfigToV2,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from './ChartUtils';
import { useConnections } from './connection';
import { withAppNav } from './layout';
import NamespaceDetailsSidePanel from './NamespaceDetailsSidePanel';
import NodeDetailsSidePanel from './NodeDetailsSidePanel';
import PodDetailsSidePanel from './PodDetailsSidePanel';
import { getEventBody, useSource, useSources } from './source';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { KubePhase } from './types';
import { formatNumber, formatUptime } from './utils';

import 'react-modern-drawer/dist/index.css';

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
  metricSource,
  where,
}: {
  dateRange: [Date, Date];
  metricSource: TSource;
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
  const { data, isError, isLoading } = useQueriedChartConfig(
    convertV1ChartConfigToV2(
      {
        series: [
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
            aggFn: undefined,
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
        ],
        dateRange,
        seriesReturnType: 'column',
      },
      {
        metric: metricSource,
      },
    ),
  );

  // TODO: Use useTable
  const podsList = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data
      .map((row: any) => {
        return {
          id: makeId(),
          name: row["arrayElement(ResourceAttributes, 'k8s.pod.name')"],
          namespace:
            row["arrayElement(ResourceAttributes, 'k8s.namespace.name')"],
          node: row["arrayElement(ResourceAttributes, 'k8s.node.name')"],
          restarts: row['last_value(k8s.container.restarts)'],
          uptime: row['undefined(k8s.pod.uptime)'],
          cpuAvg: row['avg(k8s.pod.cpu.utilization)'],
          cpuLimitUtilization: row['avg(k8s.pod.cpu_limit_utilization)'],
          memAvg: row['avg(k8s.pod.memory.usage)'],
          memLimitUtilization: row['avg(k8s.pod.memory_limit_utilization)'],
          phase: row['last_value(k8s.pod.phase)'],
        };
      })
      .filter(pod => {
        if (phaseFilter === 'all') {
          return true;
        }
        return pod.phase === getKubePhaseNumber(phaseFilter);
      });
  }, [data, phaseFilter]);

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
    <Card p="md" data-testid="k8s-pods-table">
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
                    Age
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
                      <Table.Td
                        data-testid={`k8s-pods-table-namespace-${pod.id}`}
                      >
                        {pod.namespace}
                      </Table.Td>
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
                          <Text
                            span
                            c={pod.cpuLimitUtilization ? undefined : 'gray.7'}
                          >
                            {pod.cpuLimitUtilization
                              ? formatNumber(
                                  pod.cpuLimitUtilization,
                                  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                                )
                              : '-'}
                          </Text>
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
                          <Text
                            span
                            c={pod.memLimitUtilization ? undefined : 'gray.7'}
                          >
                            {pod.memLimitUtilization
                              ? formatNumber(
                                  pod.memLimitUtilization,
                                  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                                )
                              : '-'}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Text span c={pod.uptime ? undefined : 'gray.7'}>
                          {pod.uptime ? formatUptime(pod.uptime) : '–'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          color={
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
  metricSource,
  where,
  dateRange,
}: {
  metricSource: TSource;
  where: string;
  dateRange: [Date, Date];
}) => {
  const groupBy = ['k8s.node.name'];

  const { data, isError, isLoading } = useQueriedChartConfig(
    convertV1ChartConfigToV2(
      {
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
            aggFn: undefined,
            where,
            groupBy,
          },
        ],
        dateRange,
        seriesReturnType: 'column',
      },
      {
        metric: metricSource,
      },
    ),
  );

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
        name: row["arrayElement(ResourceAttributes, 'k8s.node.name')"],
        cpuAvg: row['avg(k8s.node.cpu.utilization)'],
        memAvg: row['avg(k8s.node.memory.usage)'],
        ready: row['avg(k8s.node.condition_ready)'],
        uptime: row['undefined(k8s.node.uptime)'],
      };
    });
  }, [data]);

  return (
    <Card p="md" data-testid="k8s-nodes-table">
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
  dateRange,
  metricSource,
  where,
}: {
  dateRange: [Date, Date];
  metricSource: TSource;
  where: string;
}) => {
  const groupBy = ['k8s.namespace.name'];

  const { data, isError, isLoading } = useQueriedChartConfig(
    convertV1ChartConfigToV2(
      {
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
        dateRange: [
          // We should only look at the latest values, otherwise we might
          // aggregate pod metrics from pods that have been terminated
          sub(dateRange[1] ?? new Date(), { minutes: 5 }),
          dateRange[1] ?? new Date(),
        ],
        seriesReturnType: 'column',
      },
      {
        metric: metricSource,
      },
    ),
  );

  const namespacesList = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return data.data.map((row: any) => {
      return {
        name: row["arrayElement(ResourceAttributes, 'k8s.namespace.name')"],
        cpuAvg: row['sum(k8s.pod.cpu.utilization)'],
        memAvg: row['sum(k8s.pod.memory.usage)'],
        phase: row['last_value(k8s.namespace.phase)'],
      };
    });
  }, [data]);

  const getLink = React.useCallback((namespaceName: string) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('namespaceName', `${namespaceName}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  return (
    <Card p="md" data-testid="k8s-namespaces-table">
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

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const CHART_HEIGHT = 300;

function KubernetesDashboardPage() {
  const { data: connections } = useConnections();
  const [_connection, setConnection] = useQueryState('connection');

  const connection = _connection ?? connections?.[0]?.id ?? '';

  // TODO: Let users select log + metric sources
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const logSource = sources?.find(
    s => s.kind === SourceKind.Log && s.connection === connection,
  );
  const metricSource = sources?.find(
    s => s.kind === SourceKind.Metric && s.connection === connection,
  );

  const { control, watch } = useForm({
    values: {
      connection,
    },
  });

  watch((data, { name, type }) => {
    if (name === 'connection' && type === 'change') {
      setConnection(data.connection ?? null);
    }
  });

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
    onTimeRangeSelect,
  } = useTimeQuery({
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  // For future use if Live button is added
  const [isLive, setIsLive] = React.useState(false);

  const { manualRefreshCooloff, refresh } = useDashboardRefresh({
    searchedTimeRange: dateRange,
    onTimeRangeSelect,
    isLive,
  });

  const whereClause = searchQuery;

  const [_searchQuery, _setSearchQuery] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLTextAreaElement>(null);

  const onSearchSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearchQuery(_searchQuery || null);
    },
    [_searchQuery, setSearchQuery],
  );

  return (
    <Box data-testid="kubernetes-dashboard-page" p="sm">
      <OnboardingModal requireSource={false} />
      {metricSource && logSource && (
        <PodDetailsSidePanel
          logSource={logSource}
          metricSource={metricSource}
        />
      )}
      {metricSource && logSource && (
        <NodeDetailsSidePanel
          metricSource={metricSource}
          logSource={logSource}
        />
      )}
      {metricSource && logSource && (
        <NamespaceDetailsSidePanel
          metricSource={metricSource}
          logSource={logSource}
        />
      )}
      <Group justify="space-between">
        <Group>
          <Text c="gray.4" size="xl">
            Kubernetes Dashboard
          </Text>
          <ConnectionSelectControlled
            data-testid="kubernetes-connection-select"
            control={control}
            name="connection"
            size="xs"
          />
        </Group>

        <Group gap="xs">
          <form
            data-testid="kubernetes-time-form"
            onSubmit={e => {
              e.preventDefault();
              onSearch(displayedTimeInputValue);
              return false;
            }}
          >
            <TimePicker
              data-testid="kubernetes-time-picker"
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={onSearch}
            />
          </form>
          <Tooltip withArrow label="Refresh dashboard" fz="xs" color="gray">
            <Button
              onClick={refresh}
              loading={manualRefreshCooloff}
              disabled={manualRefreshCooloff}
              color="gray"
              variant="outline"
              title="Refresh dashboard"
              aria-label="Refresh dashboard"
              px="xs"
            >
              <i className="bi bi-arrow-clockwise fs-5"></i>
            </Button>
          </Tooltip>
        </Group>
      </Group>
      {metricSource && (
        <KubernetesFilters
          dateRange={dateRange}
          metricSource={metricSource}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
      )}

      <Tabs
        mt="md"
        keepMounted={false}
        defaultValue="pods"
        // @ts-ignore
        onChange={setActiveTab}
        value={activeTab}
      >
        <Tabs.List>
          <Tabs.Tab value="pods">Pods</Tabs.Tab>
          <Tabs.Tab value="nodes">Nodes</Tabs.Tab>
          <Tabs.Tab value="namespaces">Namespaces</Tabs.Tab>
          {/* <Tabs.Tab value="clusters">Clusters</Tabs.Tab> */}
        </Tabs.List>

        <div className="p-3">
          <Tabs.Panel value="pods">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md" data-testid="pod-cpu-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md" data-testid="pod-memory-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                {metricSource && (
                  <InfraPodsStatusTable
                    metricSource={metricSource}
                    dateRange={dateRange}
                    where={whereClause}
                  />
                )}
              </Grid.Col>
              <Grid.Col span={12}>
                <Card p="md" data-testid="k8s-warning-events-table">
                  <Card.Section p="md" py="xs" withBorder>
                    <Flex justify="space-between">
                      Latest Kubernetes Warning Events
                      {/* 
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
                      */}
                    </Flex>
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {logSource && (
                      <DBSqlRowTableWithSideBar
                        sourceId={logSource.id}
                        config={{
                          ...logSource,
                          where: `${
                            whereClause.trim().length > 0
                              ? `(${whereClause.trim()}) `
                              : ''
                          }(${logSource.eventAttributesExpression}.k8s.resource.name:"events" -Severity:"Normal")`,
                          whereLanguage: 'lucene',
                          select: [
                            {
                              valueExpression:
                                logSource.timestampValueExpression,
                              alias: 'Timestamp',
                            },
                            {
                              valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'type')`,
                              alias: 'Severity',
                            },
                            {
                              valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'regarding', 'kind')`,
                              alias: 'Kind',
                            },
                            {
                              valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'regarding', 'name')`,
                              alias: 'Name',
                            },
                            {
                              valueExpression: `JSONExtractString(${logSource.eventAttributesExpression}['object'], 'note')`,
                              alias: 'Message',
                            },
                          ],
                          orderBy: [
                            {
                              valueExpression:
                                logSource.timestampValueExpression,
                              ordering: 'DESC',
                            },
                          ],
                          limit: { limit: 200, offset: 0 },
                          dateRange,
                        }}
                        isLive={false}
                        queryKeyPrefix="k8s-dashboard-events"
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="nodes">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md" data-testid="nodes-cpu-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md" data-testid="nodes-memory-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                {metricSource && (
                  <NodesTable
                    metricSource={metricSource}
                    dateRange={dateRange}
                    where={whereClause}
                  />
                )}
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="namespaces">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md" data-testid="namespaces-cpu-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md" data-testid="namespaces-memory-usage-chart">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    {metricSource && (
                      <DBTimeChart
                        config={convertV1ChartConfigToV2(
                          {
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
                          },
                          {
                            log: logSource,
                            metric: metricSource,
                          },
                        )}
                        showDisplaySwitcher={false}
                      />
                    )}
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                {metricSource && (
                  <NamespacesTable
                    dateRange={dateRange}
                    metricSource={metricSource}
                    where={whereClause}
                  />
                )}
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="clusters">Clusters</Tabs.Panel>
        </div>
      </Tabs>
    </Box>
  );
}

const KubernetesDashboardPageDynamic = dynamic(
  async () => KubernetesDashboardPage,
  {
    ssr: false,
  },
);

// @ts-ignore
KubernetesDashboardPageDynamic.getLayout = withAppNav;

export default KubernetesDashboardPageDynamic;
