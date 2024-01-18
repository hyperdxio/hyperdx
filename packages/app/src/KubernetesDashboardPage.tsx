import * as React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Anchor,
  Card,
  Flex,
  Grid,
  Group,
  ScrollArea,
  Skeleton,
  Table,
  Tabs,
} from '@mantine/core';

import { FormatPodStatus } from './components/KubeComponents';
import api from './api';
import {
  convertDateRangeToGranularityString,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from './ChartUtils';
import HDXLineChart from './HDXLineChart';
import { withAppNav } from './layout';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import PodDetailsSidePanel from './PodDetailsSidePanel';
import HdxSearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { formatNumber } from './utils';

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
        aggFn: 'last_value',
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
        aggFn: 'last_value',
        where,
        groupBy: ['k8s.pod.name'],
        sortOrder: 'asc',
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
        <ScrollArea
          viewportProps={{
            style: { maxHeight: 300 },
          }}
        >
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
        </ScrollArea>
      </Card.Section>
    </Card>
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

  return (
    <div>
      <Head>
        <title>Kubernetes Dashboard</title>
      </Head>
      <PodDetailsSidePanel />
      <div className="d-flex flex-column">
        <Group
          px="md"
          py="xs"
          className="border-bottom border-dark"
          spacing="xs"
          align="center"
        >
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
        keepMounted={false}
        value={activeTab}
        onTabChange={setActiveTab}
      >
        <div className="px-3 py-2 border-bottom border-dark">
          <Tabs.List>
            <Tabs.Tab value="pods">Pods</Tabs.Tab>
            <Tabs.Tab value="nodes">Nodes</Tabs.Tab>
            <Tabs.Tab value="namespaces">Namespaces</Tabs.Tab>
            <Tabs.Tab value="clusters">Clusters</Tabs.Tab>
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
                    <Flex justify="space-between">
                      Latest Kubernetes Warning Events
                      <Link
                        href={`/search?q=${encodeURIComponent(
                          whereClause +
                            ' k8s.resource.name:"events" -level:"normal"',
                        )}`}
                        passHref
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
                        where:
                          whereClause +
                          ' k8s.resource.name:"events" -level:"normal"',
                        columns: ['k8s.pod.name'],
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
          <Tabs.Panel value="nodes">Nodes</Tabs.Panel>
          <Tabs.Panel value="namespaces">Namespaces</Tabs.Panel>
          <Tabs.Panel value="clusters">Clusters</Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}

KubernetesDashboardPage.getLayout = withAppNav;
