import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { UseControllerProps, useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  DisplayType,
  Filter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Card,
  Grid,
  Group,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import {
  CURRENCY_NUMBER_FORMAT,
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import DBHistogramChart from '@/components/DBHistogramChart';
import DBListBarChart from '@/components/DBListBarChart';
import DBNumberChart from '@/components/DBNumberChart';
import DBTableChart from '@/components/DBTableChart';
import { DBTimeChart } from '@/components/DBTimeChart';
import OnboardingModal from '@/components/OnboardingModal';
import SelectControlled from '@/components/SelectControlled';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLInlineEditor';
import { TimePicker } from '@/components/TimePicker';
import WhereLanguageControlled from '@/components/WhereLanguageControlled';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import { useJsonColumns } from '@/hooks/useMetadata';
import { withAppNav } from '@/layout';
import { buildCostExpression, getExpressions } from '@/llmDashboard';
import SearchInputV2 from '@/SearchInputV2';
import { useSource, useSources } from '@/source';
import { Histogram } from '@/SVGIcons';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

type AppliedConfig = {
  source?: string | null;
  service?: string | null;
  model?: string | null;
  where?: string | null;
  whereLanguage?: 'sql' | 'lucene' | null;
};

function getScopedFilters(
  source: TSource,
  appliedConfig: AppliedConfig,
): Filter[] {
  const expressions = getExpressions(source);
  const filters: Filter[] = [
    {
      type: 'sql',
      condition: expressions.isLLMSpan,
    },
  ];

  if (appliedConfig.service) {
    filters.push({
      type: 'sql',
      condition: `${expressions.service} IN ('${appliedConfig.service}')`,
    });
  }

  if (appliedConfig.model) {
    filters.push({
      type: 'sql',
      condition: `${expressions.genAiModel} IN ('${appliedConfig.model}')`,
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
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

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
    where: `${expressions.service} IS NOT NULL AND ${expressions.isLLMSpan}`,
    whereLanguage: 'sql' as const,
    limit: { limit: 200 },
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['llm-service-select', queriedConfig],
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

function ModelSelectControlled({
  sourceId,
  onCreate,
  ...props
}: {
  sourceId?: string;
  size?: string;
  onCreate?: () => void;
} & UseControllerProps<any>) {
  const { data: source } = useSource({ id: sourceId });
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const queriedConfig = {
    ...source,
    from: {
      databaseName: source?.from.databaseName || '',
      tableName: source?.from.tableName || '',
    },
    connection: source?.connection || '',
    select: [
      {
        alias: 'model',
        valueExpression: `distinct(${expressions.genAiModel})`,
      },
    ],
    where: `${expressions.genAiModel} IS NOT NULL AND ${expressions.isLLMSpan}`,
    whereLanguage: 'sql' as const,
    limit: { limit: 200 },
  };

  const { data, isLoading, isError } = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKey: ['llm-model-select', queriedConfig],
    enabled: !!source,
  });

  const values = useMemo(() => {
    const models = data?.data?.map((d: any) => d.model).filter(Boolean) || [];
    return [
      {
        value: '',
        label: 'All Models',
      },
      ...models,
    ];
  }, [data]);

  return (
    <SelectControlled
      {...props}
      data={values}
      disabled={isLoading || isError}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="All Models"
      maxDropdownHeight={280}
      onCreate={onCreate}
    />
  );
}

// Overview Tab Component
function OverviewTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const [latencyChartType, setLatencyChartType] = useState<
    'line' | 'histogram'
  >('line');

  const costExpression = buildCostExpression(
    expressions.genAiInputTokens,
    expressions.genAiOutputTokens,
    expressions.genAiModel,
  );

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      {/* KPI Cards */}
      <Grid.Col span={3}>
        <Card p="md" h={140}>
          <Text size="sm" c="dimmed" mb="xs">
            Total Requests
          </Text>
          {source && (
            <DBNumberChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    aggFn: 'count',
                    valueExpression: 'value',
                    alias: 'Total Requests',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
              }}
            />
          )}
        </Card>
      </Grid.Col>
      <Grid.Col span={3}>
        <Card p="md" h={140}>
          <Text size="sm" c="dimmed" mb="xs">
            Total Tokens
          </Text>
          {source && (
            <DBNumberChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    aggFn: 'sum',
                    valueExpression: expressions.totalTokens,
                    alias: 'Total Tokens',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
              }}
            />
          )}
        </Card>
      </Grid.Col>
      <Grid.Col span={3}>
        <Card p="md" h={140}>
          <Text size="sm" c="dimmed" mb="xs">
            Estimated Cost
          </Text>
          {source && (
            <DBNumberChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    aggFn: 'sum',
                    valueExpression: costExpression,
                    alias: 'Total Cost',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: CURRENCY_NUMBER_FORMAT,
              }}
            />
          )}
        </Card>
      </Grid.Col>
      <Grid.Col span={3}>
        <Card p="md" h={140}>
          <Text size="sm" c="dimmed" mb="xs">
            Avg Latency
          </Text>
          {source && (
            <DBNumberChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    aggFn: 'avg',
                    valueExpression: expressions.durationInMillis,
                    alias: 'Avg Latency',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: MS_NUMBER_FORMAT,
              }}
            />
          )}
        </Card>
      </Grid.Col>

      {/* Token Usage Over Time */}
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Token Usage Over Time</Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType: DisplayType.Line,
                select: [
                  {
                    alias: 'Input Tokens',
                    aggFn: 'sum',
                    valueExpression: expressions.genAiInputTokens,
                    aggCondition: '',
                  },
                  {
                    alias: 'Output Tokens',
                    aggFn: 'sum',
                    valueExpression: expressions.genAiOutputTokens,
                    aggCondition: '',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                numberFormat: INTEGER_NUMBER_FORMAT,
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>

      {/* Request Latency */}
      <Grid.Col span={6}>
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
            (latencyChartType === 'line' ? (
              <DBTimeChart
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
                  filters: getScopedFilters(source, appliedConfig),
                  numberFormat: MS_NUMBER_FORMAT,
                  dateRange: searchedTimeRange,
                }}
                showDisplaySwitcher={false}
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
                  filters: getScopedFilters(source, appliedConfig),
                  dateRange: searchedTimeRange,
                }}
              />
            ))}
        </ChartBox>
      </Grid.Col>

      {/* Cost Over Time */}
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Estimated Cost Over Time</Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType: DisplayType.Line,
                select: [
                  {
                    alias: 'Cost',
                    aggFn: 'sum',
                    valueExpression: costExpression,
                    aggCondition: '',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                numberFormat: CURRENCY_NUMBER_FORMAT,
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>

      {/* Error Rate Over Time */}
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Error Rate</Text>
          </Group>
          {source && (
            <DBTimeChart
              sourceId={source.id}
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                displayType: DisplayType.Line,
                select: [
                  {
                    valueExpression: `countIf(${expressions.isError}) / count()`,
                    alias: 'Error Rate %',
                  },
                ],
                numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// Models Tab Component
function ModelsTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const costExpression = buildCostExpression(
    expressions.genAiInputTokens,
    expressions.genAiOutputTokens,
    expressions.genAiModel,
  );

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Top Models by Token Usage</Text>
          </Group>
          {source && (
            <DBListBarChart
              groupColumn="Model"
              valueColumn="Total Tokens"
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Model',
                    valueExpression: expressions.genAiModel,
                  },
                  {
                    alias: 'Total Tokens',
                    aggFn: 'sum',
                    valueExpression: expressions.totalTokens,
                    aggCondition: '',
                  },
                ],
                selectGroupBy: false,
                groupBy: expressions.genAiModel,
                orderBy: '"Total Tokens" DESC',
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
                limit: { limit: 20 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Top Models by Cost</Text>
          </Group>
          {source && (
            <DBListBarChart
              groupColumn="Model"
              valueColumn="Cost"
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Model',
                    valueExpression: expressions.genAiModel,
                  },
                  {
                    alias: 'Cost',
                    aggFn: 'sum',
                    valueExpression: costExpression,
                    aggCondition: '',
                  },
                ],
                selectGroupBy: false,
                groupBy: expressions.genAiModel,
                orderBy: '"Cost" DESC',
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: CURRENCY_NUMBER_FORMAT,
                limit: { limit: 20 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Cost by Model Over Time</Text>
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
                    alias: 'Cost',
                    aggFn: 'sum',
                    valueExpression: costExpression,
                    aggCondition: '',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                numberFormat: CURRENCY_NUMBER_FORMAT,
                groupBy: expressions.genAiModel,
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Model Performance</Text>
          </Group>
          {source && (
            <DBTableChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Model',
                    valueExpression: expressions.genAiModel,
                  },
                  {
                    alias: 'Requests',
                    valueExpression: `count()`,
                  },
                  {
                    alias: 'Avg Latency (ms)',
                    valueExpression: `round(avg(${expressions.durationInMillis}), 2)`,
                  },
                  {
                    alias: 'P95 Latency (ms)',
                    valueExpression: `round(quantile(0.95)(${expressions.durationInMillis}), 2)`,
                  },
                  {
                    alias: 'Total Tokens',
                    valueExpression: `sum(${expressions.totalTokens})`,
                  },
                  {
                    alias: 'Estimated Cost',
                    valueExpression: `round(sum(${costExpression}), 4)`,
                  },
                  {
                    alias: 'Error Rate %',
                    valueExpression: `round(countIf(${expressions.isError}) / count() * 100, 2)`,
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                selectGroupBy: false,
                groupBy: expressions.genAiModel,
                dateRange: searchedTimeRange,
                orderBy: '"Requests" DESC',
                limit: { limit: 50 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// Users & Services Tab Component
function UsersServicesTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const costExpression = buildCostExpression(
    expressions.genAiInputTokens,
    expressions.genAiOutputTokens,
    expressions.genAiModel,
  );

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Top Services by Token Usage</Text>
          </Group>
          {source && (
            <DBTableChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Service',
                    valueExpression: expressions.service,
                  },
                  {
                    alias: 'Requests',
                    valueExpression: `count()`,
                  },
                  {
                    alias: 'Total Tokens',
                    valueExpression: `sum(${expressions.totalTokens})`,
                  },
                  {
                    alias: 'Input Tokens',
                    valueExpression: `sum(toFloat64OrNull(${expressions.genAiInputTokens}))`,
                  },
                  {
                    alias: 'Output Tokens',
                    valueExpression: `sum(toFloat64OrNull(${expressions.genAiOutputTokens}))`,
                  },
                  {
                    alias: 'Estimated Cost',
                    valueExpression: `round(sum(${costExpression}), 4)`,
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                selectGroupBy: false,
                groupBy: expressions.service,
                dateRange: searchedTimeRange,
                orderBy: '"Total Tokens" DESC',
                limit: { limit: 50 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Token Usage by Service Over Time</Text>
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
                    alias: 'Tokens',
                    aggFn: 'sum',
                    valueExpression: expressions.totalTokens,
                    aggCondition: '',
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                numberFormat: INTEGER_NUMBER_FORMAT,
                groupBy: expressions.service,
                dateRange: searchedTimeRange,
              }}
              showDisplaySwitcher={false}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Top Users by Token Usage</Text>
          </Group>
          {source && (
            <DBTableChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'User ID',
                    valueExpression: `if(${expressions.userId} != '', ${expressions.userId}, 'Unknown')`,
                  },
                  {
                    alias: 'Requests',
                    valueExpression: `count()`,
                  },
                  {
                    alias: 'Total Tokens',
                    valueExpression: `sum(${expressions.totalTokens})`,
                  },
                  {
                    alias: 'Estimated Cost',
                    valueExpression: `round(sum(${costExpression}), 4)`,
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                selectGroupBy: false,
                groupBy: `if(${expressions.userId} != '', ${expressions.userId}, 'Unknown')`,
                dateRange: searchedTimeRange,
                orderBy: '"Total Tokens" DESC',
                limit: { limit: 50 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

// Operations Tab Component
function OperationsTab({
  searchedTimeRange,
  appliedConfig,
}: {
  searchedTimeRange: [Date, Date];
  appliedConfig: AppliedConfig;
}) {
  const { data: source } = useSource({ id: appliedConfig.source });
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  return (
    <Grid mt="md" grow={false} w="100%" maw="100%" overflow="hidden">
      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Requests by Operation Type</Text>
          </Group>
          {source && (
            <DBListBarChart
              groupColumn="Operation"
              valueColumn="Count"
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Operation',
                    valueExpression: `if(${expressions.genAiOperationName} != '', ${expressions.genAiOperationName}, 'Unknown')`,
                  },
                  {
                    alias: 'Count',
                    aggFn: 'count',
                    valueExpression: 'value',
                    aggCondition: '',
                  },
                ],
                selectGroupBy: false,
                groupBy: `if(${expressions.genAiOperationName} != '', ${expressions.genAiOperationName}, 'Unknown')`,
                orderBy: '"Count" DESC',
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
                limit: { limit: 20 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={6}>
        <ChartBox style={{ height: 350, overflow: 'auto' }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Requests by Provider</Text>
          </Group>
          {source && (
            <DBListBarChart
              groupColumn="Provider"
              valueColumn="Count"
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Provider',
                    valueExpression: `if(${expressions.genAiSystem} != '', ${expressions.genAiSystem}, 'Unknown')`,
                  },
                  {
                    alias: 'Count',
                    aggFn: 'count',
                    valueExpression: 'value',
                    aggCondition: '',
                  },
                ],
                selectGroupBy: false,
                groupBy: `if(${expressions.genAiSystem} != '', ${expressions.genAiSystem}, 'Unknown')`,
                orderBy: '"Count" DESC',
                filters: getScopedFilters(source, appliedConfig),
                dateRange: searchedTimeRange,
                numberFormat: INTEGER_NUMBER_FORMAT,
                limit: { limit: 20 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Failed Requests</Text>
          </Group>
          {source && (
            <DBTableChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Service',
                    valueExpression: expressions.service,
                  },
                  {
                    alias: 'Model',
                    valueExpression: expressions.genAiModel,
                  },
                  {
                    alias: 'Operation',
                    valueExpression: `if(${expressions.genAiOperationName} != '', ${expressions.genAiOperationName}, 'Unknown')`,
                  },
                  {
                    alias: 'Error Count',
                    valueExpression: `count()`,
                  },
                  {
                    alias: 'Finish Reason',
                    valueExpression: `if(${expressions.genAiFinishReason} != '', ${expressions.genAiFinishReason}, 'Unknown')`,
                  },
                ],
                filters: [
                  ...getScopedFilters(source, appliedConfig),
                  {
                    type: 'sql',
                    condition: expressions.isError,
                  },
                ],
                selectGroupBy: false,
                groupBy: `${expressions.service}, ${expressions.genAiModel}, if(${expressions.genAiOperationName} != '', ${expressions.genAiOperationName}, 'Unknown'), if(${expressions.genAiFinishReason} != '', ${expressions.genAiFinishReason}, 'Unknown')`,
                dateRange: searchedTimeRange,
                orderBy: '"Error Count" DESC',
                limit: { limit: 50 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>

      <Grid.Col span={12}>
        <ChartBox style={{ height: 350 }}>
          <Group justify="space-between" align="center" mb="sm">
            <Text size="sm">Finish Reasons Distribution</Text>
          </Group>
          {source && (
            <DBTableChart
              config={{
                ...source,
                where: appliedConfig.where || '',
                whereLanguage: appliedConfig.whereLanguage || 'sql',
                select: [
                  {
                    alias: 'Finish Reason',
                    valueExpression: `if(${expressions.genAiFinishReason} != '', ${expressions.genAiFinishReason}, 'Unknown')`,
                  },
                  {
                    alias: 'Count',
                    valueExpression: `count()`,
                  },
                  {
                    alias: 'Percentage',
                    valueExpression: `round(count() / (SELECT count() FROM ${source.from.databaseName}.${source.from.tableName} WHERE ${expressions.isLLMSpan}) * 100, 2)`,
                  },
                ],
                filters: getScopedFilters(source, appliedConfig),
                selectGroupBy: false,
                groupBy: `if(${expressions.genAiFinishReason} != '', ${expressions.genAiFinishReason}, 'Unknown')`,
                dateRange: searchedTimeRange,
                orderBy: '"Count" DESC',
                limit: { limit: 50 },
              }}
            />
          )}
        </ChartBox>
      </Grid.Col>
    </Grid>
  );
}

const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];

const appliedConfigMap = {
  source: parseAsString,
  where: parseAsString,
  service: parseAsString,
  model: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};

function LLMDashboardPage() {
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringEnum<string>([
      'overview',
      'models',
      'users',
      'operations',
    ]).withDefault('overview'),
  );

  const { data: sources } = useSources();

  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);
  const { control, watch, setValue, handleSubmit } = useForm({
    values: {
      where: '',
      whereLanguage: 'sql' as 'sql' | 'lucene',
      service: appliedConfig?.service || '',
      model: appliedConfig?.model || '',
      source:
        appliedConfig?.source ||
        sources?.find(s => s.kind === 'trace')?.id ||
        sources?.[0]?.id,
    },
  });

  const service = watch('service');
  const model = watch('model');
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

  // Auto submit when service, model, or source changes
  useEffect(() => {
    if (
      service !== appliedConfig.service ||
      model !== appliedConfig.model ||
      sourceId !== appliedConfig.source
    ) {
      onSubmit();
    }
  }, [service, model, sourceId]);

  return (
    <Box p="sm">
      <OnboardingModal requireSource={false} />
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
            />
            <ModelSelectControlled
              sourceId={sourceId}
              control={control}
              name="model"
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
          defaultValue="overview"
          onChange={setTab}
          value={tab}
        >
          <Tabs.List>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="models">Models</Tabs.Tab>
            <Tabs.Tab value="users">Users & Services</Tabs.Tab>
            <Tabs.Tab value="operations">Operations</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview">
            <OverviewTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="models">
            <ModelsTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="users">
            <UsersServicesTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
          <Tabs.Panel value="operations">
            <OperationsTab
              appliedConfig={appliedConfig}
              searchedTimeRange={searchedTimeRange}
            />
          </Tabs.Panel>
        </Tabs>
      )}
    </Box>
  );
}

const LLMDashboardPageDynamic = dynamic(async () => LLMDashboardPage, {
  ssr: false,
});

// @ts-expect-error
LLMDashboardPageDynamic.getLayout = withAppNav;

export default LLMDashboardPageDynamic;
