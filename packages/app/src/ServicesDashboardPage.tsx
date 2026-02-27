import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { pick } from 'lodash';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { UseControllerProps, useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  CteChartConfig,
  DisplayType,
  Filter,
  PresetDashboard,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconChartHistogram,
  IconChartLine,
  IconFilter,
  IconFilterEdit,
  IconPlayerPlay,
  IconRefresh,
  IconTable,
} from '@tabler/icons-react';

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
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import SelectControlled from '@/components/SelectControlled';
import ServiceDashboardDbQuerySidePanel from '@/components/ServiceDashboardDbQuerySidePanel';
import ServiceDashboardEndpointSidePanel from '@/components/ServiceDashboardEndpointSidePanel';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import { withAppNav } from '@/layout';
import {
  getExpressions,
  useServiceDashboardExpressions,
} from '@/serviceDashboard';
import { useSource, useSources } from '@/source';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import DisplaySwitcher from './components/charts/DisplaySwitcher';
import usePresetDashboardFilters from './hooks/usePresetDashboardFilters';
import { IS_LOCAL_MODE } from './config';
import DashboardFilters from './DashboardFilters';
import DashboardFiltersModal from './DashboardFiltersModal';
import { HARD_LINES_LIMIT } from './HDXMultiSeriesTimeChart';
import { usePrevious } from './utils';

type AppliedConfigParams = {
  source?: string | null;
  service?: string | null;
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
};

type AppliedConfig = AppliedConfigParams & {
  additionalFilters?: Filter[];
};

const MAX_NUM_SERIES = HARD_LINES_LIMIT;

function getScopedFilters({
  appliedConfig,
  expressions,
  includeIsSpanKindServer = true,
  includeNonEmptyEndpointFilter = false,
}: {
  appliedConfig: AppliedConfig;
  expressions: ReturnType<typeof getExpressions>;
  includeIsSpanKindServer?: boolean;
  includeNonEmptyEndpointFilter?: boolean;
}): Filter[] {
  const filters: Filter[] = [...(appliedConfig.additionalFilters || [])];
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
  if (includeNonEmptyEndpointFilter) {
    filters.push({
      type: 'sql',
      condition: expressions.isEndpointNonEmpty,
    });
  }
  return filters;
}

