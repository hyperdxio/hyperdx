import * as React from 'react';
import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Anchor,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Group,
  SegmentedControl,
  Select,
  Tabs,
  Text,
} from '@mantine/core';

import api from './api';
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
import HDXListBarChart from './HDXListBarChart';
import HDXMultiSeriesTableChart from './HDXMultiSeriesTableChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import { InfraPodsStatusTable } from './KubernetesDashboardPage';
import { withAppNav } from './layout';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import { MemoPatternTableWithSidePanel } from './PatternTableWithSidePanel';
import PodDetailsSidePanel from './PodDetailsSidePanel';
import HdxSearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { ChartSeries } from './types';

export const SearchInput = React.memo(
  ({
    searchQuery,
    setSearchQuery,
    placeholder = 'Scope dashboard to...',
  }: {
    searchQuery: string;
    setSearchQuery: (q: string | null) => void;
    placeholder?: string;
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
          placeholder={placeholder}
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
const DB_STATEMENT_PROPERTY = 'db.normalized_statement';

export default function ServiceDashboardPage() {
  const [activeTab, setActiveTab] = useQueryParam(
    'tab',
    withDefault(StringParam, 'http'),
    { updateType: 'replaceIn' },
  );

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

  const podNames = React.useMemo(() => {
    const podNames: Set<string> = new Set();
    if (service) {
      services?.data[service]?.forEach(values => {
        if (values['k8s.pod.name']) {
          podNames.add(values['k8s.pod.name']);
        }
      });
    }
    return [...podNames];
  }, [service, services]);

  const whereClause = React.useMemo(() => {
    // TODO: Rework this query to correctly work on prod
    return [
      podNames.map(podName => `k8s.pod.name:"${podName}"`).join(' OR ') ||
        'k8s.pod.name:*',
      searchQuery,
    ].join(' ');
  }, [podNames, searchQuery]);

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

  // hack to fix when page shows all services even though service is selected
  if (isServicesLoading && service) {
    return (
      <div className="text-center text-slate-400 m-5">Loading services...</div>
    );
  }

  return (
    <div>
      <Head>
        <title>Service Dashboard - HyperDX</title>
      </Head>
      <EndpointSidepanel />
      <DBQuerySidePanel />
      <PodDetailsSidePanel />
      <div className="d-flex flex-column">
        <Group
          px="md"
          py="xs"
          className="border-bottom border-dark"
          gap="xs"
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
        defaultValue="http"
        radius="md"
        keepMounted={false}
        value={activeTab}
        onChange={setActiveTab}
      >
        <div className="px-3 py-2 border-bottom border-dark">
          <Tabs.List>
            <Tabs.Tab value="http">HTTP Service</Tabs.Tab>
            <Tabs.Tab value="database">Database</Tabs.Tab>
            <Tabs.Tab value="infrastructure">Infrastructure</Tabs.Tab>
            <Tabs.Tab value="errors">Errors</Tabs.Tab>
          </Tabs.List>
        </div>

        <div className="p-3">
          <Tabs.Panel value="infrastructure">
            <Grid>
              {service && !podNames.length ? (
                <>
                  <Grid.Col span={12}>
                    <Card p="xl" ta="center">
                      <Card.Section p="md" py="xs" withBorder>
                        <div className="fs-8">
                          <i className="bi bi-exclamation-circle-fill text-slate-400 fs-8 me-2" />
                          No pods found for service{' '}
                          <span className="text-white">{service}</span>
                        </div>
                      </Card.Section>
                    </Card>
                  </Grid.Col>
                </>
              ) : null}
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
                      hiddenColumns={['service']}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
          <Tabs.Panel value="http">
            <Grid>
              <Grid.Col span={6}>
                <RequestErrorRateCard
                  dateRange={dateRange}
                  scopeWhereQuery={scopeWhereQuery}
                />
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
                <EndpointTableCard
                  dateRange={dateRange}
                  scopeWhereQuery={scopeWhereQuery}
                />
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
          <Tabs.Panel value="errors">
            <Grid>
              <Grid.Col span={12}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Error Events per Service
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
                        seriesReturnType: 'column',
                        series: [
                          {
                            type: 'time',
                            groupBy: ['service'],
                            where: scopeWhereQuery('level:"error"'),
                            table: 'logs',
                            aggFn: 'count',
                          },
                        ],
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Error Patterns
                  </Card.Section>
                  <Card.Section p="md" py="sm">
                    <MemoPatternTableWithSidePanel
                      isUTC={false}
                      config={{
                        where: scopeWhereQuery('level:"error"'),
                        dateRange,
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}

function EndpointTableCard({
  scopeWhereQuery,
  dateRange,
}: {
  dateRange: [Date, Date];
  scopeWhereQuery: (where: string) => string;
}) {
  const [chartType, setChartType] = useState<'time' | 'error'>('time');

  return (
    <Card p="md">
      <Card.Section p="md" py={5} withBorder>
        <Flex justify="space-between" align="center">
          Top 20{' '}
          {chartType === 'time' ? 'Most Time Consuming' : 'Highest Error Rate'}{' '}
          Endpoints
          <SegmentedControl
            size="xs"
            value={chartType}
            onChange={(value: string) => {
              if (value === 'time' || value === 'error') {
                setChartType(value);
              }
            }}
            data={[
              { label: 'Sort by Time', value: 'time' },
              { label: 'Sort by Errors', value: 'error' },
            ]}
          />
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <HDXMultiSeriesTableChart
          getRowSearchLink={row => {
            const searchParams = new URLSearchParams(window.location.search);
            searchParams.set('endpoint', `${row.group}`);
            return window.location.pathname + '?' + searchParams.toString();
          }}
          config={{
            groupColumnName: 'Endpoint',
            dateRange,
            granularity: convertDateRangeToGranularityString(dateRange, 60),
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
                columnWidthPercent: 12,
                visible: false,
                ...(chartType === 'time'
                  ? {
                      sortOrder: 'desc',
                    }
                  : {}),
              },
              {
                displayName: 'Errors/Min',
                table: 'logs',
                type: 'table',
                aggFn: 'count_per_min',
                field: '',
                where: scopeWhereQuery('span.kind:"server" level:"error"'),
                groupBy: ['span_name'],
                numberFormat: SINGLE_DECIMAL_NUMBER_FORMAT,
                columnWidthPercent: 12,
                ...(chartType === 'error'
                  ? {
                      sortOrder: 'desc',
                    }
                  : {}),
              },
            ],
            seriesReturnType: 'column',
          }}
        />
      </Card.Section>
    </Card>
  );
}

function RequestErrorRateCard({
  scopeWhereQuery,
  dateRange,
}: {
  dateRange: [Date, Date];
  scopeWhereQuery: (where: string) => string;
}) {
  const [chartType, setChartType] = useState<'overall' | 'grouped_by_endpoint'>(
    'overall',
  );

  return (
    <Card p="md">
      <Card.Section p="md" py={5} withBorder>
        <Flex justify="space-between" align="center">
          Request Error Rate
          <SegmentedControl
            size="xs"
            value={chartType}
            onChange={(value: string) => {
              if (value === 'overall' || value === 'grouped_by_endpoint') {
                setChartType(value);
              }
            }}
            data={[
              { label: 'Overall', value: 'overall' },
              { label: 'By Endpoint', value: 'grouped_by_endpoint' },
            ]}
          />
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <HDXMultiSeriesTimeChart
          key={chartType}
          defaultDisplayType={chartType === 'overall' ? 'line' : 'stacked_bar'}
          config={{
            dateRange,
            granularity: convertDateRangeToGranularityString(dateRange, 60),
            series: [
              {
                displayName: 'Error Rate %',
                table: 'logs',
                type: 'time',
                aggFn: 'count',
                where: scopeWhereQuery('span.kind:"server" level:"error"'),
                groupBy: chartType === 'overall' ? [] : ['span_name'],
                numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
              },
              {
                table: 'logs',
                type: 'time',
                aggFn: 'count',
                field: '',
                where: scopeWhereQuery('span.kind:"server"'),
                groupBy: chartType === 'overall' ? [] : ['span_name'],
                numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
              },
            ],
            seriesReturnType: 'ratio',
          }}
        />
      </Card.Section>
    </Card>
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
  ];

  return (
    <Card p="md">
      <Card.Section p="md" py={5} withBorder>
        <Flex justify="space-between" align="center">
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

ServiceDashboardPage.getLayout = withAppNav;
