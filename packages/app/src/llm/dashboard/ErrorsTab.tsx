import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import {
  Filter,
  pickSampleWeightExpressionProps,
} from '@hyperdx/common-utils/dist/types';
import { Grid, Text } from '@mantine/core';

import { ChartCard } from '@/components/charts/ChartCard';
import ChartContainer from '@/components/charts/ChartContainer';
import DBSqlRowTableWithSideBar from '@/components/DBSqlRowTableWithSidebar';

import { baseLLMChartConfig, buildSessionCondition } from './chartConfig';
import { LLMChartProps } from './types';

const TILE_HEIGHT = 450;

/**
 * Two live error-row tiles: LLM trace spans with an error status and
 * correlated error-severity LLM log events. The top-bar where/session/time
 * scoping applies, so this doubles as a filterable error browser. Row
 * clicks open the standard row side panel.
 */
export function ErrorsTab(props: LLMChartProps) {
  const {
    source,
    expressions,
    logSource,
    logExpressions,
    sessionId,
    where,
    whereLanguage,
  } = props;

  const traceConfig = {
    // Row search never references the cost alias; skip the WITH binding.
    ...baseLLMChartConfig({
      ...props,
      withCostAlias: false,
      extraFilters: [{ type: 'sql' as const, condition: expressions.isError }],
    }),
    select: source.defaultTableSelectExpression || '',
    orderBy: [
      {
        ordering: 'DESC' as const,
        valueExpression: getFirstTimestampValueExpression(
          source.timestampValueExpression,
        ),
      },
    ],
  };

  const logFilters: Filter[] =
    logExpressions != null
      ? [
          { type: 'sql', condition: logExpressions.isLLMRelated },
          { type: 'sql', condition: logExpressions.isError },
          ...(sessionId
            ? [
                {
                  type: 'sql' as const,
                  condition: buildSessionCondition(
                    logExpressions.sessionId,
                    sessionId,
                  ),
                },
              ]
            : []),
        ]
      : [];

  const logConfig =
    logSource != null && logExpressions != null
      ? {
          source: logSource.id,
          timestampValueExpression: logSource.timestampValueExpression,
          connection: logSource.connection,
          from: logSource.from,
          implicitColumnExpression: logSource.implicitColumnExpression,
          useTextIndexForImplicitColumn:
            logSource.useTextIndexForImplicitColumn,
          bodyExpression: logSource.bodyExpression,
          ...pickSampleWeightExpressionProps(logSource),
          where,
          whereLanguage,
          filters: logFilters,
          dateRange: props.dateRange,
          select: logSource.defaultTableSelectExpression || '',
          orderBy: [
            {
              ordering: 'DESC' as const,
              valueExpression: getFirstTimestampValueExpression(
                logSource.timestampValueExpression,
              ),
            },
          ],
        }
      : null;

  return (
    <Grid grow={false} w="100%" maw="100%">
      <Grid.Col span={12}>
        <ChartCard style={{ height: TILE_HEIGHT }}>
          <ChartContainer title="Error trace spans" disableReactiveContainer>
            <DBSqlRowTableWithSideBar
              sourceId={source.id}
              config={traceConfig}
              isLive={false}
              queryKeyPrefix="llm-errors-traces"
              variant="default"
              errorVariant="collapsible"
            />
          </ChartContainer>
        </ChartCard>
      </Grid.Col>
      {logConfig != null && (
        <Grid.Col span={12}>
          <ChartCard style={{ height: TILE_HEIGHT }}>
            <ChartContainer title="Error log events" disableReactiveContainer>
              <DBSqlRowTableWithSideBar
                sourceId={logConfig.source}
                config={logConfig}
                isLive={false}
                queryKeyPrefix="llm-errors-logs"
                variant="default"
                errorVariant="collapsible"
              />
            </ChartContainer>
          </ChartCard>
        </Grid.Col>
      )}
      {logConfig == null && (
        <Grid.Col span={12}>
          <Text size="xs" c="dimmed">
            Select a log source to also show correlated error log events.
          </Text>
        </Grid.Col>
      )}
    </Grid>
  );
}
