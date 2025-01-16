import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { UseControllerProps, useForm } from 'react-hook-form';
import { Filter } from '@hyperdx/common-utils/dist/renderChartConfig';
import { DisplayType, TSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Tabs,
  Text,
} from '@mantine/core';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import DBHistogramChart from '@/components/DBHistogramChart';
import DBListBarChart from '@/components/DBListBarChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import OnboardingModal from '@/components/OnboardingModal';
import SelectControlled from '@/components/SelectControlled';
import ServiceDashboardDbQuerySidePanel from '@/components/ServiceDashboardDbQuerySidePanel';
import ServiceDashboardEndpointSidePanel from '@/components/ServiceDashboardEndpointSidePanel';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { withAppNav } from '@/layout';
import SearchInputV2 from '@/SearchInputV2';
import { getExpressions } from '@/serviceDashboard';
import { useSource, useSources } from '@/source';
import { Histogram } from '@/SVGIcons';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

type AppliedConfig = {
  source?: string | null;
  service?: string | null;
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
};

function getScopedFilters(
  source: TSource,
  appliedConfig: AppliedConfig,
  includeIsSpanKindServer = true,
): Filter[] {
  const expressions = getExpressions(source);
  const filters: Filter[] = [];
  // Database spans are of kind Client. To be cleaned up in HDX-1219
  if (includeIsSpanKindServer) {
    filters.push({
      type: 'sql',
      condition: expressions.isSpanKindServer,
    });
  }
  if (appliedConfig.service) {
    filters.push({
      type: 'sql',
      condition: `${expressions.service} IN ('${appliedConfig.service}')`,
    });
  }
  return filters;
}

function ServiceSelectControlled({
  sourceId,
  onCreate,
  ...props
}: {
  sourceId?: string;
  size?: string;
  onCreate?: () => void;
} & UseControllerProps<any>) {
  const { data: source } = useSource({ id: sourceId });
  const expressions = getExpressions(source);

  const queriedConfig = {
    ...source,
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      {
        alias: 'service',
        valueExpression: `distinct(${expressions.service})`,
      },
    ],
    where: `${expressions.service} IS NOT NULL`,
    whereLanguage: 'sql' as const,
    limit: { limit: 200 },
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['service-select', queriedConfig],
    enabled: !!source,
  });

  const values = useMemo(() => {
    const services =
      data?.data?.map((d: any) => d.service).filter(Boolean) || [];
    return [
      {
        value: '',
        label: 'All Services',
      },
      ...services,
    ];
  }, [data]);

  return (
    <SelectControlled
      {...props}
      data={values}
      disabled={isLoading || isError}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="All Services"
      maxDropdownHeight={280}
      onCreate={onCreate}
    />
  );
}

