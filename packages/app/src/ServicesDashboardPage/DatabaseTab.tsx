import { useCallback, useMemo, useState } from 'react';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  CteChartConfig,
  DisplayType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Grid } from '@mantine/core';
import { IconFilter, IconTable } from '@tabler/icons-react';

import { INTEGER_NUMBER_FORMAT, MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import DisplaySwitcher from '@/components/charts/DisplaySwitcher';
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

// Database Tab
function DatabaseTab({
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

  const [chartType, setChartType] = useState<'table' | 'list'>('list');

  const getRowSearchLink = useCallback((row: any) => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('dbquery', `${row['Statement']}`);
    return window.location.pathname + '?' + searchParams.toString();
  }, []);

  const totalTimePerQueryConfig =
    useMemo<BuilderChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;

      return {
        with: [
          {
            name: 'queries_by_total_time',
            isSubquery: true,
            chartConfig: {
              ...pickSourceConfigFields(source),
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
      } satisfies BuilderChartConfigWithDateRange;
    }, [appliedConfig, expressions, searchedTimeRange, source]);

  const totalThroughputPerQueryConfig =
    useMemo<BuilderChartConfigWithDateRange | null>(() => {
      if (!source || !expressions) return null;

      return {
        with: [
          {
            name: 'queries_by_total_count',
            isSubquery: true,
            chartConfig: {
              ...pickSourceConfigFields(source),
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
      } satisfies BuilderChartConfigWithDateRange;
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
    <Grid mt="md" grow={false} w="100%" maw="100%">
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
                  ...pickSourceConfigFields(source),
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
                      numberFormat: MS_NUMBER_FORMAT,
                    },
                    {
                      alias: 'total_queries',
                      aggFn: 'count',
                      valueExpression: '',
                    },
                    {
                      alias: 'Queries/Min',
                      valueExpression: `total_queries / age('mi', toDateTime(${searchedTimeRange[0].getTime() / 1000}), toDateTime(${searchedTimeRange[1].getTime() / 1000}))`,
                      numberFormat: INTEGER_NUMBER_FORMAT,
                    },
                    {
                      alias: 'p95_duration_ns',
                      aggFn: 'quantile',
                      level: 0.95,
                      valueExpression: expressions.duration,
                      aggCondition: '',
                    },
                    {
                      alias: 'P95',
                      valueExpression: `p95_duration_ns / ${expressions.durationDivisorForMillis}`,
                      numberFormat: MS_NUMBER_FORMAT,
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
                      numberFormat: MS_NUMBER_FORMAT,
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
                  numberFormat: INTEGER_NUMBER_FORMAT,
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
                  ...pickSourceConfigFields(source),
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
                      numberFormat: MS_NUMBER_FORMAT,
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
                      alias: 'P95',
                      valueExpression: `p95_duration_ns / ${expressions.durationDivisorForMillis}`,
                      numberFormat: MS_NUMBER_FORMAT,
                    },
                    {
                      alias: 'p50_duration_ns',
                      aggFn: 'quantile',
                      valueExpression: expressions.duration,
                      aggCondition: '',
                      level: 0.5,
                    },
                    {
                      alias: 'Median',
                      valueExpression: `p50_duration_ns / ${expressions.durationDivisorForMillis}`,
                      numberFormat: MS_NUMBER_FORMAT,
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
                  numberFormat: INTEGER_NUMBER_FORMAT,
                }}
              />
            ))}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

export default DatabaseTab;
