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
 * Two live search tiles: LLM trace spans and correlated LLM log events. When
 * the session filter is set, both tiles narrow to that session — the
 * correlation surface for instrumentations that stamp a session id but don't
 * propagate trace context. Row clicks open the standard row side panel
 * (including the LLM conversation tab).
 */
export function SearchTilesTab(props: LLMChartProps) {
  const { source, logSource, logExpressions, sessionId, where, whereLanguage } =
    props;

  const traceConfig = {
    // Row search never references the cost alias; skip the WITH binding.
    ...baseLLMChartConfig({ ...props, withCostAlias: false }),
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
          <ChartContainer title="LLM trace spans" disableReactiveContainer>
            <DBSqlRowTableWithSideBar
              sourceId={source.id}
              config={traceConfig}
              isLive={false}
              queryKeyPrefix="llm-search-traces"
              variant="default"
              errorVariant="collapsible"
            />
          </ChartContainer>
        </ChartCard>
      </Grid.Col>
      {logConfig != null && (
        <Grid.Col span={12}>
          <ChartCard style={{ height: TILE_HEIGHT }}>
            <ChartContainer title="LLM log events" disableReactiveContainer>
              <DBSqlRowTableWithSideBar
                sourceId={logConfig.source}
                config={logConfig}
                isLive={false}
                queryKeyPrefix="llm-search-logs"
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
            Select a log source to also show correlated LLM log events.
          </Text>
        </Grid.Col>
      )}
    </Grid>
  );
}
