import * as React from 'react';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  Select,
  Skeleton,
  Table,
  Tabs,
  Text,
} from '@mantine/core';

import api from './api';
import AppNav from './AppNav';
import {
  convertDateRangeToGranularityString,
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
  SINGLE_DECIMAL_NUMBER_FORMAT,
} from './ChartUtils';
import DBQuerySidePanel from './DBQuerySidePanel';
import EndpointLatencyTile from './EndpointLatencyTile';
import EndpointSidepanel from './EndpointSidePanel';
import HDXLineChart from './HDXLineChart';
import HDXListBarChart from './HDXListBarChart';
import HDXMultiSeriesTableChart from './HDXMultiSeriesTableChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import PodDetailsSidePanel from './PodDetailsSidePanel';
import HdxSearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { ChartSeries } from './types';
import { formatNumber } from './utils';

const FormatPodStatus = ({ status }: { status?: number }) => {
  // based on
  // https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/k8sclusterreceiver/documentation.md#k8spodphase
  // Current phase of the pod (1 - Pending, 2 - Running, 3 - Succeeded, 4 - Failed, 5 - Unknown)
  switch (status) {
    case 1:
      return (
        <Badge color="yellow" fw="normal" tt="none" size="md">
          Pending
        </Badge>
      );
    case 2:
      return (
        <Badge color="green" fw="normal" tt="none" size="md">
          Running
        </Badge>
      );
    case 3:
      return (
        <Badge color="indigo" fw="normal" tt="none" size="md">
          Succeeded
        </Badge>
      );
    case 4:
      return (
        <Badge color="red" fw="normal" tt="none" size="md">
          Failed
        </Badge>
      );
    case 5:
      return (
        <Badge color="gray" fw="normal" tt="none" size="md">
          Unknown
        </Badge>
      );
    default:
      return (
        <Badge color="gray" fw="normal" tt="none" size="md">
          Unknown
        </Badge>
      );
  }
};

const InfraPodsStatusTable = ({
  dateRange,
  where,
}: {
  dateRange: [Date, Date];
  where: string;
}) => {
  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        table: 'metrics',
        field: 'k8s.container.restarts - Gauge',
        type: 'table',
        aggFn: 'max', // TODO
        where,
        groupBy: ['k8s.pod.name'],
      },
      {
        table: 'metrics',
        field: 'k8s.pod.uptime - Sum',
        type: 'table',
        aggFn: 'sum',
        where,
        groupBy: ['k8s.pod.name'],
      },
      {
        table: 'metrics',
        field: 'k8s.pod.cpu.utilization - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy: ['k8s.pod.name'],
      },
      {
        table: 'metrics',
        field: 'k8s.pod.memory.usage - Gauge',
        type: 'table',
        aggFn: 'avg',
        where,
        groupBy: ['k8s.pod.name'],
      },
      {
        table: 'metrics',
        field: 'k8s.pod.phase - Gauge',
        type: 'table',
        aggFn: 'max', // TODO latest
        where,
        groupBy: ['k8s.pod.name'],
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const getLink = (row: any) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('podName', `${row.group}`);
    return window.location.pathname + '?' + searchParams.toString();
  };

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        Pods
      </Card.Section>
      <Card.Section>
        {isError ? (
          <div className="p-4 text-center text-slate-500 fs-8">
            Unable to load pod metrics
          </div>
        ) : (
          <Table horizontalSpacing="md" highlightOnHover>
            <thead className="muted-thead">
              <tr>
                <th>Name</th>
                <th style={{ width: 100 }}>Restarts</th>
                {/* <th style={{ width: 120 }}>Age</th> */}
                <th style={{ width: 100 }}>CPU Avg</th>
                <th style={{ width: 100 }}>Mem Avg</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            {isLoading ? (
              <tbody>
                {Array.from({ length: 4 }).map((_, index) => (
                  <tr key={index}>
                    <td>
                      <Skeleton height={8} my={6} />
                    </td>
                    <td>
                      <Skeleton height={8} />
                    </td>
                    <td>
                      <Skeleton height={8} />
                    </td>
                    <td>
                      <Skeleton height={8} />
                    </td>
                    <td>
                      <Skeleton height={8} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ) : (
              <tbody>
                {data?.data?.map((row: any) => (
                  <Link key={row.group} href={getLink(row)}>
                    <tr className="cursor-pointer">
                      <td>{row.group}</td>
                      <td>{row['series_0.data']}</td>
                      {/* <td>{formatDistanceStrict(row['series_1.data'] * 1000, 0)}</td> */}
                      <td>
                        {formatNumber(
                          row['series_2.data'],
                          K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                        )}
                      </td>
                      <td>
                        {formatNumber(
                          row['series_3.data'],
                          K8S_MEM_NUMBER_FORMAT,
                        )}
                      </td>
                      <td>
                        <FormatPodStatus status={row['series_4.data']} />
                      </td>
                    </tr>
                  </Link>
                ))}
              </tbody>
            )}
          </Table>
        )}
      </Card.Section>
    </Card>
  );
};

const SearchInput = React.memo(
  ({
    searchQuery,
    setSearchQuery,
  }: {
    searchQuery: string;
    setSearchQuery: (q: string | null) => void;
  }) => {
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
    );
  },
);

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const CHART_HEIGHT = 300;
const DB_STATEMENT_PROPERTY = 'db.statement';

