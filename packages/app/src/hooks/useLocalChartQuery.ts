import { useMemo } from 'react';
import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import { unquoteIdentifier } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FIXED_TIME_BUCKET_EXPR_ALIAS,
  isMetricChartConfig,
  isNonEmptyWhereExpr,
  isRatioChartConfig,
  isUsingGroupBy,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  escapeSqlString,
  hasPositiveSeriesLimit,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  ChartConfigWithOptTimestamp,
  SortSpecificationList,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import api from '@/api';
import { convertToSharedTimeChartConfig } from '@/ChartUtils';
import { getChdb, IS_CHDB_AVAILABLE, queryChdbRows } from '@/chdb';
import { BASE_PATH } from '@/config';
import {
  getMinGranularitySeconds,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { useSource } from '@/source';
import { ChartQueryResult } from '@/types';

/** How a chart collapses the time chart's rows: to one row, or one per group. */
export type LocalChartKind = 'number' | 'table' | 'categorical';

// Aggregations whose per-bucket values combine into the exact whole-range
// value. Charts using any other (avg, quantile, count distinct...) query remotely.
const REAGGREGATE_FNS = new Map([
  ['count', 'sum'],
  ['sum', 'sum'],
  ['min', 'min'],
  ['max', 'max'],
  ['any', 'any'],
]);

const quoteIdentifier = (name: string) =>
  `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;

/**
 * The time chart's query. Charts that re-aggregate its cached result in chdb
 * (useLocalChartQuery) must build the exact same key.
 */
export function useTimeChartQuery(
  config: ChartConfigWithOptDateRange,
  {
    queryKeyPrefix,
    enabled = true,
    disableQueryChunking,
    enableParallelQueries,
  }: {
    queryKeyPrefix?: string;
    enabled?: boolean;
    disableQueryChunking?: boolean;
    enableParallelQueries?: boolean;
  },
) {
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  return useQueriedChartConfig(config, {
    placeholderData: prev => prev,
    // Switching display type mounts a new chart on the cached result, which
    // must not query again. A new date range is a new key, so it still does.
    refetchOnMount: false,
    queryKey: [
      queryKeyPrefix,
      config,
      'chunked',
      {
        disableQueryChunking,
        enableParallelQueries,
        parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
      },
    ],
    enabled: enabled && !isLoadingMe,
    enableQueryChunking: !disableQueryChunking,
    enableParallelQueries:
      enableParallelQueries && me?.team?.parallelizeWhenPossible,
  });
}

/**
 * The time chart query that a chart's result can be rebuilt from exactly, and
 * the function that re-aggregates each of its value columns. Undefined when
 * the result can't be rebuilt.
 */
export function getLocalTransform(
  config: ChartConfigWithOptTimestamp,
  minGranularitySeconds?: number,
) {
  if (
    !isBuilderChartConfig(config) ||
    config.timestampValueExpression == null ||
    !Array.isArray(config.select) ||
    isMetricChartConfig(config) ||
    config.formulas?.length ||
    isRatioChartConfig(config.select, config) ||
    isNonEmptyWhereExpr(config.having) ||
    config.selectGroupBy === false ||
    // The time chart then keeps only its top series, dropping groups.
    (hasPositiveSeriesLimit(config.seriesLimit) && isUsingGroupBy(config))
  ) {
    return undefined;
  }
  const reaggregateFns = config.select.flatMap(({ aggFn }) => {
    const fn = aggFn != null ? REAGGREGATE_FNS.get(aggFn) : undefined;
    return fn != null ? [fn] : [];
  });
  if (
    reaggregateFns.length === 0 ||
    reaggregateFns.length !== config.select.length
  ) {
    return undefined;
  }
  const timeConfig = convertToSharedTimeChartConfig({
    ...config,
    timestampValueExpression: config.timestampValueExpression,
    minGranularitySeconds,
  });
  return isBuilderChartConfig(timeConfig)
    ? { reaggregateFns, timeConfig }
    : undefined;
}

// Only result columns can be ordered by: an expression could mean something
// else over the time chart's rows than in the remote query.
function toLocalOrderBy(
  orderBy: SortSpecificationList | undefined,
  columns: string[],
): string[] {
  const items: { valueExpression: string; ordering?: string }[] =
    typeof orderBy === 'string'
      ? splitAndTrimWithBracket(orderBy).map(item => {
          const [, valueExpression = item, ordering] =
            /^(.+?)(?:\s+(asc|desc))?$/is.exec(item) ?? [];
          return { valueExpression, ordering: ordering?.toUpperCase() };
        })
      : (orderBy ?? []);
  return items.map(({ valueExpression, ordering }) => {
    const column = unquoteIdentifier(valueExpression.trim());
    if (!columns.includes(column)) {
      throw new Error(`Can't order the local result by ${valueExpression}`);
    }
    return `${quoteIdentifier(column)} ${ordering === 'DESC' ? 'DESC' : 'ASC'}`;
  });
}

/**
 * SQL that collapses the time chart's rows, read from `file`, into the rows
 * the chart would have queried remotely: one per group, or one for a number.
 */