function ServiceSelectControlled({
  sourceId,
  onCreate,
  dateRange,
  ...props
}: {
  sourceId?: string;
  size?: string;
  dateRange: [Date, Date];
  onCreate?: () => void;
} & UseControllerProps<any>) {
  const { data: source } = useSource({ id: sourceId });
  const { expressions } = useServiceDashboardExpressions({ source });

  const queriedConfig = {
    source: source?.id,
    timestampValueExpression: source?.timestampValueExpression || '',
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      {
        alias: 'service',
        valueExpression: `distinct(${expressions?.service})`,
      },
    ],
    where: `${expressions?.service} IS NOT NULL`,
    whereLanguage: 'sql' as const,
    limit: { limit: 10000 },
    dateRange,
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['service-select', queriedConfig],
    enabled: !!source && !!expressions,
  });

  const values = useMemo(() => {
    const services =
      data?.data
        ?.map((d: any) => d.service)
        .filter(Boolean)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        ) || [];
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
      nothingFoundMessage={isLoading ? 'Loading more...' : 'No matches found'}
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
  const { expressions } = useServiceDashboardExpressions({ source });
  const [latencyChartType, setLatencyChartType] = useState<
    'line' | 'histogram'
  >('line');

  const displaySwitcher = (
    <DisplaySwitcher
      key="display-switcher"
      value={latencyChartType}
      onChange={setLatencyChartType}
      options={[
        {
          value: 'line',
          label: 'Display as Line Chart',
          icon: <IconChartLine />,
        },
        {
          value: 'histogram',
          label: 'Display as Histogram',
          icon: <IconChartHistogram />,
        },
      ]}
    />
  );

  return (
    <ChartBox style={{ height: 350 }}>
      {source &&
        expressions &&
        (latencyChartType === 'line' ? (
          <DBTimeChart
            title="Request Latency"
            toolbarSuffix={[displaySwitcher]}
            showDisplaySwitcher={false}
            sourceId={source.id}
            hiddenSeries={[
              'p95_duration_ns',
              'p50_duration_ns',
              'avg_duration_ns',
            ]}
            config={{
              source: source.id,
              ...pick(source, [
                'timestampValueExpression',
                'connection',
                'from',
              ]),
              where: appliedConfig.where || '',
              whereLanguage:
                (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
              select: [
                // Separate the aggregations from the conversion to ms so that AggregatingMergeTree MVs can be used
                {
                  alias: 'p95_duration_ns',
                  aggFn: 'quantile',
                  level: 0.95,
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: '95th Percentile',
                  valueExpression: `p95_duration_ns / ${expressions.durationDivisorForMillis}`,
                },
                {
                  alias: 'p50_duration_ns',
                  aggFn: 'quantile',
                  level: 0.5,
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: 'Median',
                  valueExpression: `p50_duration_ns / ${expressions.durationDivisorForMillis}`,
                },
                {
                  alias: 'avg_duration_ns',
                  aggFn: 'avg',
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: 'Avg',
                  valueExpression: `avg_duration_ns / ${expressions.durationDivisorForMillis}`,
                },
              ],
              filters: [
                ...extraFilters,
                ...getScopedFilters({ appliedConfig, expressions }),
              ],
              numberFormat: MS_NUMBER_FORMAT,
              dateRange,
            }}
          />
        ) : (
          <DBHistogramChart
            title="Request Latency"
            toolbarSuffix={[displaySwitcher]}
            config={{
              source: source.id,
              ...pick(source, [
                'timestampValueExpression',
                'connection',
                'from',
              ]),
              where: appliedConfig.where || '',
              whereLanguage:
                (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
              select: [
                {
                  alias: 'data_nanoseconds',
                  aggFn: 'histogram',
                  level: 20,
                  valueExpression: expressions.duration,
                },
                {
                  alias: 'data',
                  valueExpression: `arrayMap(bin -> (bin.1 / ${expressions.durationDivisorForMillis}, bin.2 / ${expressions.durationDivisorForMillis}, bin.3), data_nanoseconds)`,
                },
              ],
              filters: [
                ...extraFilters,
                ...getScopedFilters({ appliedConfig, expressions }),
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
  const { expressions } = useServiceDashboardExpressions({ source });

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

  const requestErrorRateConfig =
    useMemo<ChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;
      if (reqChartType === 'overall') {
        return {
          source: source.id,
          ...pick(source, ['timestampValueExpression', 'connection', 'from']),
          where: appliedConfig.where || '',
          whereLanguage:
            (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
          displayType: DisplayType.Line,
          select: [
            // Separate the aggregations from the rate calculation so that AggregatingMergeTree MVs can be used
            {
              valueExpression: '',
              aggFn: 'count',
              alias: 'total_requests',
            },
            {
              valueExpression: '',
              aggFn: 'count',
              aggCondition: expressions.isError,
              aggConditionLanguage: 'sql',
              alias: 'error_requests',
            },
            {
              valueExpression: `error_requests / total_requests`,
              alias: 'error_rate',
            },
          ],
          numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
          filters: getScopedFilters({ appliedConfig, expressions }),
          dateRange: searchedTimeRange,
        } satisfies ChartConfigWithDateRange;
      }
      return {
        timestampValueExpression: 'series_time_bucket',
        connection: source.connection,
        source: source.id,
        with: [
          {
            name: 'error_series',
            chartConfig: {
              timestampValueExpression: source?.timestampValueExpression || '',
              connection: source?.connection ?? '',
              from: source?.from ?? {
                databaseName: '',
                tableName: '',
              },
              where: appliedConfig.where || '',
              whereLanguage:
                (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
              select: [
                {
                  valueExpression: '',
                  aggFn: 'count',
                  alias: 'error_count',
                  aggCondition: expressions.isError,
                  aggConditionLanguage: 'sql',
                },
                {
                  valueExpression: '',
                  aggFn: 'count',
                  alias: 'total_count',
                },
                {
                  valueExpression: `error_count / total_count`,
                  alias: 'error_rate',
                },
                {
                  valueExpression: expressions?.endpoint,
                  alias: 'endpoint',
                },
              ],
              filters: getScopedFilters({ appliedConfig, expressions }),
              groupBy: [
                {
                  valueExpression: 'endpoint',
                },
              ],
              orderBy: [
                {
                  valueExpression: 'endpoint',
                  ordering: 'ASC',
                },
              ],
              dateRange: searchedTimeRange,
              granularity:
                convertDateRangeToGranularityString(searchedTimeRange),
            } as ChartConfigWithOptDateRange,
            isSubquery: true,
          },
          // Select the top N series from the search as we don't want to crash the browser.
          // Series are selected based on their max error value
          {
            name: 'selected_error_series',
            isSubquery: true,
            chartConfig: {
              timestampValueExpression: '__hdx_time_bucket',
              connection: source.connection,
              select: [
                {
                  valueExpression: 'groupArray(error_rate)',
                  alias: 'error_rate',
                },
                { valueExpression: 'endpoint' },
                {
                  valueExpression: 'groupArray(__hdx_time_bucket)',
                  alias: '__hdx_time_buckets',
                },
              ],
              from: { databaseName: '', tableName: 'error_series' },
              where: '',
              groupBy: 'endpoint',
              orderBy: 'max(error_series.error_rate) DESC',
              limit: { limit: MAX_NUM_SERIES },
            },
          },
          // CTE that explodes series arrays into rows again for compatibility with DBTimeChart
          {
            name: 'zipped_error_series',
            isSubquery: true,
            chartConfig: {
              timestampValueExpression: '__hdx_time_bucket',
              connection: source.connection,
              select: [
                { valueExpression: 'endpoint' },
                {
                  valueExpression:
                    'arrayJoin(arrayZip(error_rate, __hdx_time_buckets))',
                  alias: 'zipped',
                },
              ],
              from: {
                databaseName: '',
                tableName: 'selected_error_series',
              },
              where: '',
            },
          },
        ],
        select: [
          {
            valueExpression: 'tupleElement(zipped, 1)',
            alias: 'Error Rate %',
          },
          {
            valueExpression: 'endpoint',
          },
          {
            valueExpression: 'tupleElement(zipped, 2)',
            alias: 'series_time_bucket',
          },
        ],
        from: {
          databaseName: '',
          tableName: 'zipped_error_series',
        },
        where: '',
        dateRange: searchedTimeRange,
        displayType: DisplayType.Line,
        numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
        groupBy: 'zipped, endpoint',
      } satisfies ChartConfigWithDateRange;
    }, [source, searchedTimeRange, appliedConfig, expressions, reqChartType]);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          {source && requestErrorRateConfig && (
            <DBTimeChart
              title="Request Error Rate"
              toolbarSuffix={[
                <SegmentedControl
                  key="request-error-rate-segmented-control"
                  size="xs"
                  value={reqChartType}
                  onChange={setReqChartType}
                  data={[
                    { label: 'Overall', value: 'overall' },
                    { label: 'By Endpoint', value: 'endpoint' },
                  ]}
                />,
              ]}
              sourceId={source.id}
              hiddenSeries={['total_requests', 'error_requests']}
              config={requestErrorRateConfig}
              showDisplaySwitcher={false}
              disableQueryChunking
              disableDrillDown
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          {source && expressions && (
            <DBTimeChart
              title="Request Throughput"
              sourceId={source.id}
              config={{
                source: source.id,
                ...pick(source, [
                  'timestampValueExpression',
                  'connection',
                  'from',
                ]),
                where: appliedConfig.where || '',
                whereLanguage:
                  (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
                displayType: DisplayType.Line,
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
                filters: getScopedFilters({ appliedConfig, expressions }),
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          {source && expressions && (
            <DBListBarChart
              title="Top 20 Most Time Consuming Endpoints"
              groupColumn="Endpoint"
              valueColumn="Total (ms)"
              getRowSearchLink={getRowSearchLink}
              hiddenSeries={[
                'duration_ns',
                'total_requests',
                'duration_p95_ns',
                'duration_p50_ns',
                'error_requests',
              ]}
              config={{
                source: source.id,
                ...pick(source, [
                  'timestampValueExpression',
                  'connection',
                  'from',
                ]),
                where: appliedConfig.where || '',
                whereLanguage:
                  (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
                select: [
                  // Separate the aggregations from the conversion to ms and rate so that AggregatingMergeTree MVs can be used
                  {
                    alias: 'Endpoint',
                    valueExpression: expressions.endpoint,
                  },
                  {
                    alias: 'duration_ns',
                    aggFn: 'sum',
                    valueExpression: expressions.duration,
                    aggCondition: '',
                  },
                  {
                    alias: 'Total (ms)',
                    valueExpression: `duration_ns / ${expressions.durationDivisorForMillis}`,
                    aggCondition: '',
                  },
                  {
                    alias: 'total_requests',
                    aggFn: 'count',
                    valueExpression: '',
                  },
                  {
                    alias: 'Req/Min',
                    valueExpression: `
                      total_requests /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000}))`,
                  },
                  {
                    alias: 'duration_p95_ns',
                    aggFn: 'quantile',
                    level: 0.95,
                    valueExpression: expressions.duration,
                    aggCondition: '',
                  },
                  {
                    alias: 'P95 (ms)',
                    valueExpression: `duration_p95_ns / ${expressions.durationDivisorForMillis}`,
                  },
                  {
                    alias: 'duration_p50_ns',
                    aggFn: 'quantile',
                    level: 0.5,
                    valueExpression: expressions.duration,
                    aggCondition: '',
                  },
                  {
                    alias: 'Median (ms)',
                    valueExpression: `duration_p50_ns / ${expressions.durationDivisorForMillis}`,
                  },
                  {
                    alias: 'error_requests',
                    aggFn: 'count',
                    valueExpression: '',
                    aggCondition: expressions.isError,
                    aggConditionLanguage: 'sql',
                  },
                  {
                    alias: 'Errors/Min',
                    valueExpression: `error_requests /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000}))`,
                  },
                ],
                selectGroupBy: false,
                groupBy: expressions.endpoint,
                orderBy: '"Total (ms)" DESC',
                filters: [...getScopedFilters({ appliedConfig, expressions })],
                dateRange: searchedTimeRange,
                numberFormat: MS_NUMBER_FORMAT,
                limit: { limit: 20 },
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
          {source && expressions && (
            <DBTableChart
              title={
                <Text size="sm">
                  Top 20{' '}
                  {topEndpointsChartType === 'time'
                    ? 'Most Time Consuming'
                    : 'Highest Error Rate'}
                </Text>
              }
              toolbarSuffix={[
                <SegmentedControl
                  key="top-endpoints-chart-segmented-control"
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
                />,
              ]}
              getRowSearchLink={getRowSearchLink}
              hiddenColumns={[
                'total_count',
                'p95_duration_ns',
                'p50_duration_ns',
                'duration_sum_ns',
                'error_count',
              ]}
              config={{
                source: source.id,
                ...pick(source, [
                  'timestampValueExpression',
                  'connection',
                  'from',
                ]),
                where: appliedConfig.where || '',
                whereLanguage:
                  (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
                select: [
                  // Separate the aggregations from the conversion to ms and rate so that AggregatingMergeTree MVs can be used
                  {
                    alias: 'Endpoint',
                    valueExpression: expressions.endpoint,
                  },
                  {
                    alias: 'total_count',
                    valueExpression: '',
                    aggFn: 'count',
                  },
                  {
                    alias: 'Req/Min',
                    valueExpression: `round(total_count /
                        age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000})), 1)`,
                  },
                  {
                    alias: 'p95_duration_ns',
                    valueExpression: expressions.duration,
                    aggFn: 'quantile',
                    level: 0.95,
                  },
                  {
                    alias: 'P95 (ms)',
                    valueExpression: `round(p95_duration_ns / ${expressions.durationDivisorForMillis}, 2)`,
                  },
                  {
                    alias: 'p50_duration_ns',
                    valueExpression: expressions.duration,
                    aggFn: 'quantile',
                    level: 0.5,
                  },
                  {
                    alias: 'Median (ms)',
                    valueExpression: `round(p50_duration_ns / ${expressions.durationDivisorForMillis}, 2)`,
                  },
                  {
                    alias: 'duration_sum_ns',
                    valueExpression: expressions.duration,
                    aggFn: 'sum',
                  },
                  {
                    alias: 'Total (ms)',
                    valueExpression: `round(duration_sum_ns / ${expressions.durationDivisorForMillis}, 2)`,
                  },
                  {
                    alias: 'error_count',
                    valueExpression: '',
                    aggCondition: expressions.isError,
                    aggConditionLanguage: 'sql',
                    aggFn: 'count',
                  },
                  {
                    alias: 'Errors/Min',
                    valueExpression: `round(error_count /
                      age('mi', toDateTime(${startTime / 1000}), toDateTime(${endTime / 1000})), 1)`,
                  },
                ],
                filters: getScopedFilters({
                  appliedConfig,
                  expressions,
                  includeNonEmptyEndpointFilter: true,
                }),
                selectGroupBy: false,
                groupBy: expressions.endpoint,
                dateRange: searchedTimeRange,
                orderBy:
                  topEndpointsChartType === 'time'
                    ? '"Total (ms)" DESC'
                    : '"Errors/Min" DESC',
                limit: { limit: 20 },
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
  const { expressions } = useServiceDashboardExpressions({ source });

  const [chartType, setChartType] = useState<'table' | 'list'>('list');

  const getRowSearchLink = useCallback((row: any) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('dbquery', `${row['Statement']}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  const totalTimePerQueryConfig =
    useMemo<ChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;

      return {
        with: [
          {
            name: 'queries_by_total_time',
            isSubquery: true,
            chartConfig: {
              ...pick(source, [
                'timestampValueExpression',
                'connection',
                'from',
              ]),
              where: appliedConfig.where || '',
              whereLanguage:
                (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
              select: [
                // Separate the aggregations from the conversion to ms so that AggregatingMergeTree MVs can be used
                {
                  alias: 'total_query_time_ns',
                  aggFn: 'sum',
                  valueExpression: expressions.duration,
                  aggCondition: '',
                },
                {
                  alias: 'total_query_time_ms',
                  valueExpression: `total_query_time_ns / ${expressions.durationDivisorForMillis}`,
                },
                {
                  alias: 'Statement',
                  valueExpression: expressions.dbStatement,
                },
              ],
              groupBy: 'Statement',
              filters: [
                ...getScopedFilters({
                  expressions,
                  appliedConfig,
                  includeIsSpanKindServer: false,
                }),
                { type: 'sql', condition: expressions.isDbSpan },
              ],
              // Date range and granularity add an `__hdx_time_bucket` column to select and group by
              dateRange: searchedTimeRange,
              granularity:
                convertDateRangeToGranularityString(searchedTimeRange),
            } as CteChartConfig,
          },
          {
            name: 'top_queries_by_total_time',
            isSubquery: true,
            chartConfig: {
              connection: source.connection,
              select: [
                { valueExpression: 'Statement' },
                {
                  valueExpression: 'groupArray(total_query_time_ms)',
                  alias: 'total_query_time_ms',
                },
                {
                  valueExpression: 'groupArray(__hdx_time_bucket)',
                  alias: '__hdx_time_buckets',
                },
              ],
              from: { databaseName: '', tableName: 'queries_by_total_time' },
              groupBy: 'Statement',
              where: '',
              // Select the top MAX_NUM_SERIES queries by max time in any bucket
              orderBy: 'max(queries_by_total_time.total_query_time_ms) DESC',
              limit: { limit: MAX_NUM_SERIES },
              timestampValueExpression: '', // required only to satisfy CTE schema
            },
          },
          {
            name: 'zipped_series',
            isSubquery: true,
            chartConfig: {
              connection: source.connection,
              select: [
                { valueExpression: 'Statement' },
                {
                  valueExpression:
                    'arrayJoin(arrayZip(total_query_time_ms, __hdx_time_buckets))',
                  alias: 'zipped',
                },
              ],
              from: {
                databaseName: '',
                tableName: 'top_queries_by_total_time',
              },
              where: '',
              timestampValueExpression: '', // required only to satisfy CTE schema
            },
          },
        ],

        select: [
          { valueExpression: 'Statement' },
          {
            valueExpression: 'tupleElement(zipped, 1)',
            alias: 'Total Query Time',
          },
          {
            valueExpression: 'tupleElement(zipped, 2)',
            alias: 'series_time_bucket',
          },
        ],
        from: { databaseName: '', tableName: 'zipped_series' },
        where: '',

        displayType: DisplayType.StackedBar,
        numberFormat: MS_NUMBER_FORMAT,
        groupBy: 'Statement, zipped',
        dateRange: searchedTimeRange,
        timestampValueExpression: 'series_time_bucket',
        connection: source.connection,
        source: source.id,
      } satisfies ChartConfigWithDateRange;
    }, [appliedConfig, expressions, searchedTimeRange, source]);

  const totalThroughputPerQueryConfig =
    useMemo<ChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;

      return {
        with: [
          {
            name: 'queries_by_total_count',
            isSubquery: true,
            chartConfig: {
              ...pick(source, [
                'timestampValueExpression',
                'connection',
                'from',
              ]),
              where: appliedConfig.where || '',
              whereLanguage:
                (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
              select: [
                {
                  alias: 'total_query_count',
                  aggFn: 'count',
                  valueExpression: '',
                  aggCondition: '',
                },
                {
                  alias: 'Statement',
                  valueExpression: expressions.dbStatement,
                },
              ],
              groupBy: 'Statement',
              filters: [
                ...getScopedFilters({
                  expressions,
                  appliedConfig,
                  includeIsSpanKindServer: false,
                }),
                { type: 'sql', condition: expressions.isDbSpan },
              ],
              // Date range and granularity add an `__hdx_time_bucket` column to select and group by
              dateRange: searchedTimeRange,
              granularity:
                convertDateRangeToGranularityString(searchedTimeRange),
            } as CteChartConfig,
          },
          {
            name: 'top_queries_by_total_count',
            isSubquery: true,
            chartConfig: {
              connection: source.connection,
              select: [
                { valueExpression: 'Statement' },
                {
                  valueExpression: 'groupArray(total_query_count)',
                  alias: 'total_query_count',
                },
                {
                  valueExpression: 'groupArray(__hdx_time_bucket)',
                  alias: '__hdx_time_buckets',
                },
              ],
              from: { databaseName: '', tableName: 'queries_by_total_count' },
              groupBy: 'Statement',
              where: '',
              // Select the top MAX_NUM_SERIES queries by max time in any bucket
              orderBy: 'max(queries_by_total_count.total_query_count) DESC',
              limit: { limit: MAX_NUM_SERIES },
              timestampValueExpression: '', // required only to satisfy CTE schema
            },
          },
          {
            name: 'zipped_series',
            isSubquery: true,
            chartConfig: {
              connection: source.connection,
              select: [
                { valueExpression: 'Statement' },
                {
                  valueExpression:
                    'arrayJoin(arrayZip(total_query_count, __hdx_time_buckets))',
                  alias: 'zipped',
                },
              ],
              from: {
                databaseName: '',
                tableName: 'top_queries_by_total_count',
              },
              where: '',
              timestampValueExpression: '', // required only to satisfy CTE schema
            },
          },
        ],

        select: [
          { valueExpression: 'Statement' },
          {
            valueExpression: 'tupleElement(zipped, 1)',
            alias: 'Total Query Count',
          },
          {
            valueExpression: 'tupleElement(zipped, 2)',
            alias: 'series_time_bucket',
          },
        ],
        from: { databaseName: '', tableName: 'zipped_series' },
        where: '',

        displayType: DisplayType.StackedBar,
        numberFormat: {
          ...INTEGER_NUMBER_FORMAT,
          unit: 'queries',
        },
        groupBy: 'Statement, zipped',
        dateRange: searchedTimeRange,
        timestampValueExpression: 'series_time_bucket',
        connection: source.connection,
        source: source.id,
      } satisfies ChartConfigWithDateRange;
    }, [appliedConfig, expressions, searchedTimeRange, source]);

  const displaySwitcher = (
    <DisplaySwitcher
      key="display-switcher"
      value={chartType}
      onChange={setChartType}
      options={[
        {
          label: 'Show as List',
          icon: <IconFilter size={14} />,
          value: 'list',
        },
        {
          label: 'Show as Table',
          icon: <IconTable size={14} />,
          value: 'table',
        },
      ]}
    />
  );

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          {source && totalTimePerQueryConfig && (
            <DBTimeChart
              title="Total Time Consumed per Query"
              sourceId={source.id}
              config={totalTimePerQueryConfig}
              disableDrillDown
              disableQueryChunking
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          {source && totalThroughputPerQueryConfig && (
            <DBTimeChart
              title="Throughput per Query"
              sourceId={source.id}
              config={totalThroughputPerQueryConfig}
              disableQueryChunking
              disableDrillDown
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          {source &&
            expressions &&
            (chartType === 'list' ? (
              <DBListBarChart
                title="Top 20 Most Time Consuming Queries"
                toolbarItems={[displaySwitcher]}
                groupColumn="Statement"
                valueColumn="Total"
                hoverCardPosition="top-start"
                getRowSearchLink={getRowSearchLink}
                hiddenSeries={[
                  'total_duration_ns',
                  'total_queries',
                  'p95_duration_ns',
                  'p50_duration_ns',
                ]}
                config={{
                  source: source.id,
                  ...pick(source, [
                    'timestampValueExpression',
                    'connection',
                    'from',
                  ]),
                  where: appliedConfig.where || '',
                  whereLanguage:
                    (appliedConfig.whereLanguage ?? getStoredLanguage()) ||
                    'sql',
                  dateRange: searchedTimeRange,
                  groupBy: 'Statement',
                  selectGroupBy: false,
                  orderBy: '"Total" DESC',
                  select: [
                    // Separate the aggregations from the conversion to ms and rate so that AggregatingMergeTree MVs can be used
                    {
                      alias: 'Statement',
                      valueExpression: expressions.dbStatement,
                    },
                    {
                      alias: 'total_duration_ns',
                      aggFn: 'sum',
                      valueExpression: expressions.duration,
                      aggCondition: '',
                    },
                    {
                      alias: 'Total',
                      valueExpression: `total_duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                    {
                      alias: 'total_queries',
                      aggFn: 'count',
                      valueExpression: '',
                    },
                    {
                      alias: 'Queries/Min',
                      valueExpression: `total_queries / age('mi', toDateTime(${searchedTimeRange[0].getTime() / 1000}), toDateTime(${searchedTimeRange[1].getTime() / 1000}))`,
                    },
                    {
                      alias: 'p95_duration_ns',
                      aggFn: 'quantile',
                      level: 0.95,
                      valueExpression: expressions.duration,
                      aggCondition: '',
                    },
                    {
                      alias: 'P95 (ms)',
                      valueExpression: `p95_duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                    {
                      alias: 'p50_duration_ns',
                      aggFn: 'quantile',
                      level: 0.5,
                      valueExpression: expressions.duration,
                      aggCondition: '',
                    },
                    {
                      alias: 'Median (ms)',
                      valueExpression: `p50_duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                  ],
                  filters: [
                    ...getScopedFilters({
                      appliedConfig,
                      expressions,
                      includeIsSpanKindServer: false,
                    }),
                    { type: 'sql', condition: expressions.isDbSpan },
                  ],
                  limit: { limit: 20 },
                }}
              />
            ) : (
              <DBTableChart
                title="Top 20 Most Time Consuming Queries"
                toolbarSuffix={[displaySwitcher]}
                getRowSearchLink={getRowSearchLink}
                hiddenColumns={[
                  'duration_ns',
                  'total_count',
                  'p95_duration_ns',
                  'p50_duration_ns',
                ]}
                config={{
                  source: source.id,
                  ...pick(source, [
                    'timestampValueExpression',
                    'connection',
                    'from',
                  ]),
                  where: appliedConfig.where || '',
                  whereLanguage:
                    (appliedConfig.whereLanguage ?? getStoredLanguage()) ||
                    'sql',
                  dateRange: searchedTimeRange,
                  groupBy: 'Statement',
                  orderBy: '"Total" DESC',
                  selectGroupBy: false,
                  select: [
                    {
                      alias: 'Statement',
                      valueExpression: expressions.dbStatement,
                    },
                    {
                      alias: 'duration_ns',
                      aggFn: 'sum',
                      valueExpression: expressions.duration,
                      aggCondition: '',
                    },
                    {
                      alias: 'Total',
                      valueExpression: `duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                    {
                      alias: 'total_count',
                      aggFn: 'count',
                      valueExpression: '',
                    },
                    {
                      alias: 'Queries/Min',
                      valueExpression: `total_count / age('mi', toDateTime(${searchedTimeRange[0].getTime() / 1000}), toDateTime(${searchedTimeRange[1].getTime() / 1000}))`,
                    },
                    {
                      alias: 'p95_duration_ns',
                      aggFn: 'quantile',
                      valueExpression: expressions.duration,
                      aggCondition: '',
                      level: 0.95,
                    },
                    {
                      alias: 'P95 (ms)',
                      valueExpression: `p95_duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                    {
                      alias: 'p50_duration_ns',
                      aggFn: 'quantile',
                      valueExpression: expressions.duration,
                      aggCondition: '',
                      level: 0.5,
                    },
                    {
                      alias: 'Median (ms)',
                      valueExpression: `p50_duration_ns / ${expressions.durationDivisorForMillis}`,
                    },
                  ],
                  filters: [
                    ...getScopedFilters({
                      appliedConfig,
                      expressions,
                      includeIsSpanKindServer: false,
                    }),
                    { type: 'sql', condition: expressions.isDbSpan },
                  ],
                  limit: { limit: 20 },
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
  const { expressions } = useServiceDashboardExpressions({ source });

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          {source && expressions && (
            <DBTimeChart
              title="Error Events per Service"
              sourceId={source.id}
              config={{
                source: source.id,
                ...pick(source, [
                  'timestampValueExpression',
                  'connection',
                  'from',
                ]),
                where: appliedConfig.where || '',
                whereLanguage:
                  (appliedConfig.whereLanguage ?? getStoredLanguage()) || 'sql',
                displayType: DisplayType.StackedBar,
                select: [
                  {
                    valueExpression: '',
                    aggFn: 'count',
                  },
                ],
                numberFormat: INTEGER_NUMBER_FORMAT,
                filters: [
                  {
                    type: 'sql',
                    condition: expressions.isError,
                  },
                  ...getScopedFilters({ appliedConfig, expressions }),
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

  const [appliedConfigParams, setAppliedConfigParams] =
    useQueryStates(appliedConfigMap);

  // Only use the source from the URL params if it is a trace source
  const appliedConfigWithoutFilters = useMemo(() => {
    if (!sources?.length) return appliedConfigParams;

    const traceSources = sources?.filter(s => s.kind === SourceKind.Trace);
    const paramsSourceIdIsTraceSource = traceSources?.find(
      s => s.id === appliedConfigParams.source,
    );

    const effectiveSourceId = paramsSourceIdIsTraceSource
      ? appliedConfigParams.source
      : traceSources?.[0]?.id || '';

    return {
      ...appliedConfigParams,
      source: effectiveSourceId,
    };
  }, [appliedConfigParams, sources]);

  // Services dashboard is SQL-first (WHERE filters are applied to metric/SQL queries).
  // Default to 'sql' here; Search and Dashboard pages default to 'lucene'.
  const effectiveWhereLanguage =
    appliedConfigWithoutFilters?.whereLanguage ?? getStoredLanguage() ?? 'sql';

  const { control, setValue, handleSubmit } = useForm({
    defaultValues: {
      where: '',
      whereLanguage: effectiveWhereLanguage as 'sql' | 'lucene',
      service: appliedConfigWithoutFilters?.service || '',
      source: appliedConfigWithoutFilters?.source ?? '',
    },
  });

  const service = useWatch({ control, name: 'service' });
  const previousService = usePrevious(service);

  const sourceId = useWatch({ control, name: 'source' });
  const previousSourceId = usePrevious(sourceId);

  const { data: source } = useSource({
    id: sourceId,
  });

  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const {
    filters,
    filterValues,
    setFilterValue,
    filterQueries: additionalFilters,
    handleSaveFilter,
    handleRemoveFilter,
    isFetching: isFetchingFilters,
    isMutationPending: isFiltersMutationPending,
  } = usePresetDashboardFilters({
    presetDashboard: PresetDashboard.Services,
    sourceId: sourceId || '',
    enabled: !IS_LOCAL_MODE,
  });

  const appliedConfig = useMemo(
    () => ({
      ...appliedConfigWithoutFilters,
      additionalFilters,
    }),
    [appliedConfigWithoutFilters, additionalFilters],
  );

  // Update the `source` query parameter if the appliedConfig source changes
  useEffect(() => {
    if (
      appliedConfigWithoutFilters.source &&
      appliedConfigWithoutFilters.source !== appliedConfigParams.source
    ) {
      setAppliedConfigParams({ source: appliedConfigWithoutFilters.source });
    }
  }, [
    appliedConfigWithoutFilters.source,
    appliedConfigParams.source,
    setAppliedConfigParams,
  ]);

  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  // For future use if Live button is added
  const [isLive, _setIsLive] = useState(false);

  const { manualRefreshCooloff, refresh } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive,
  });

  const onSubmit = useCallback(
    (submitTime: boolean = true) => {
      if (submitTime) onSearch(displayedTimeInputValue);
      handleSubmit(values => {
        setAppliedConfigParams(values);
      })();
    },
    [handleSubmit, setAppliedConfigParams, onSearch, displayedTimeInputValue],
  );

  // Auto-submit when source changes
  // Note: do not include appliedConfig.source in the deps,
  // to avoid infinite render loops when navigating away from the page
  useEffect(() => {
    if (sourceId && sourceId != previousSourceId) {
      onSubmit(false);
    }
  }, [sourceId, onSubmit, previousSourceId]);

  // Auto-submit when service changes
  // Note: do not include appliedConfig.service in the deps,
  // to avoid infinite render loops when navigating away from the page
  useEffect(() => {
    if (service != previousService) {
      onSubmit(false);
    }
  }, [service, onSubmit, previousService]);

  return (
    <Box p="sm" data-testid="services-dashboard-page">
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
            <SourceSelectControlled
              control={control}
              name="source"
              allowedSourceKinds={[SourceKind.Trace]}
            />
            <ServiceSelectControlled
              sourceId={sourceId}
              control={control}
              name="service"
              dateRange={searchedTimeRange}
            />
            <SearchWhereInput
              tableConnection={tcFromSource(source)}
              control={control}
              name="where"
              onSubmit={onSubmit}
              enableHotkey
            />
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={onSearch}
            />
            {!IS_LOCAL_MODE && (
              <Tooltip withArrow label="Edit Filters" fz="xs" color="gray">
                <ActionIcon
                  variant="secondary"
                  onClick={() => setShowFiltersModal(true)}
                  size="lg"
                >
                  <IconFilterEdit size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip withArrow label="Refresh dashboard" fz="xs" color="gray">
              <ActionIcon
                onClick={refresh}
                loading={manualRefreshCooloff}
                disabled={manualRefreshCooloff}
                variant="secondary"
                title="Refresh dashboard"
                aria-label="Refresh dashboard"
                size="lg"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="primary"
              type="submit"
              px="sm"
              leftSection={<IconPlayerPlay size={16} />}
              style={{ flexShrink: 0 }}
            >
              Run
            </Button>
          </Group>
        </Group>
      </form>
      <DashboardFilters
        filters={filters}
        filterValues={filterValues}
        onSetFilterValue={setFilterValue}
        dateRange={searchedTimeRange}
      />
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
      <DashboardFiltersModal
        opened={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onSaveFilter={handleSaveFilter}
        onRemoveFilter={handleRemoveFilter}
        source={source}
        isLoading={isFetchingFilters || isFiltersMutationPending}
      />
    </Box>
  );
}

const ServicesDashboardPageDynamic = dynamic(
  async () => ServicesDashboardPage,
  {
    ssr: false,
  },
);

// @ts-expect-error Next.js layout typing
ServicesDashboardPageDynamic.getLayout = withAppNav;

export default ServicesDashboardPageDynamic;