export default function ServiceDashboardPage() {
  const [searchQuery, setSearchQuery] = useQueryParam(
    'q',
    withDefault(StringParam, ''),
    { updateType: 'replaceIn' },
  );

  const [service, setService] = useQueryParam(
    'service',
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

  // Fetch services
  const { data: services, isLoading: isServicesLoading } = api.useServices();
  const servicesOptions = React.useMemo(() => {
    return Object.keys(services?.data ?? {}).map(name => ({
      value: name,
      label: name,
    }));
  }, [services]);

  const whereClause = React.useMemo(() => {
    const podNames: Set<string> = new Set();
    if (service) {
      services?.data[service]?.forEach(values => {
        if (values['k8s.pod.name']) {
          podNames.add(values['k8s.pod.name']);
        }
      });
    }
    // TODO: Rework this query to correctly work on prod
    return [
      [...podNames].map(podName => `k8s.pod.name:"${podName}"`).join(' OR ') ||
        'k8s.pod.name:*',
      searchQuery,
    ].join(' ');
  }, [searchQuery, service, services]);

  // Generate chart config
  const scopeWhereQuery = React.useCallback(
    (where: string) => {
      const serviceQuery = service ? `service:"${service}" ` : '';
      const sQuery = searchQuery ? `(${searchQuery}) ` : '';
      const whereQuery = where ? `(${where})` : '';
      return `${serviceQuery}${sQuery}${whereQuery}`;
    },
    [service, searchQuery],
  );

  return (
    <div>
      <Head>
        <title>Service Dashboard - HyperDX</title>
      </Head>
      <div className="d-flex">
        <AppNav fixed />
        <div className="w-100">
          <EndpointSidepanel />
          <DBQuerySidePanel />
          <PodDetailsSidePanel />
          <div className="d-flex flex-column">
            <Group
              px="md"
              py="xs"
              className="border-bottom border-dark"
              spacing="xs"
              align="center"
            >
              {/* Use Autocomplete instead? */}
              <Select
                searchable
                clearable
                allowDeselect
                placeholder="All Services"
                maxDropdownHeight={280}
                data={servicesOptions}
                disabled={isServicesLoading}
                radius="md"
                variant="filled"
                value={service}
                onChange={v => setService(v)}
                w={300}
              />
              <div style={{ flex: 1 }}>
                <SearchInput
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                />
              </div>
              <div className="d-flex" style={{ width: 350, height: 36 }}>
                <SearchTimeRangePicker
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={range => {
                    onSearch(range);
                  }}
                />
              </div>
            </Group>
          </div>
          <Tabs
            color="gray"
            variant="pills"
            defaultValue="infrastructure"
            radius="md"
          >
            <div className="px-3 py-2 border-bottom border-dark">
              <Tabs.List>
                <Tabs.Tab value="infrastructure">Infrastructure</Tabs.Tab>
                <Tabs.Tab value="http">HTTP Service</Tabs.Tab>
                <Tabs.Tab value="database">Database</Tabs.Tab>
              </Tabs.List>
            </div>

            <div className="p-3">
              <Tabs.Panel value="infrastructure">
                <Grid>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        CPU Usage
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXLineChart
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            groupBy: 'k8s.pod.name',
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.pod.cpu.utilization - Gauge',
                            numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
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
                        <HDXLineChart
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            groupBy: 'k8s.pod.name',
                            where: whereClause,
                            table: 'metrics',
                            aggFn: 'avg',
                            field: 'k8s.pod.memory.usage - Gauge',
                            numberFormat: K8S_MEM_NUMBER_FORMAT,
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
                        Latest Kubernetes Error Events
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <LogTableWithSidePanel
                          config={{
                            dateRange,
                            where: whereClause + ' level:error',
                          }}
                          isLive={false}
                          isUTC={false}
                          setIsUTC={() => {}}
                          onPropertySearchClick={() => {}}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                </Grid>
              </Tabs.Panel>
              <Tabs.Panel value="http">
                <Grid>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        Request Error Rate
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXMultiSeriesTimeChart
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Error Rate %',
                                table: 'logs',
                                type: 'time',
                                aggFn: 'count',
                                where: scopeWhereQuery(
                                  'span.kind:"server" level:"error"',
                                ),
                                groupBy: [],
                                numberFormat:
                                  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                              },
                              {
                                table: 'logs',
                                type: 'time',
                                aggFn: 'count',
                                field: '',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: [],
                                numberFormat:
                                  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                              },
                            ],
                            seriesReturnType: 'ratio',
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        Request Throughput
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXMultiSeriesTimeChart
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Requests',
                                table: 'logs',
                                type: 'time',
                                aggFn: 'count',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: [],
                                numberFormat: {
                                  ...INTEGER_NUMBER_FORMAT,
                                  unit: 'requests',
                                },
                              },
                            ],
                            seriesReturnType: 'column',
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        20 Top Most Time Consuming Endpoints
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXListBarChart
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Total',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'sum',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                sortOrder: 'desc',
                                visible: false,
                              },
                              {
                                displayName: 'Req/Min',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'count_per_min',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
                              },
                              {
                                displayName: 'P95',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'p95',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: {
                                  factor: 1,
                                  output: 'number',
                                  mantissa: 2,
                                  thousandSeparated: true,
                                  average: false,
                                  decimalBytes: false,
                                  unit: 'ms',
                                },
                              },
                              {
                                displayName: 'Median',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'p50',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: {
                                  factor: 1,
                                  output: 'number',
                                  mantissa: 2,
                                  thousandSeparated: true,
                                  average: false,
                                  decimalBytes: false,
                                  unit: 'ms',
                                },
                              },
                              {
                                displayName: 'Errors/Min',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'count_per_min',
                                field: '',
                                where: scopeWhereQuery(
                                  'span.kind:"server" level:"error"',
                                ),
                                groupBy: ['span_name'],
                                numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
                              },
                            ],
                          }}
                          getRowSearchLink={row => {
                            const searchParams = new URLSearchParams(
                              window.location.search,
                            );
                            searchParams.set('endpoint', `${row.group}`);
                            return (
                              window.location.pathname +
                              '?' +
                              searchParams.toString()
                            );
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <EndpointLatencyTile
                      dateRange={dateRange}
                      scopeWhereQuery={scopeWhereQuery}
                    />
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        Top 20 Most Time Consuming Endpoints
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXMultiSeriesTableChart
                          getRowSearchLink={row => {
                            const searchParams = new URLSearchParams(
                              window.location.search,
                            );
                            searchParams.set('endpoint', `${row.group}`);
                            return (
                              window.location.pathname +
                              '?' +
                              searchParams.toString()
                            );
                          }}
                          config={{
                            groupColumnName: 'Endpoint',
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Req/Min',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'count_per_min',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
                                columnWidthPercent: 12,
                              },
                              {
                                displayName: 'P95',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'p95',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: {
                                  factor: 1,
                                  output: 'number',
                                  mantissa: 2,
                                  thousandSeparated: true,
                                  average: false,
                                  decimalBytes: false,
                                  unit: 'ms',
                                },
                                columnWidthPercent: 12,
                              },
                              {
                                displayName: 'Median',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'p50',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                numberFormat: {
                                  factor: 1,
                                  output: 'number',
                                  mantissa: 2,
                                  thousandSeparated: true,
                                  average: false,
                                  decimalBytes: false,
                                  unit: 'ms',
                                },
                                columnWidthPercent: 12,
                              },
                              {
                                displayName: 'Total',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'sum',
                                field: 'duration',
                                where: scopeWhereQuery('span.kind:"server"'),
                                groupBy: ['span_name'],
                                sortOrder: 'desc',
                                columnWidthPercent: 12,
                                visible: false,
                              },
                              {
                                displayName: 'Errors/Min',
                                table: 'logs',
                                type: 'table',
                                aggFn: 'count_per_min',
                                field: '',
                                where: scopeWhereQuery(
                                  'span.kind:"server" level:"error"',
                                ),
                                groupBy: ['span_name'],
                                numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
                                columnWidthPercent: 12,
                              },
                            ],
                            seriesReturnType: 'column',
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                </Grid>
              </Tabs.Panel>
              <Tabs.Panel value="database">
                <Grid>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        Total Time Consumed per Query
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXMultiSeriesTimeChart
                          defaultDisplayType="stacked_bar"
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Total Query Time',
                                table: 'logs',
                                type: 'time',
                                aggFn: 'sum',
                                field: 'duration',
                                where: scopeWhereQuery(''),
                                groupBy: [DB_STATEMENT_PROPERTY],
                                numberFormat: MS_NUMBER_FORMAT,
                              },
                            ],
                            seriesReturnType: 'column',
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Card p="md">
                      <Card.Section p="md" py="xs" withBorder>
                        Throughput per Query
                      </Card.Section>
                      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                        <HDXMultiSeriesTimeChart
                          defaultDisplayType="stacked_bar"
                          config={{
                            dateRange,
                            granularity: convertDateRangeToGranularityString(
                              dateRange,
                              60,
                            ),
                            series: [
                              {
                                displayName: 'Total Query Count',
                                table: 'logs',
                                type: 'time',
                                aggFn: 'count',
                                where: scopeWhereQuery(''),
                                groupBy: [DB_STATEMENT_PROPERTY],
                                numberFormat: {
                                  ...INTEGER_NUMBER_FORMAT,
                                  unit: 'queries',
                                },
                              },
                            ],
                            seriesReturnType: 'column',
                          }}
                        />
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <DatabaseTimeConsumingQueryCard
                      dateRange={dateRange}
                      scopeWhereQuery={scopeWhereQuery}
                    />
                  </Grid.Col>
                </Grid>
              </Tabs.Panel>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function DatabaseTimeConsumingQueryCard({
  scopeWhereQuery,
  dateRange,
}: {
  dateRange: [Date, Date];
  scopeWhereQuery: (where: string) => string;
}) {
  const [chartType, setChartType] = useState<'table' | 'list'>('list');

  const series: ChartSeries[] = [
    {
      displayName: 'Queries/Min',
      table: 'logs',
      type: 'table',
      aggFn: 'count_per_min',
      where: scopeWhereQuery(''),
      groupBy: [DB_STATEMENT_PROPERTY],
      numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
      columnWidthPercent: 12,
    },
    {
      displayName: 'P95',
      table: 'logs',
      type: 'table',
      aggFn: 'p95',
      field: 'duration',
      where: scopeWhereQuery(''),
      groupBy: [DB_STATEMENT_PROPERTY],
      numberFormat: {
        factor: 1,
        output: 'number',
        mantissa: 2,
        thousandSeparated: true,
        average: false,
        decimalBytes: false,
        unit: 'ms',
      },
      columnWidthPercent: 12,
    },
    {
      displayName: 'Median',
      table: 'logs',
      type: 'table',
      aggFn: 'p50',
      field: 'duration',
      where: scopeWhereQuery(''),
      groupBy: [DB_STATEMENT_PROPERTY],
      numberFormat: {
        factor: 1,
        output: 'number',
        mantissa: 2,
        thousandSeparated: true,
        average: false,
        decimalBytes: false,
        unit: 'ms',
      },
      columnWidthPercent: 12,
    },
    {
      visible: false,
      displayName: 'Total',
      table: 'logs',
      type: 'table',
      aggFn: 'sum',
      field: 'duration',
      where: scopeWhereQuery(''),
      groupBy: [DB_STATEMENT_PROPERTY],
      sortOrder: 'desc',
      columnWidthPercent: 12,
    },
  ];

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Flex justify="space-between">
          <Text>Top 20 Most Time Consuming Queries</Text>
          <Box>
            <Button.Group>
              <Button
                variant="subtle"
                color={chartType === 'list' ? 'green' : 'dark.2'}
                size="xs"
                title="List"
                onClick={() => setChartType('list')}
              >
                <i className="bi bi-filter-left" />
              </Button>

              <Button
                variant="subtle"
                color={chartType === 'table' ? 'green' : 'dark.2'}
                size="xs"
                title="Table"
                onClick={() => setChartType('table')}
              >
                <i className="bi bi-table" />
              </Button>
            </Button.Group>
          </Box>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        {chartType === 'list' ? (
          <HDXListBarChart
            hoverCardPosition="top"
            config={{
              dateRange,
              granularity: convertDateRangeToGranularityString(dateRange, 60),
              series,
            }}
            getRowSearchLink={row => {
              const searchParams = new URLSearchParams(window.location.search);
              searchParams.set('db_query', `${row.group}`);
              return window.location.pathname + '?' + searchParams.toString();
            }}
          />
        ) : (
          <HDXMultiSeriesTableChart
            config={{
              groupColumnName: 'Normalized Query',
              dateRange,
              granularity: convertDateRangeToGranularityString(dateRange, 60),
              series,
              seriesReturnType: 'column',
            }}
            getRowSearchLink={row => {
              const searchParams = new URLSearchParams(window.location.search);
              searchParams.set('db_query', `${row.group}`);
              return window.location.pathname + '?' + searchParams.toString();
            }}
          />
        )}
      </Card.Section>
    </Card>
  );
}