export function EndpointLatencyChart({
  source,
  dateRange,
  appliedConfig = {},
  extraFilters = [],
}: {
  source: TSource;
  dateRange: [Date, Date];
  appliedConfig?: AppliedConfig;
  extraFilters?: Filter[];
}) {
  const expressions = getExpressions(source);
  const [latencyChartType, setLatencyChartType] = useState<
    'line' | 'histogram'
  >('line');

  return (
    <ChartBox style={{ height: 350 }}>
      <Group justify="space-between" align="center" mb="sm">
        <Text size="sm" c="gray.4">
          Request Latency
        </Text>
        <Box>
          <Button.Group>
            <Button
              variant="subtle"
              color={latencyChartType === 'line' ? 'green' : 'dark.2'}
              size="xs"
              title="Line Chart"
              onClick={() => setLatencyChartType('line')}
            >
              <i className="bi bi-graph-up" />
            </Button>

            <Button
              variant="subtle"
              color={latencyChartType === 'histogram' ? 'green' : 'dark.2'}
              size="xs"
              title="Histogram"
              onClick={() => setLatencyChartType('histogram')}
            >
              <Histogram width={12} color="currentColor" />
            </Button>
          </Button.Group>
        </Box>
      </Group>
      {source &&
        (latencyChartType === 'line' ? (
          <DBTimeChart
            showDisplaySwitcher={false}
            sourceId={source.id}
            config={{
              ...source,
              where: appliedConfig.where || '',
              whereLanguage: appliedConfig.whereLanguage || 'sql',
              select: [
                {
                  alias: '95th Percentile',
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: expressions.durationInMillis,
                  aggCondition: '',
                },
                {
                  alias: 'Median',
                  aggFn: 'quantile',
                  level: 0.5,
                  valueExpression: expressions.durationInMillis,
                  aggCondition: '',
                },
                {
                  alias: 'Avg',
                  aggFn: 'avg',
                  valueExpression: expressions.durationInMillis,
                  aggCondition: '',
                },
              ],
              filters: [
                ...extraFilters,
                ...getScopedFilters(source, appliedConfig),
              ],
              numberFormat: MS_NUMBER_FORMAT,
              dateRange,
            }}
          />
        ) : (
          <DBHistogramChart
            config={{
              ...source,
              where: appliedConfig.where || '',
              whereLanguage: appliedConfig.whereLanguage || 'sql',
              select: [
                {
                  alias: 'data',
                  valueExpression: `histogram(20)(${expressions.durationInMillis})`,
                },
              ],
              filters: [
                ...extraFilters,
                ...getScopedFilters(source, appliedConfig),
              ],
              dateRange,
            }}
          />
        ))}
    </ChartBox>
  );
}

function HttpTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const expressions = getExpressions(source);

  const [reqChartType, setReqChartType] = useQueryState(
    'reqChartType',
    parseAsStringEnum<string>(['overall', 'endpoint']).withDefault('overall'),
  );

  const [topEndpointsChartType, setTopEndpointsChartType] = useState<
    'time' | 'error'
  >('time');

  const startTime = searchedTimeRange[0].getTime();
  const endTime = searchedTimeRange[1].getTime();

  const getRowSearchLink = useCallback((row: any) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('endpoint', `${row['Endpoint']}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Request Error Rate
            </Text>
            <SegmentedControl
              size="xs"
              value={reqChartType}
              onChange={setReqChartType}
              data={[
                { label: 'Overall', value: 'overall' },
                { label: 'By Endpoint', value: 'endpoint' },
              ]}
            />
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType:
                  reqChartType === 'overall'
                    ? DisplayType.Line
                    : DisplayType.StackedBar,
                select: [
                  {
                    valueExpression: `countIf(${expressions.isError}) / count()`,
                    alias: 'Error Rate %',
                  },
                ],
                numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                filters: [
                  {
                    type: 'sql',
                    condition: `${expressions.httpScheme} = 'http'`,
                  },
                  ...getScopedFilters(source, appliedConfig),
                ],
                groupBy:
                  reqChartType === 'overall'
                    ? undefined
                    : source.spanNameExpression || expressions.spanName,
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Request Throughput
            </Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType:
                  reqChartType === 'overall'
                    ? DisplayType.Line
                    : DisplayType.StackedBar,
                select: [
                  {
                    aggFn: 'count' as const,
                    valueExpression: 'value',
                    alias: 'Requests',
                    aggCondition: '',
                    aggConditionLanguage: 'sql',
                  },
                ],
                numberFormat: { ...INTEGER_NUMBER_FORMAT, unit: 'requests' },
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              20 Top Most Time Consuming Endpoints
            </Text>
          </Group>

          {source && (
            <DBListBarChart
              groupColumn="Endpoint"
              valueColumn="Total (ms)"
              getRowSearchLink={getRowSearchLink}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Endpoint',
                    valueExpression:
                      source.spanNameExpression || expressions.spanName,
                  },
                  {
                    alias: 'Total (ms)',
                    aggFn: 'sum',
                    valueExpression: expressions.durationInMillis,
                    aggCondition: '',
                  },
                  {
                    alias: 'Req/Min',
                    valueExpression: `
                      count() /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000}))`,
                  },
                  {
                    alias: 'P95 (ms)',
                    aggFn: 'quantile',
                    valueExpression: expressions.durationInMillis,
                    aggCondition: '',
                    level: 0.5,
                  },
                  {
                    alias: 'Median (ms)',
                    aggFn: 'quantile',
                    valueExpression: expressions.durationInMillis,
                    aggCondition: '',
                    level: 0.95,
                  },

                  {
                    alias: 'Errors/Min',
                    valueExpression: `countIf(${expressions.isError}) /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000}))`,
                  },
                ],
                selectGroupBy: false,
                groupBy: source.spanNameExpression || expressions.spanName,
                orderBy: '"Total (ms)" DESC',
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: MS_NUMBER_FORMAT,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        {source && (
          <EndpointLatencyChart
            appliedConfig={appliedConfig}
            dateRange={searchedTimeRange}
            source={source}
          />
        )}
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Top 20{' '}
              {topEndpointsChartType === 'time'
                ? 'Most Time Consuming'
                : 'Highest Error Rate'}
            </Text>
            <SegmentedControl
              size="xs"
              value={topEndpointsChartType}
              onChange={(value: string) => {
                if (value === 'time' || value === 'error') {
                  setTopEndpointsChartType(value);
                }
              }}
              data={[
                { label: 'Sort by Time', value: 'time' },
                { label: 'Sort by Errors', value: 'error' },
              ]}
            />
          </Group>
          {source && (
            <DBTableChart
              getRowSearchLink={getRowSearchLink}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Endpoint',
                    valueExpression:
                      source.spanNameExpression || expressions.spanName,
                  },
                  {
                    alias: 'Req/Min',
                    valueExpression: `round(count() /
                        age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000})), 1)`,
                  },
                  {
                    alias: 'P95 (ms)',
                    valueExpression: `round(quantile(0.95)(${expressions.durationInMillis}), 2)`,
                  },
                  {
                    alias: 'Median (ms)',
                    valueExpression: `round(quantile(0.5)(${expressions.durationInMillis}), 2)`,
                  },
                  {
                    alias: 'Total (ms)',
                    valueExpression: `round(sum(${expressions.durationInMillis}), 2)`,
                  },
                  {
                    alias: 'Errors/Min',
                    valueExpression: `round(countIf(${expressions.isError}) /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000})), 1)`,
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                selectGroupBy: false,
                groupBy: source.spanNameExpression || expressions.spanName,
                dateRange: searchedTimeRange,
                orderBy:
                  topEndpointsChartType === 'time'
                    ? '"Total (ms)" DESC'
                    : '"Errors/Min" DESC',
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// Database Tab
function DatabaseTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const expressions = getExpressions(source);

  const [chartType, setChartType] = useState<'table' | 'list'>('list');

  const getRowSearchLink = useCallback((row: any) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('dbquery', `${row['Statement']}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Total Time Consumed per Query
            </Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                displayType: DisplayType.StackedBar,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Total Query Time',
                    aggFn: 'sum',
                    valueExpression: expressions.durationInMillis,
                    aggCondition: '',
                  },
                ],
                filters: [
                  ...getScopedFilters(source, appliedConfig, false),
                  { type: 'sql', condition: expressions.isDbSpan },
                ],
                numberFormat: MS_NUMBER_FORMAT,
                groupBy: expressions.dbStatement,
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Throughput per Query
            </Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                displayType: DisplayType.StackedBar,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Total Query Count',
                    aggFn: 'count',
                    valueExpression: expressions.durationInMillis,
                    aggCondition: '',
                  },
                ],
                filters: [
                  ...getScopedFilters(source, appliedConfig, false),
                  { type: 'sql', condition: expressions.isDbSpan },
                ],
                numberFormat: {
                  ...INTEGER_NUMBER_FORMAT,
                  unit: 'queries',
                },
                groupBy: expressions.dbStatement,
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Top 20 Most Time Consuming Queries
            </Text>
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
          </Group>
          {source &&
            (chartType === 'list' ? (
              <DBListBarChart
                groupColumn="Statement"
                valueColumn="Total"
                hoverCardPosition="top-start"
                getRowSearchLink={getRowSearchLink}
                config={{
                  ...source,
                  where: appliedConfig.where || '',
                  whereLanguage: appliedConfig.whereLanguage || 'sql',
                  dateRange: searchedTimeRange,
                  groupBy: expressions.dbStatement,
                  selectGroupBy: false,
                  orderBy: '"Total" DESC',
                  select: [
                    {
                      alias: 'Statement',
                      valueExpression: expressions.dbStatement,
                    },
                    {
                      alias: 'Total',
                      aggFn: 'sum',
                      aggCondition: '',
                      valueExpression: expressions.durationInMillis,
                    },
                    {
                      alias: 'Queries/Min',
                      aggFn: 'count',
                      valueExpression: `value / age('mi', toDateTime(${searchedTimeRange[0].getTime() / 1000}), toDateTime(${searchedTimeRange[1].getTime() / 1000}))`,
                      aggCondition: '',
                    },
                    {
                      alias: 'P95 (ms)',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.5,
                    },
                    {
                      alias: 'Median (ms)',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.95,
                    },
                    {
                      alias: 'Median',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.5,
                    },
                  ],
                  filters: [
                    ...getScopedFilters(source, appliedConfig, false),
                    { type: 'sql', condition: expressions.isDbSpan },
                  ],
                }}
              />
            ) : (
              <DBTableChart
                getRowSearchLink={getRowSearchLink}
                config={{
                  ...source,
                  where: appliedConfig.where || '',
                  whereLanguage: appliedConfig.whereLanguage || 'sql',
                  dateRange: searchedTimeRange,
                  groupBy: expressions.dbStatement,
                  orderBy: '"Total" DESC',
                  selectGroupBy: false,
                  select: [
                    {
                      alias: 'Statement',
                      valueExpression: expressions.dbStatement,
                    },
                    {
                      alias: 'Total',
                      aggFn: 'sum',
                      aggCondition: '',
                      valueExpression: expressions.durationInMillis,
                    },
                    {
                      alias: 'Queries/Min',
                      aggFn: 'count',
                      valueExpression: `value / age('mi', toDateTime(${searchedTimeRange[0].getTime() / 1000}), toDateTime(${searchedTimeRange[1].getTime() / 1000}))`,
                      aggCondition: '',
                    },
                    {
                      alias: 'P95 (ms)',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.5,
                    },
                    {
                      alias: 'Median (ms)',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.95,
                    },
                    {
                      alias: 'Median',
                      aggFn: 'quantile',
                      valueExpression: expressions.durationInMillis,
                      aggCondition: '',
                      level: 0.5,
                    },
                  ],
                  filters: [
                    ...getScopedFilters(source, appliedConfig, false),
                    { type: 'sql', condition: expressions.isDbSpan },
                  ],
                }}
              />
            ))}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// Errors Tab
function ErrorsTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const expressions = getExpressions(source);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm" c="gray.4">
              Error Events per Service
            </Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType: DisplayType.StackedBar,
                select: [
                  {
                    valueExpression: `count()`,
                  },
                ],
                numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                filters: [
                  {
                    type: 'sql',
                    condition: expressions.isError,
                  },
                  ...getScopedFilters(source, appliedConfig),
                ],
                groupBy: source.serviceNameExpression || expressions.service,
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const appliedConfigMap = {
  source: parseAsString,
  where: parseAsString,
  service: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};

function ServicesDashboardPage() {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<string>(['http', 'database', 'errors']).withDefault(
      'http',
    ),
  );

  const { data: sources } = useSources();

  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);
  const { control, watch, setValue, handleSubmit } = useForm({
    values: {
      where: '',
      whereLanguage: 'sql' as 'sql' | 'lucene',
      service: appliedConfig?.service || '',
      source: appliedConfig?.source || sources?.[0]?.id,
    },
  });

  const service = watch('service');
  const sourceId = watch('source');
  const { data: source } = useSource({
    id: watch('source'),
  });

  useEffect(() => {
    if (sourceId && !appliedConfig.source) {
      setAppliedConfig({ source: sourceId });
    }
  }, [appliedConfig.source, setAppliedConfig, sourceId]);

  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      setAppliedConfig(values);
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Auto submit when service or source changes
  useEffect(() => {
    if (
      service !== appliedConfig.service ||
      sourceId !== appliedConfig.source
    ) {
      onSubmit();
    }
  }, [service, sourceId]);

  return (
    <Box p="sm">
      <OnboardingModal requireSource={false} />
      <ServiceDashboardEndpointSidePanel
        service={service}
        searchedTimeRange={searchedTimeRange}
        sourceId={sourceId}
      />
      <ServiceDashboardDbQuerySidePanel
        service={service}
        searchedTimeRange={searchedTimeRange}
        sourceId={sourceId}
      />
      <form
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
          return false;
        }}
      >
        <Group gap="xs">
          <Group justify="space-between" gap="xs" wrap="nowrap" flex={1}>
            <SourceSelectControlled control={control} name="source" />
            <ServiceSelectControlled
              sourceId={sourceId}
              control={control}
              name="service"
            />
            <WhereLanguageControlled
              name="whereLanguage"
              control={control}
              sqlInput={
                <SQLInlineEditorControlled
                  connectionId={source?.connection}
                  database={source?.from?.databaseName}
                  table={source?.from?.tableName}
                  onSubmit={onSubmit}
                  control={control}
                  name="where"
                  placeholder="SQL WHERE clause (ex. column = 'foo')"
                  onLanguageChange={lang =>
                    setValue('whereLanguage', lang, {
                      shouldDirty: true,
                    })
                  }
                  language="sql"
                  label="WHERE"
                  enableHotkey
                />
              }
              luceneInput={
                <SearchInputV2
                  connectionId={source?.connection}
                  database={source?.from?.databaseName}
                  table={source?.from?.tableName}
                  control={control}
                  name="where"
                  onLanguageChange={lang =>
                    setValue('whereLanguage', lang, {
                      shouldDirty: true,
                    })
                  }
                  language="lucene"
                  placeholder="Search your events w/ Lucene ex. column:foo"
                  enableHotkey
                />
              }
            />
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={range => {
                onSearch(range);
              }}
            />
            <Button variant="outline" type="submit" px="sm">
              <i className="bi bi-play"></i>
            </Button>
          </Group>
        </Group>
      </form>
      {source?.kind !== 'trace' ? (
        <Group align="center" justify="center" h="300px">
          <Text c="gray">Please select a trace source</Text>
        </Group>
      ) : (
        <Tabs
          mt="md"
          keepMounted={false}
          defaultValue="http"
          onChange={setTab}
          value={tab}
        >
          <Tabs.List>
            <Tabs.Tab value="http">HTTP Service</Tabs.Tab>
            <Tabs.Tab value="database">Database</Tabs.Tab>
            <Tabs.Tab value="errors">Errors</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="http">
            <HttpTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="database">
            <DatabaseTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="errors">
            <ErrorsTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
        </Tabs>
      )}
    </Box>
  );
}

const ServicesDashboardPageDynamic = dynamic(
  async () => ServicesDashboardPage,
  {
    ssr: false,
  },
);

// @ts-ignore
ServicesDashboardPageDynamic.getLayout = withAppNav;

export default ServicesDashboardPageDynamic;
