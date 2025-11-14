import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  parseAsFloat,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { sql } from '@codemirror/lang-sql';
import { format as formatSql } from '@hyperdx/common-utils/dist/sqlFormatter';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  BoxComponentProps,
  Button,
  Flex,
  Grid,
  Group,
  SegmentedControl,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import ReactCodeMirror from '@uiw/react-codemirror';

import { ConnectionSelectControlled } from '@/components/ConnectionSelect';
import { DBTimeChart } from '@/components/DBTimeChart';
import { TimePicker } from '@/components/TimePicker';
import { withAppNav } from '@/layout';

import { ChartBox } from './components/ChartBox';
import DBHeatmapChart from './components/DBHeatmapChart';
import { DBSqlRowTable } from './components/DBRowTable';
import DBTableChart from './components/DBTableChart';
import OnboardingModal from './components/OnboardingModal';
import { useDashboardRefresh } from './hooks/useDashboardRefresh';
import { useConnections } from './connection';
import { parseTimeQuery, useNewTimeQuery } from './timeQuery';

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const from = {
  databaseName: 'system',
  tableName: 'query_log',
};

function InfrastructureTab({
  searchedTimeRange,
  connection,
  onTimeRangeSelect,
}: {
  searchedTimeRange: [Date, Date];
  connection: string;
  onTimeRangeSelect: (start: Date, end: Date) => void;
}) {
  return (
    <Grid mt="md">
      <Grid.Col span={6}>
        <ChartBox style={{ minHeight: 400 }}>
          <Text size="sm" mb="sm">
            CPU Usage (Cores)
          </Text>
          <DBTimeChart
            config={{
              select: [
                {
                  valueExpression:
                    'avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000',
                  alias: `CPU Cores`,
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'metric_log',
              },
              where: '',
              connection,
              dateRange: searchedTimeRange,
              timestampValueExpression: 'event_time',
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ minHeight: 400 }}>
          <Text size="sm" mb="sm">
            Memory Usage
          </Text>
          <DBTimeChart
            config={{
              select: [
                {
                  valueExpression: 'avg(CurrentMetric_MemoryTracking)',
                  alias: `Bytes`,
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'metric_log',
              },
              where: '',
              connection,
              dateRange: searchedTimeRange,
              timestampValueExpression: 'event_time',
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ minHeight: 400 }}>
          <Text size="sm" mb="sm">
            Disk
          </Text>
          <DBTimeChart
            config={{
              select: [
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_OSReadChars',
                  alias: `Bytes Read`,
                },
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_OSWriteChars',
                  alias: `Bytes Written`,
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'metric_log',
              },
              where: '',
              connection,
              dateRange: searchedTimeRange,
              timestampValueExpression: 'event_time',
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ minHeight: 400 }}>
          <Text size="sm" mb="sm">
            S3 Requests
          </Text>
          <DBTimeChart
            config={{
              select: [
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'CurrentMetric_S3Requests',
                  alias: `All Requests`,
                },
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_S3GetObject',
                  alias: `GetObject Requests`,
                },
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_S3PutObject',
                  alias: `PutObject Requests`,
                },
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_S3ListObjects',
                  alias: `ListObjects Requests`,
                },
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'ProfileEvent_S3UploadPart',
                  alias: `UploadPart Requests`,
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'metric_log',
              },
              connection,
              where: '',
              dateRange: searchedTimeRange,
              timestampValueExpression: 'event_time',
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ minHeight: 400 }}>
          <Text size="sm" mb="xs">
            Network
          </Text>
          <Text size="xs" mb="sm">
            Network activity for the entire machine, not only Clickhouse.
          </Text>
          <DBTimeChart
            config={{
              select: [
                {
                  aggFn: 'avg',
                  aggCondition: '',
                  valueExpression: 'value',
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'asynchronous_metric_log',
              },
              where: `metric ILIKE 'NetworkReceiveBytes_%' OR metric ILIKE 'NetworkSendBytes_%'`,
              groupBy: [{ valueExpression: 'metric' }],
              connection,
              dateRange: searchedTimeRange,
              timestampValueExpression: 'event_time',
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

function InsertsTab({
  searchedTimeRange,
  connection,
  onTimeRangeSelect,
}: {
  searchedTimeRange: [Date, Date];
  connection: string;
  onTimeRangeSelect: (start: Date, end: Date) => void;
}) {
  const [insertsBy, setInsertsBy] = useQueryState(
    'insertsBy',
    parseAsStringEnum(['queries', 'rows', 'bytes']).withDefault('queries'),
  );
  return (
    <Grid mt="md">
      <Grid.Col span={12}>
        <ChartBox style={{ minHeight: 400 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">
              Insert{' '}
              {insertsBy === 'queries'
                ? 'Queries'
                : insertsBy === 'rows'
                  ? 'Rows'
                  : 'Bytes'}{' '}
              Per Table
            </Text>
            <SegmentedControl
              size="xs"
              value={insertsBy ?? 'queries'}
              onChange={value => {
                // @ts-ignore
                setInsertsBy(value);
              }}
              data={[
                { label: 'Queries', value: 'queries' },
                { label: 'Rows', value: 'rows' },
                { label: 'Bytes', value: 'bytes' },
              ]}
            />
          </Group>
          <DBTimeChart
            config={{
              select:
                insertsBy === 'queries'
                  ? [
                      {
                        aggFn: 'count' as const,
                        valueExpression: '',
                        aggCondition: '',
                        alias: 'Queries',
                      },
                    ]
                  : insertsBy === 'rows'
                    ? [
                        {
                          aggFn: 'sum' as const,
                          valueExpression: 'written_rows' as const,
                          aggCondition: '',
                          alias: 'Rows',
                        },
                      ]
                    : [
                        {
                          aggFn: 'sum' as const,
                          valueExpression: 'written_bytes' as const,
                          aggCondition: '',
                          alias: 'Bytes',
                        },
                      ],
              from,
              where: '',
              timestampValueExpression: 'event_time',
              dateRange: searchedTimeRange,
              filters: [
                {
                  type: 'sql_ast',
                  operator: '=',
                  left: 'query_kind',
                  right: `'Insert'`,
                },
              ],
              groupBy: [{ valueExpression: 'tables' }],
              connection,
            }}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox style={{ minHeight: 200, height: 200 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Max Active Parts per Partition</Text>
          </Group>
          <DBTimeChart
            config={{
              select: [
                {
                  aggFn: 'max' as const,
                  valueExpression: 'value',
                  aggCondition: `metric = 'MaxPartCountForPartition'`,
                  aggConditionLanguage: 'sql',
                  alias: 'Max Parts per Partition',
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'asynchronous_metric_log',
              },
              where: '',
              timestampValueExpression: 'event_time',
              dateRange: searchedTimeRange,
              connection,
            }}
            showDisplaySwitcher={false}
            showLegend={false}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox style={{ height: 400 }}>
          <Text size="sm" mb="sm">
            Active Parts Per Partition
          </Text>
          <Text size="xs" mb="md">
            Recommended to stay under 300, ClickHouse will automatically
            throttle inserts after 1,000 parts per partition and stop inserts at
            3,000 parts per partition.
          </Text>
          <DBTableChart
            config={{
              dateRange: searchedTimeRange,
              select: [
                {
                  aggFn: 'count',
                  valueExpression: '',
                  alias: 'Part Count',
                },
                {
                  aggFn: 'sum',
                  valueExpression: 'rows',
                  alias: 'Rows',
                },
                {
                  valueExpression: 'database',
                  alias: 'Database',
                },
                {
                  valueExpression: 'table',
                  alias: 'Table',
                },
                {
                  valueExpression: 'partition',
                  alias: 'Partition',
                },
              ],
              from: {
                databaseName: 'system',
                tableName: 'parts',
              },
              where: `active=1`,
              groupBy: [
                { valueExpression: 'database' },
                {
                  valueExpression: 'table',
                },
                {
                  valueExpression: 'partition',
                },
              ],
              connection,
              orderBy: [
                {
                  valueExpression: 'count()',
                  ordering: 'DESC',
                },
              ],
              limit: { limit: 100 },
              selectGroupBy: false,
            }}
          />
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

function ClickhousePage() {
  const { data: connections } = useConnections();
  const [_connection, setConnection] = useQueryState('connection');
  const [latencyFilter, setLatencyFilter] = useQueryStates({
    latencyMin: parseAsFloat,
    latencyMax: parseAsFloat,
  });
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum(['selects', 'inserts', 'infrastructure']).withDefault(
      'selects',
    ),
  );

  const connection = _connection ?? connections?.[0]?.id ?? '';

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
  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
    // showRelativeInterval: isLive,
  });

  // For future use if Live button is added
  const [isLive, setIsLive] = useState(false);

  const { manualRefreshCooloff, refresh } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive,
  });

  const filters = useMemo(() => {
    const { latencyMin, latencyMax } = latencyFilter;
    return [
      ...(latencyMax != null
        ? [
            {
              type: 'sql_ast' as const,
              operator: '<' as const,
              left: 'query_duration_ms',
              right: `${latencyMax}`,
            },
          ]
        : []),
      ...(latencyMin != null
        ? [
            {
              type: 'sql_ast' as const,
              operator: '>' as const,
              left: 'query_duration_ms',
              right: `${latencyMin}`,
            },
          ]
        : []),
    ];
  }, [latencyFilter]);

  return (
    <Box p="sm">
      <OnboardingModal requireSource={false} />
      <Group justify="space-between">
        <Group>
          <Text size="xl">Clickhouse Dashboard</Text>
          <ConnectionSelectControlled
            control={control}
            name="connection"
            size="xs"
          />
        </Group>
        <Group gap="xs">
          <form
            onSubmit={e => {
              e.preventDefault();
              onSearch(displayedTimeInputValue);
              return false;
            }}
          >
            <TimePicker
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
      <Tabs
        mt="md"
        keepMounted={false}
        defaultValue="selects"
        // @ts-ignore
        onChange={setTab}
        value={tab}
      >
        <Tabs.List>
          <Tabs.Tab value="selects">Select</Tabs.Tab>
          <Tabs.Tab value="inserts">Inserts</Tabs.Tab>
          {/* <Tabs.Tab value="merges">Merges / Mutations</Tabs.Tab> */}
          <Tabs.Tab value="infrastructure">Infrastructure</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="selects">
          <Grid mt="md">
            {/* <Grid.Col span={12}>
          <ChartBox style={{ minHeight: 300, height: 300 }}>
            <Group justify="space-between" align="center" mb="md">
              <Text size="sm"  ms="xs">
                Select P95 Query Latency
              </Text>
              <SegmentedControl
                size="xs"
                data={[
                  { label: 'Latency', value: 'latency' },
                  { label: 'Throughput', value: 'throughput' },
                  { label: 'Errors', value: 'errors' },
                ]}
              />
            </Group>
            <DBTimeChart
              config={{
                select: [
                  {
                    aggFn: 'quantile',
                    level: 0.95,
                    valueExpression: 'query_duration_ms',
                    aggCondition: '',
                    alias: `"Query P95 (ms)"`,
                  },
                ],
                displayType: DisplayType.Line,
                dateRange: searchedTimeRange,
                connection,
                timestampValueExpression: 'event_time',
                from,
                granularity: 'auto',
                where: `query_kind='Select' AND (
                  type='ExceptionWhileProcessing' OR type='QueryFinish' 
                )`,
                filters,
              }}
              onTimeRangeSelect={(start, end) => {
                onTimeRangeSelect(start, end);
              }}
            />
          </ChartBox>
        </Grid.Col> */}
            <Grid.Col span={12}>
              <ChartBox style={{ height: 250 }}>
                <Flex justify="space-between" align="center">
                  <Text size="sm" ms="xs">
                    Query Latency
                  </Text>
                  {latencyFilter.latencyMin != null ||
                  latencyFilter.latencyMax != null ? (
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => {
                        // Clears the min/max latency filters that are used to filter the query results
                        setLatencyFilter({
                          latencyMin: null,
                          latencyMax: null,
                        });
                        // Updates the URL state and triggers a new data fetch
                        onSearch(DEFAULT_INTERVAL);
                      }}
                    >
                      Reset
                    </Button>
                  ) : null}
                </Flex>
                <DBHeatmapChart
                  config={{
                    displayType: DisplayType.Heatmap,
                    select: [
                      {
                        aggFn: 'heatmap',
                        valueExpression: 'query_duration_ms',
                      },
                    ],
                    from,
                    dateRange: searchedTimeRange,
                    granularity: 'auto',
                    timestampValueExpression: 'event_time',
                    connection,
                    where: `query_kind='Select' AND (
                  type='ExceptionWhileProcessing' OR type='QueryFinish' 
                )`,
                    filters,
                  }}
                  onFilter={(tsStart, tsEnd, latencyMin, latencyMax) => {
                    onTimeRangeSelect(
                      new Date(tsStart * 1000),
                      new Date(tsEnd * 1000),
                    );
                    setLatencyFilter({
                      latencyMax,
                      latencyMin,
                    });
                  }}
                />
              </ChartBox>
            </Grid.Col>
            <Grid.Col span={12}>
              <ChartBox style={{ height: 400 }}>
                <Text size="sm" mb="md">
                  Query Count by Table
                </Text>

                <DBTimeChart
                  config={{
                    select: [
                      {
                        aggFn: 'count',
                        valueExpression: '',
                        aggCondition: '',
                        alias: `Query Count`,
                      },
                    ],
                    groupBy: [
                      { valueExpression: 'tables' },
                      {
                        valueExpression: 'type',
                      },
                    ],
                    selectGroupBy: true,
                    dateRange: searchedTimeRange,
                    connection,
                    timestampValueExpression: 'event_time',
                    from,
                    granularity: 'auto',
                    where: `query_kind='Select' AND (
                  type='ExceptionWhileProcessing' OR type='QueryFinish' 
                  OR type='ExceptionBeforeStart'
                )`,
                    filters,
                    limit: { limit: 1000 }, // TODO: Cut off more intelligently
                  }}
                  onTimeRangeSelect={(start, end) => {
                    onTimeRangeSelect(start, end);
                  }}
                />
              </ChartBox>
            </Grid.Col>
            <Grid.Col span={12}>
              <ChartBox style={{ height: 400 }}>
                <Text size="sm" mb="md">
                  Most Time Consuming Query Patterns
                </Text>
                <DBTableChart
                  config={{
                    select: [
                      {
                        aggFn: 'count',
                        valueExpression: '',
                        alias: `Count`,
                      },
                      {
                        aggFn: 'sum',
                        valueExpression: 'query_duration_ms',
                        alias: `Total Duration (ms)`,
                      },
                      {
                        aggFn: 'any',
                        valueExpression: 'query',
                        alias: `Query Example`,
                      },
                    ],
                    dateRange: searchedTimeRange,
                    from,
                    where: `(
                  type='ExceptionWhileProcessing' OR type='QueryFinish' 
                )`,
                    timestampValueExpression: 'event_time',
                    groupBy: [
                      { valueExpression: 'normalized_query_hash' },
                      {
                        valueExpression: 'tables',
                      },
                    ],
                    connection,
                    orderBy: [
                      {
                        valueExpression: 'sum(query_duration_ms)',
                        ordering: 'DESC',
                      },
                    ],
                    filters: [
                      ...filters,
                      {
                        type: 'sql_ast',
                        operator: '=',
                        left: 'query_kind',
                        right: `'Select'`,
                      },
                    ],
                    selectGroupBy: false,
                    limit: { limit: 20 },
                  }}
                />
              </ChartBox>
            </Grid.Col>
            <Grid.Col span={12}>
              <ChartBox style={{ height: 400 }}>
                <Text size="sm" mb="md">
                  Slowest Queries
                </Text>
                <DBSqlRowTable
                  renderRowDetails={row => {
                    return (
                      <ReactCodeMirror
                        extensions={[sql()]}
                        editable={false}
                        value={formatSql(row.query)}
                        theme="dark"
                        lang="sql"
                        maxHeight="200px"
                      />
                    );
                  }}
                  config={{
                    select: `event_time, query_kind, 
                read_rows,
                formatReadableSize(memory_usage) as memory_usage,
                query_duration_ms, 
                query`,
                    dateRange: searchedTimeRange,
                    from,
                    where: `(
                  type='ExceptionWhileProcessing' OR type='QueryFinish' 
                )`,
                    timestampValueExpression: 'event_time',
                    connection,
                    orderBy: [
                      {
                        valueExpression: 'query_duration_ms',
                        ordering: 'DESC',
                      },
                    ],
                    filters: [
                      ...filters,
                      {
                        type: 'sql_ast',
                        operator: '=',
                        left: 'query_kind',
                        right: `'Select'`,
                      },
                    ],
                    limit: { limit: 100 },
                  }}
                />
              </ChartBox>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
        <Tabs.Panel value="inserts">
          <InsertsTab
            searchedTimeRange={searchedTimeRange}
            connection={connection}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </Tabs.Panel>
        <Tabs.Panel value="infrastructure">
          <InfrastructureTab
            searchedTimeRange={searchedTimeRange}
            connection={connection}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
const ClickhousePageDynamic = dynamic(async () => ClickhousePage, {
  ssr: false,
});

// @ts-ignore
ClickhousePageDynamic.getLayout = withAppNav;

export default ClickhousePageDynamic;
