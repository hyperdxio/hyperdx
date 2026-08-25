import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { Grid } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartCard } from '@/components/charts/ChartCard';
import DBTableChart from '@/components/DBTableChart';

import { baseLLMChartConfig, buildLLMSearchUrl } from './chartConfig';
import {
  COST_USD_NUMBER_FORMAT,
  LLMChartProps,
  TOKEN_NUMBER_FORMAT,
} from './types';

const CHART_HEIGHT = 320;

/**
 * Attribution & debugging tables: LLM usage per end user (user.email,
 * enduser.id, SDK metadata) and the top error messages with occurrence
 * counts.
 */
export function AttributionCharts(props: LLMChartProps) {
  const { source, expressions, dateRange } = props;
  const base = baseLLMChartConfig(props);

  const getUserSearchLink = useCallback(
    (row: Record<string, unknown>) =>
      buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          SqlString.format('? = ?', [
            SqlString.raw(expressions.userId),
            String(row['User'] ?? ''),
          ]),
        ],
      }),
    [source, expressions, dateRange],
  );

  const getErrorSearchLink = useCallback(
    (row: Record<string, unknown>) => {
      const message = String(row['Error'] ?? '');
      return buildLLMSearchUrl({
        source,
        expressions,
        dateRange,
        extraConditions: [
          expressions.isError,
          // '(no message)' is the table's display fallback for empty values.
          SqlString.format('? = ?', [
            SqlString.raw(expressions.statusMessage),
            message === '(no message)' ? '' : message,
          ]),
        ],
      });
    },
    [source, expressions, dateRange],
  );

  return (
    <>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTableChart
            title="Top Users"
            getRowSearchLink={getUserSearchLink}
            config={{
              ...base,
              filters: [
                ...base.filters,
                { type: 'sql', condition: expressions.hasUserId },
              ],
              groupBy: 'User',
              selectGroupBy: false,
              orderBy: '"Est. Cost" DESC',
              select: [
                { alias: 'User', valueExpression: expressions.userId },
                {
                  alias: 'Calls',
                  aggFn: 'count',
                  valueExpression: '',
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'Total Tokens',
                  aggFn: 'sum',
                  valueExpression: expressions.totalTokens,
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
                  numberFormat: TOKEN_NUMBER_FORMAT,
                },
                {
                  alias: 'Est. Cost',
                  aggFn: 'sum',
                  valueExpression: expressions.costUsd,
                  aggCondition: expressions.hasReportedTokens,
                  aggConditionLanguage: 'sql',
                  numberFormat: COST_USD_NUMBER_FORMAT,
                },
              ],
              limit: { limit: 50 },
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={6}>
        <ChartCard style={{ height: CHART_HEIGHT }}>
          <DBTableChart
            title="Top Error Messages"
            getRowSearchLink={getErrorSearchLink}
            hiddenColumns={['last_seen_ts']}
            config={{
              ...base,
              filters: [
                ...base.filters,
                { type: 'sql', condition: expressions.isError },
              ],
              groupBy: 'Error',
              selectGroupBy: false,
              orderBy: '"Count" DESC',
              select: [
                {
                  alias: 'Error',
                  valueExpression: `coalesce(nullif(${expressions.statusMessage}, ''), '(no message)')`,
                },
                {
                  alias: 'Count',
                  aggFn: 'count',
                  valueExpression: '',
                  numberFormat: INTEGER_NUMBER_FORMAT,
                },
                {
                  alias: 'last_seen_ts',
                  valueExpression: `max(${source.timestampValueExpression})`,
                },
                {
                  alias: 'Last Seen',
                  valueExpression: 'toString(last_seen_ts)',
                },
              ],
              limit: { limit: 50 },
            }}
          />
        </ChartCard>
      </Grid.Col>
    </>
  );
}