export function buildLocalChartSql({
  file,
  meta,
  reaggregateFns,
  kind,
  orderBy,
  limit,
}: {
  file: string;
  meta: ColumnMetaType[];
  reaggregateFns: string[];
  kind: LocalChartKind;
  orderBy?: SortSpecificationList;
  limit?: number;
}): string {
  // The time chart selects its values, then its group-by columns, then the bucket.
  const values = meta.slice(0, reaggregateFns.length).map(({ name }) => name);
  const groups =
    kind === 'number'
      ? []
      : meta
          .slice(reaggregateFns.length)
          .map(({ name }) => name)
          .filter(name => name !== FIXED_TIME_BUCKET_EXPR_ALIAS);
  const groupIds = groups.map(quoteIdentifier);
  const structure = meta
    .map(({ name, type }) => `${quoteIdentifier(name)} ${type}`)
    .join(', ');

  const userOrder = toLocalOrderBy(orderBy, [...values, ...groups]);
  // Mirrors the defaults of convertToTableChartConfig and
  // convertToCategoricalChartConfig.
  const order =
    userOrder.length > 0
      ? userOrder
      : kind === 'table'
        ? groupIds
        : kind === 'categorical'
          ? [`${quoteIdentifier(values[0])} DESC`, ...groupIds]
          : [];

  return [
    `SELECT ${[
      ...values.map(
        (name, i) =>
          `${reaggregateFns[i]}(${quoteIdentifier(name)}) AS ${quoteIdentifier(name)}`,
      ),
      ...groupIds,
    ].join(', ')}`,
    `FROM file('${escapeSqlString(file)}', 'JSONEachRow', '${escapeSqlString(structure)}')`,
    groupIds.length > 0 ? `GROUP BY ${groupIds.join(', ')}` : '',
    order.length > 0 ? `ORDER BY ${order.join(', ')}` : '',
    limit != null && Number.isInteger(limit) && limit > 0
      ? `LIMIT ${limit}`
      : '',
    // Like the remote client, keep 64-bit integers exact in JS
    'SETTINGS output_format_json_quote_64bit_integers = 1',
  ]
    .filter(Boolean)
    .join(' ');
}

type LocalChartQueryOptions = {
  kind: LocalChartKind;
  orderBy?: SortSpecificationList;
  limit?: number;
  queryKeyPrefix?: string;
  enabled?: boolean;
};

type LocalChartQueryResult = {
  /** False when the chart has to query remotely instead. */
  active: boolean;
  data: ChartQueryResult | undefined;
  isLoading: boolean;
  isPlaceholderData: boolean;
  isError: false;
  error: null;
};

function useLocalChartQueryInBrowser(
  config: ChartConfigWithOptTimestamp,
  {
    kind,
    orderBy,
    limit,
    queryKeyPrefix,
    enabled = true,
  }: LocalChartQueryOptions,
): LocalChartQueryResult {
  const { data: source } = useSource({ id: config.source });
  const minGranularitySeconds = getMinGranularitySeconds(source);
  const transform = useMemo(
    () => getLocalTransform(config, minGranularitySeconds),
    [config, minGranularitySeconds],
  );

  const chdb = useQuery({
    queryKey: ['chdb'],
    queryFn: () => getChdb(BASE_PATH),
    enabled: transform != null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const canRunLocally = transform != null && !chdb.isError;

  const timeSeries = useTimeChartQuery(transform?.timeConfig ?? config, {
    queryKeyPrefix,
    enabled: enabled && canRunLocally,
  });

  const result = useQuery<ChartQueryResult>({
    queryKey: [
      'chdb-transform',
      transform?.timeConfig,
      timeSeries.dataUpdatedAt,
      kind,
      orderBy,
      limit,
    ],
    queryFn: async () => {
      const rows = timeSeries.data?.data;
      const meta = timeSeries.data?.meta;
      if (transform == null || chdb.data == null || !rows || !meta) {
        throw new Error('The time chart result is not ready');
      }
      if (rows.length >= (transform.timeConfig.limit?.limit ?? Infinity)) {
        throw new Error('The time chart result may be truncated');
      }
      const response = await queryChdbRows(chdb.data, rows, file =>
        buildLocalChartSql({
          file,
          meta,
          reaggregateFns: transform.reaggregateFns,
          kind,
          orderBy,
          limit,
        }),
      );
      return {
        data: response.data,
        meta: response.meta,
        rows: response.rows,
        isComplete: true,
      };
    },
    enabled:
      enabled &&
      canRunLocally &&
      chdb.data != null &&
      timeSeries.data?.isComplete === true &&
      !timeSeries.isPlaceholderData,
    placeholderData: prev => prev,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    // Any failure falls back to the remote query, which reports its own errors.
    active: canRunLocally && !timeSeries.isError && !result.isError,
    data: result.data,
    isLoading: enabled && result.data == null,
    isPlaceholderData: result.isPlaceholderData,
    isError: false,
    error: null,
  };
}

const NOT_LOCAL: LocalChartQueryResult = {
  active: false,
  data: undefined,
  isLoading: false,
  isPlaceholderData: false,
  isError: false,
  error: null,
};

const notLocal = (): LocalChartQueryResult => NOT_LOCAL;

/**
 * Builds a table, number, pie or bar chart's result in chdb from the time
 * chart query's cached result, so switching between those display types never
 * queries the remote ClickHouse again. When `active` is false, the chart must
 * run its own remote query.
 */
export const useLocalChartQuery: (
  config: ChartConfigWithOptTimestamp,
  options: LocalChartQueryOptions,
) => LocalChartQueryResult = IS_CHDB_AVAILABLE
  ? useLocalChartQueryInBrowser
  : notLocal;
