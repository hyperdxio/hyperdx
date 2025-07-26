import { TSource } from '@hyperdx/common-utils/dist/types';
import { Group, Text } from '@mantine/core';

import { MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import DBListBarChart from '@/components/DBListBarChart';
import { useJsonColumns } from '@/hooks/useMetadata';
import { getExpressions } from '@/serviceDashboard';

const MAX_NUM_GROUPS = 200;

export default function ServiceDashboardEndpointPerformanceChart({
  source,
  dateRange,
  service,
  endpoint,
}: {
  source?: TSource;
  dateRange: [Date, Date];
  service?: string;
  endpoint?: string;
}) {
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  if (!source) {
    return null;
  }

  const parentSpanWhereCondition = [
    service && `${expressions.service} = '${service}'`,
    endpoint && `${expressions.spanName} = '${endpoint}'`,
    // Ideally should use `timeFilterExpr`, but it returns chSql while filter.condition is string
    `${source.timestampValueExpression} >=
        fromUnixTimestamp64Milli(${dateRange[0].getTime()}) AND
      ${source.timestampValueExpression} <=
        fromUnixTimestamp64Milli(${dateRange[1].getTime()})`,
  ]
    .filter(Boolean)
    .join(' AND ');

  const selectTraceIdsSql = `SELECT distinct ${expressions.traceId}
    FROM ${source.from.databaseName}.${source.from.tableName}
    WHERE ${parentSpanWhereCondition}
    `;

  let spanNameColSql = `
    concat(
      ${expressions.spanName}, ' ',
      if(
        has(['HTTP DELETE', 'DELETE', 'HTTP GET', 'GET', 'HTTP HEAD', 'HEAD', 'HTTP OPTIONS', 'OPTIONS', 'HTTP PATCH', 'PATCH', 'HTTP POST', 'POST', 'HTTP PUT', 'PUT'], ${expressions.spanName}),
          COALESCE(
            NULLIF(${expressions.serverAddress}, ''),
            NULLIF(${expressions.httpHost}, '')
          ),
          ''
    ));`;

  const spanAttributesExpression =
    source.eventAttributesExpression || 'SpanAttributes';

  // ClickHouse does not support NULLIF(some_dynamic_column)
  // so we instead use toString() and an empty string check to check for
  // existence of the serverAddress/httpHost to build the span name
  if (jsonColumns.includes(spanAttributesExpression)) {
    spanNameColSql = `
    concat(
      ${expressions.spanName}, ' ',
      if(
        has(['HTTP DELETE', 'DELETE', 'HTTP GET', 'GET', 'HTTP HEAD', 'HEAD', 'HTTP OPTIONS', 'OPTIONS', 'HTTP PATCH', 'PATCH', 'HTTP POST', 'POST', 'HTTP PUT', 'PUT'], ${expressions.spanName}),
        if(
            toString(${expressions.serverAddress}) != '',
            toString(${expressions.serverAddress}),
            if(
              toString(${expressions.httpHost}) != '', 
              toString(${expressions.httpHost}), 
              ''
            )
          ),
        ''
    ))`;
  }

  return (
    <ChartBox style={{ height: 350, overflow: 'auto' }}>
      <Group justify="space-between" align="center" mb="sm">
        <Text size="sm" c="gray.4">
          20 Top Most Time Consuming Operations
        </Text>
      </Group>
      {source && (
        <DBListBarChart
          groupColumn="group"
          valueColumn="Total Time Spent"
          config={{
            ...source,
            where: '',
            whereLanguage: 'sql',
            select: [
              {
                alias: 'group',
                valueExpression: spanNameColSql,
              },
              {
                alias: 'Total Time Spent',
                aggFn: 'sum',
                aggCondition: '',
                valueExpression: expressions.durationInMillis,
              },
              {
                alias: 'Number of Calls',
                valueExpression: 'count()',
              },
              {
                alias: 'Average Duration',
                aggFn: 'avg',
                aggCondition: '',
                valueExpression: expressions.durationInMillis,
              },
              {
                alias: 'Min Duration',
                aggFn: 'min',
                aggCondition: '',
                valueExpression: expressions.durationInMillis,
              },
              {
                alias: 'Max Duration',
                aggFn: 'max',
                aggCondition: '',
                valueExpression: expressions.durationInMillis,
              },
              {
                alias: 'Number of Requests',
                aggFn: 'count_distinct',
                aggCondition: '',
                valueExpression: expressions.traceId,
              },
              {
                alias: 'Calls per Request',
                valueExpression: '"Number of Calls" / "Average Duration"',
              },
            ],
            selectGroupBy: false,
            groupBy: 'group',
            orderBy: '"Total Time Spent" DESC',
            filters: [
              ...(service
                ? [
                    {
                      type: 'sql' as const,
                      condition: `${expressions.service} = '${service}'`,
                    },
                  ]
                : []),
              {
                type: 'sql',
                condition: `${expressions.traceId} IN (${selectTraceIdsSql})`,
              },
              {
                type: 'sql',
                condition: `${expressions.duration} >= 0 AND ${expressions.spanName} != '${endpoint}'`,
              },
            ],
            numberFormat: MS_NUMBER_FORMAT,
            dateRange,
            limit: {
              limit: MAX_NUM_GROUPS,
            },
          }}
        />
      )}
    </ChartBox>
  );
}
