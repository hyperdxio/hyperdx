import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { pick } from 'lodash';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { UseControllerProps, useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  CteChartConfig,
  DisplayType,
  Filter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import {
  convertDateRangeToGranularityString,
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
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import { withAppNav } from '@/layout';
import SearchInputV2 from '@/SearchInputV2';
import {
  getExpressions,
  useServiceDashboardExpressions,
} from '@/serviceDashboard';
import { useSource, useSources } from '@/source';
import { Histogram } from '@/SVGIcons';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { HARD_LINES_LIMIT } from './HDXMultiSeriesTimeChart';

type AppliedConfig = {
  source?: string | null;
  service?: string | null;
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
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
    ...source,
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

  return (
    <ChartBox style={{ height: 350 }}>
      <Group justify="space-between" align="center" mb="sm">
        <Text size="sm">Request Latency</Text>
        <Box>
          <Button.Group>
            <Button
              variant="subtle"
              color={latencyChartType === 'line' ? 'green' : 'gray'}
              size="xs"
              title="Line Chart"
              onClick={() => setLatencyChartType('line')}
            >
              <i className="bi bi-graph-up" />
            </Button>

            <Button
              variant="subtle"
              color={latencyChartType === 'histogram' ? 'green' : 'gray'}
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
        expressions &&
        (latencyChartType === 'line' ? (
          <DBTimeChart
            showDisplaySwitcher={false}
            sourceId={source.id}
            hiddenSeries={[
              'p95_duration_ns',
              'p50_duration_ns',
              'avg_duration_ns',
            ]}
            config={{
              ...source,
              where: appliedConfig.where || '',
              whereLanguage: appliedConfig.whereLanguage || 'sql',
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
          ...source,
          where: appliedConfig.where || '',
          whereLanguage: appliedConfig.whereLanguage || 'sql',
          displayType: DisplayType.Line,
          select: [
            {
              valueExpression: `countIf(${expressions.isError}) / count()`,
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
              whereLanguage: appliedConfig.whereLanguage || 'sql',
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
              granularity: convertDateRangeToGranularityString(
                searchedTimeRange,
                DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
              ),
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Request Error Rate</Text>
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
          {source && requestErrorRateConfig && (
            <DBTimeChart
              sourceId={source.id}
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Request Throughput</Text>
          </Group>
          {source && expressions && (
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
                filters: getScopedFilters({ appliedConfig, expressions }),
                dateRange: searchedTimeRange,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">20 Top Most Time Consuming Endpoints</Text>
          </Group>

          {source && expressions && (
            <DBListBarChart
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
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
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
                filters: [
                  ...getScopedFilters({ appliedConfig, expressions }),
                ],
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">
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
          {source && expressions && (
            <DBTableChart
              getRowSearchLink={getRowSearchLink}
              hiddenColumns={[
                'total_count',
                'p95_duration_ns',
                'p50_duration_ns',
                'duration_sum_ns',
                'error_count',
              ]}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
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
              whereLanguage: appliedConfig.whereLanguage || 'sql',
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
              granularity: convertDateRangeToGranularityString(
                searchedTimeRange,
                DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
              ),
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
              whereLanguage: appliedConfig.whereLanguage || 'sql',
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
              granularity: convertDateRangeToGranularityString(
                searchedTimeRange,
                DEFAULT_AUTO_GRANULARITY_MAX_BUCKETS,
              ),
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
      } satisfies ChartConfigWithDateRange;
    }, [appliedConfig, expressions, searchedTimeRange, source]);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Total Time Consumed per Query</Text>
          </Group>
          {source && totalTimePerQueryConfig && (
            <DBTimeChart
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Throughput per Query</Text>
          </Group>
          {source && totalThroughputPerQueryConfig && (
            <DBTimeChart
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Top 20 Most Time Consuming Queries</Text>
            <Box>
              <Button.Group>
                <Button
                  variant="subtle"
                  color={chartType === 'list' ? 'green' : 'gray'}
                  size="xs"
                  title="List"
                  onClick={() => setChartType('list')}
                >
                  <i className="bi bi-filter-left" />
                </Button>

                <Button
                  variant="subtle"
                  color={chartType === 'table' ? 'green' : 'gray'}
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
            expressions &&
            (chartType === 'list' ? (
              <DBListBarChart
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
                  ...source,
                  where: appliedConfig.where || '',
                  whereLanguage: appliedConfig.whereLanguage || 'sql',
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
                getRowSearchLink={getRowSearchLink}
                hiddenColumns={[
                  'duration_ns',
                  'total_count',
                  'p95_duration_ns',
                  'p50_duration_ns',
                ]}
                config={{
                  ...source,
                  where: appliedConfig.where || '',
                  whereLanguage: appliedConfig.whereLanguage || 'sql',
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
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Error Events per Service</Text>
          </Group>
          {source && expressions && (
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

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  // For future use if Live button is added
  const [isLive, setIsLive] = useState(false);

  const { manualRefreshCooloff, refresh } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      setAppliedConfig(values);
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Auto submit when service or source changes
  useEffect(() => {
    const normalizedService = service ?? '';
    const appliedService = appliedConfig.service ?? '';
    const normalizedSource = sourceId ?? '';
    const appliedSource = appliedConfig.source ?? '';

    if (
      normalizedService !== appliedService ||
      (normalizedSource && normalizedSource !== appliedSource)
    ) {
      onSubmit();
    }
  }, [
    service,
    sourceId,
    appliedConfig.service,
    appliedConfig.source,
    onSubmit,
  ]);

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
            <WhereLanguageControlled
              name="whereLanguage"
              control={control}
              sqlInput={
                <SQLInlineEditorControlled
                  tableConnection={tcFromSource(source)}
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
                  allowMultiline={true}
                />
              }
              luceneInput={
                <SearchInputV2
                  tableConnection={tcFromSource(source)}
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
                  onSubmit={onSubmit}
                />
              }
            />
            <TimePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={onSearch}
            />
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
            <Button variant="outline" type="submit" px="sm">
              <IconPlayerPlay size={16} />
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
