import { useCallback, useMemo, useState } from 'react';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  CteChartConfig,
  DisplayType,
  Filter,
  isLogSource,
  isTraceSource,
  SourceKind,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Grid, SegmentedControl, Text } from '@mantine/core';
import { IconChartHistogram, IconChartLine } from '@tabler/icons-react';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import DisplaySwitcher from '@/components/charts/DisplaySwitcher';
import DBHistogramChart from '@/components/DBHistogramChart';
import DBListBarChart from '@/components/DBListBarChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import { getStoredLanguage } from '@/components/SearchInput/SearchWhereInput';
import { useServiceDashboardExpressions } from '@/serviceDashboard';
import { useSource } from '@/source';

import {
  getScopedFilters,
  MAX_NUM_SERIES,
  pickSourceConfigFields,
} from './helpers';
import { AppliedConfig } from './types';

export function EndpointLatencyChart({
  source,
  dateRange,
  appliedConfig,
  extraFilters,
}: {
  source: TTraceSource;
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
              ...pickSourceConfigFields(source),
              where: appliedConfig?.where || '',
              whereLanguage:
                (appliedConfig?.whereLanguage ?? getStoredLanguage()) || 'sql',
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
                ...(extraFilters ?? []),
                ...getScopedFilters({
                  appliedConfig: appliedConfig ?? {},
                  expressions,
                }),
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
              ...pickSourceConfigFields(source),
              where: appliedConfig?.where || '',
              whereLanguage:
                (appliedConfig?.whereLanguage ?? getStoredLanguage()) || 'sql',
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
                ...(extraFilters ?? []),
                ...getScopedFilters({
                  appliedConfig: appliedConfig ?? {},
                  expressions,
                }),
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
  const { data: source } = useSource({
    id: appliedConfig.source,
    kinds: [SourceKind.Trace],
  });
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
    useMemo<BuilderChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;
      if (reqChartType === 'overall') {
        return {
          source: source.id,
          ...pickSourceConfigFields(source),
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
        } satisfies BuilderChartConfigWithDateRange;
      }
      return {
        timestampValueExpression: 'series_time_bucket',
        implicitColumnExpression:
          isLogSource(source) || isTraceSource(source)
            ? source.implicitColumnExpression
            : undefined,
        useTextIndexForImplicitColumn:
          isLogSource(source) || isTraceSource(source)
            ? source.useTextIndexForImplicitColumn
            : undefined,
        // No bodyExpression threading here: the HttpTab calls
        // useSource({ kinds: [SourceKind.Trace] }) above (L387-390),
        // so `source` is type-narrowed to TTraceSource and the
        // logs-only body fallback can't apply at this surface.
        connection: source.connection,
        source: source.id,
        with: [
          {
            name: 'error_series',
            chartConfig: {
              timestampValueExpression: source?.timestampValueExpression || '',
              implicitColumnExpression:
                isLogSource(source) || isTraceSource(source)
                  ? source?.implicitColumnExpression || ''
                  : '',
              useTextIndexForImplicitColumn:
                isLogSource(source) || isTraceSource(source)
                  ? source?.useTextIndexForImplicitColumn
                  : undefined,
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
            } as CteChartConfig,
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
      } satisfies BuilderChartConfigWithDateRange;
    }, [source, searchedTimeRange, appliedConfig, expressions, reqChartType]);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%">
      <Grid.Col span={6}>
        <ChartBox
          style={{ height: 350 }}
          data-testid="services-request-error-rate-chart"
        >
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
        <ChartBox
          style={{ height: 350 }}
          data-testid="services-request-throughput-chart"
        >
          {source && expressions && (
            <DBTimeChart
              title="Request Throughput"
              sourceId={source.id}
              config={{
                source: source.id,
                ...pickSourceConfigFields(source),
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
              valueColumn="Total"
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
                ...pickSourceConfigFields(source),
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
                    alias: 'Total',
                    valueExpression: `duration_ns / ${expressions.durationDivisorForMillis}`,
                    aggCondition: '',
                    numberFormat: MS_NUMBER_FORMAT,
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
                    alias: 'P95',
                    valueExpression: `duration_p95_ns / ${expressions.durationDivisorForMillis}`,
                    numberFormat: MS_NUMBER_FORMAT,
                  },
                  {
                    alias: 'duration_p50_ns',
                    aggFn: 'quantile',
                    level: 0.5,
                    valueExpression: expressions.duration,
                    aggCondition: '',
                  },
                  {
                    alias: 'Median',
                    valueExpression: `duration_p50_ns / ${expressions.durationDivisorForMillis}`,
                    numberFormat: MS_NUMBER_FORMAT,
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
                orderBy: '"Total" DESC',
                filters: [...getScopedFilters({ appliedConfig, expressions })],
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
                limit: { limit: 20 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
      <Grid.Col span={6}>
        {source && isTraceSource(source) && (
          <EndpointLatencyChart
            appliedConfig={appliedConfig}
            dateRange={searchedTimeRange}
            source={source}
          />
        )}
      </Grid.Col>
      <Grid.Col span={12}>
        <ChartBox
          style={{ height: 350 }}
          data-testid="services-top-endpoints-table"
        >
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
                ...pickSourceConfigFields(source),
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
                    alias: 'P95',
                    valueExpression: `round(p95_duration_ns / ${expressions.durationDivisorForMillis}, 2)`,
                    numberFormat: MS_NUMBER_FORMAT,
                  },
                  {
                    alias: 'p50_duration_ns',
                    valueExpression: expressions.duration,
                    aggFn: 'quantile',
                    level: 0.5,
                  },
                  {
                    alias: 'Median',
                    valueExpression: `round(p50_duration_ns / ${expressions.durationDivisorForMillis}, 2)`,
                    numberFormat: MS_NUMBER_FORMAT,
                  },
                  {
                    alias: 'duration_sum_ns',
                    valueExpression: expressions.duration,
                    aggFn: 'sum',
                  },
                  {
                    alias: 'Total',
                    valueExpression: `round(duration_sum_ns / ${expressions.durationDivisorForMillis}, 2)`,
                    numberFormat: MS_NUMBER_FORMAT,
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
                    numberFormat: INTEGER_NUMBER_FORMAT,
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
                    ? '"Total" DESC'
                    : '"Errors/Min" DESC',
                limit: { limit: 20 },
                numberFormat: INTEGER_NUMBER_FORMAT,
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

export default HttpTab;
