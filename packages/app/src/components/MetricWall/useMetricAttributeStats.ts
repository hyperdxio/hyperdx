import { subHours } from 'date-fns';
import {
  ChSql,
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { getMetricTableName } from '@/utils';
import { QUERYABLE_KINDS } from '@/utils/metricKinds';

const MAX_EXEC_SECONDS = 8;
const MAX_VALUES = 20;
const MAX_SPLIT_KEYS = 30;
const WINDOW_HOURS = 1;

function recentWindow(dateRange: [Date, Date]): [Date, Date] {
  const end = dateRange[1];
  const start = subHours(end, WINDOW_HOURS);
  return [start > dateRange[0] ? start : dateRange[0], end];
}

function timeFilter(source: TMetricSource, [start, end]: [Date, Date]) {
  const ts = source.timestampValueExpression || 'TimeUnix';
  return chSql`${{ Identifier: ts }} >= fromUnixTimestamp64Milli(${{ Int64: start.getTime() }})
    AND ${{ Identifier: ts }} <= fromUnixTimestamp64Milli(${{ Int64: end.getTime() }})`;
}

async function runQuery<T>(
  source: TMetricSource,
  sql: ChSql,
  signal: AbortSignal,
): Promise<T[]> {
  const result = (await getClickhouseClient()
    .query<'JSON'>({
      query: sql.sql,
      query_params: sql.params,
      format: 'JSON',
      abort_signal: signal,
      connectionId: source.connection,
      clickhouse_settings: {
        max_execution_time: MAX_EXEC_SECONDS,
        timeout_overflow_mode: 'break',
      },
    })
    .then(res => res.json())) as ResponseJSON<T>;
  return result?.data ?? [];
}

const valueExpr = (key: string) =>
  chSql`if(ResourceAttributes[${{ String: key }}] != '', ResourceAttributes[${{ String: key }}], Attributes[${{ String: key }}])`;

/**
 * The values of one attribute across every metric, with how many metrics
 * report each. Only loads for the attribute the rail has open.
 */
export function useAttributeValueCounts({
  source,
  attributeKey,
  dateRange,
}: {
  source: TMetricSource;
  attributeKey?: string;
  dateRange: [Date, Date];
}) {
  const range = recentWindow(dateRange);
  return useQuery({
    queryKey: [
      'metric-wall-attribute-values',
      source.id,
      attributeKey,
      range[0].getTime(),
      range[1].getTime(),
    ],
    queryFn: async ({ signal }) => {
      const counts = new Map<string, number>();
      const settled = await Promise.allSettled(
        QUERYABLE_KINDS.flatMap(kind => {
          const table = source.metricTables?.[kind];
          if (!table || !attributeKey) return [];
          const value = valueExpr(attributeKey);
          return [
            runQuery<{ value: string; metrics: string }>(
              source,
              chSql`
                SELECT ${value} AS value, uniq(MetricName) AS metrics
                FROM ${tableExpr({ database: source.from.databaseName, table })}
                WHERE ${timeFilter(source, range)} AND ${value} != ''
                GROUP BY value
                ORDER BY metrics DESC
                LIMIT ${{ Int32: MAX_VALUES }}
              `,
              signal,
            ),
          ];
        }),
      );
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const row of result.value) {
          counts.set(
            row.value,
            (counts.get(row.value) ?? 0) + Number(row.metrics),
          );
        }
      }
      return Array.from(counts, ([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_VALUES);
    },
    enabled: !!attributeKey,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Every attribute one metric carries, with its distinct value count, so the
 * split chips can say how many series each one would draw.
 */
export function useSplitCardinality({
  source,
  metricName,
  metricType,
  dateRange,
}: {
  source: TMetricSource;
  metricName: string;
  metricType: MetricsDataType;
  dateRange: [Date, Date];
}) {
  const range = recentWindow(dateRange);
  const table = getMetricTableName(source, metricType);
  return useQuery({
    queryKey: [
      'metric-wall-split-cardinality',
      source.id,
      metricType,
      metricName,
      range[0].getTime(),
      range[1].getTime(),
    ],
    queryFn: async ({ signal }) => {
      const rows = await runQuery<{ key: string; n: string }>(
        source,
        chSql`
          SELECT kv.1 AS key, uniq(kv.2) AS n
          FROM ${tableExpr({ database: source.from.databaseName, table: table ?? '' })}
          ARRAY JOIN arrayConcat(
            arrayZip(mapKeys(ResourceAttributes), mapValues(ResourceAttributes)),
            arrayZip(mapKeys(Attributes), mapValues(Attributes))
          ) AS kv
          WHERE MetricName = ${{ String: metricName }} AND ${timeFilter(source, range)}
          GROUP BY key
          ORDER BY n ASC
          LIMIT ${{ Int32: MAX_SPLIT_KEYS }}
        `,
        signal,
      );
      return rows
        .map(row => ({ key: row.key, values: Number(row.n) }))
        .filter(row => row.values > 1);
    },
    enabled: !!table,
    staleTime: 1000 * 60 * 5,
  });
}
