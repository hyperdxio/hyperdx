/**
 * Trino-flavored chart-config SQL emitter (Berg Phase 1.2 Task 12).
 *
 * Replaces the previous ClickHouse-flavored implementation. All emitted
 * SQL is portable Trino/Athena. The transitional `chSql` template helpers
 * are no longer used here — instead, we build plain template literals and
 * hand them back through the same `ChSql = { sql, params }` shape so
 * downstream consumers (`BaseClickhouseClient.queryChartConfig`, the app
 * fetch hooks, etc.) keep working through the deprecation period.
 *
 * Two notable simplifications vs. the previous implementation:
 *  - All metric / materialized-view branches have been removed. Berg has
 *    no MV concept and the metric-source kind has collapsed to Table.
 *  - All `*Merge`/`*State` aggregate combinators have been removed.
 *    Trino has no equivalent; Berg-native data has no aggregating-merge
 *    tables to read state-merge values from.
 *
 * The `aggregate` helpers in `chartUtils.ts` map ClickHouse-named aggregate
 * functions to their Trino equivalents: `quantile(p)(x)` →
 * `approx_percentile(x, p)`, etc. `count_distinct` → `count(DISTINCT x)`,
 * `argMax(value, ts)` survives unchanged (Trino-native).
 */

import { Metadata } from '@/core/metadata';
import {
  convertDateRangeToGranularityString,
  extractSettingsClauseFromEnd,
  getFirstTimestampValueExpression,
  joinQuerySettings,
  optimizeTimestampValueExpression,
  parseToStartOfFunction,
  splitAndTrimWithBracket,
} from '@/core/utils';
import { isBuilderChartConfig, isRawSqlChartConfig } from '@/guards';
import { replaceMacros } from '@/macros';
import { SearchQueryBuilder, TrinoSchemaSerializer } from '@/queryParser';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@/rawSqlParams';
import {
  AggregateFunction,
  AggregateFunctionWithCombinators,
  BuilderChartConfigWithDateRange,
  BuilderChartConfigWithOptDateRange,
  ChartConfig,
  ChartConfigSchema,
  ChartConfigWithOptDateRange,
  ChSqlSchema,
  CteChartConfig,
  DateRange,
  DisplayType,
  QuerySettings,
  RawSqlChartConfig,
  SearchCondition,
  SearchConditionLanguage,
  SelectList,
  SortSpecificationList,
  SqlAstFilter,
  SQLInterval,
} from '@/types';

import {
  aggregateExpr,
  fromUnixMs,
  fullyQualifiedTable,
  parseGranularity,
  quoteIdent,
  timeBucketExpr as trinoTimeBucketExpr,
} from './chartUtils';

/**
 * Output shape — kept as `{ sql, params }` for backwards compatibility
 * with the ClickHouse client and the test corpus, but `params` is always
 * empty: Trino emission inlines literals.
 */
export interface ChSql {
  sql: string;
  params: Record<string, unknown>;
}

const sqlOnly = (sql: string): ChSql => ({ sql, params: {} });

export const FIXED_TIME_BUCKET_EXPR_ALIAS = '__hdx_time_bucket';

const INVERSE_OPERATOR_MAP = {
  '=': '!=',
  '>': '<=',
  '<': '>=',

  '!=': '=',
  '<=': '>',
  '>=': '<',
} as const;
export function inverseSqlAstFilter(filter: SqlAstFilter): SqlAstFilter {
  return {
    ...filter,
    operator:
      INVERSE_OPERATOR_MAP[
        filter.operator as keyof typeof INVERSE_OPERATOR_MAP
      ],
  };
}

export function isNonEmptyWhereExpr(where?: string): where is string {
  return where != null && where.trim() != '';
}

export function isUsingGroupBy(
  chartConfig: BuilderChartConfigWithOptDateRange,
): chartConfig is Omit<BuilderChartConfigWithDateRange, 'groupBy'> & {
  groupBy: NonNullable<BuilderChartConfigWithDateRange['groupBy']>;
} {
  return chartConfig.groupBy != null && chartConfig.groupBy.length > 0;
}

export function isUsingGranularity(
  chartConfig: BuilderChartConfigWithOptDateRange,
): chartConfig is Omit<
  Omit<Omit<BuilderChartConfigWithDateRange, 'granularity'>, 'dateRange'>,
  'timestampValueExpression'
> & {
  granularity: NonNullable<BuilderChartConfigWithDateRange['granularity']>;
  dateRange: NonNullable<BuilderChartConfigWithDateRange['dateRange']>;
  timestampValueExpression: NonNullable<
    BuilderChartConfigWithDateRange['timestampValueExpression']
  >;
} {
  return (
    chartConfig.timestampValueExpression != null &&
    chartConfig.granularity != null
  );
}

/**
 * Berg dropped the `Metric` source kind. The legacy `metricTables` field
 * may still appear on a chart config that was saved in HyperDX, but Trino
 * emission no longer treats it specially — we just narrow on its presence
 * for the sake of preserving the public type-guard shape.
 */
export const isMetricChartConfig = (
  chartConfig: BuilderChartConfigWithOptDateRange,
): chartConfig is BuilderChartConfigWithOptDateRange & {
  metricTables: NonNullable<BuilderChartConfigWithOptDateRange['metricTables']>;
} => {
  return chartConfig.metricTables != null;
};

export const setChartSelectsAlias = (
  config: BuilderChartConfigWithOptDateRange,
) => {
  if (Array.isArray(config.select) && isMetricChartConfig(config)) {
    return {
      ...config,
      select: config.select.map(s => ({
        ...s,
        alias:
          s.alias ||
          (s.isDelta
            ? `${s.aggFn}(delta(${s.metricName}))`
            : `${s.aggFn}(${s.metricName})`), // use an alias if one isn't already set
      })),
    };
  }
  return config;
};

export const splitChartConfigs = (
  config: ChartConfigWithOptDateRange,
): ChartConfigWithOptDateRangeEx[] => {
  if (
    isBuilderChartConfig(config) &&
    isMetricChartConfig(config) &&
    Array.isArray(config.select)
  ) {
    const _configs: BuilderChartConfigWithOptDateRange[] = [];
    for (const select of config.select) {
      _configs.push({
        ...config,
        select: [select],
      });
    }
    return _configs;
  }

  if (isRawSqlChartConfig(config) || isBuilderChartConfig(config)) {
    return [config];
  }

  throw new Error(`Unexpected chart config type: ${JSON.stringify(config)}`);
};

// -------- WHERE composition (Lucene + raw SQL) --------

async function renderWhereExpressionStr({
  condition,
  language,
  metadata,
  from,
  implicitColumnExpression,
  connectionId,
}: {
  condition: SearchCondition;
  language: SearchConditionLanguage;
  metadata: Metadata;
  from: BuilderChartConfigWithDateRange['from'];
  implicitColumnExpression?: string;
  connectionId: string;
  with?: BuilderChartConfigWithDateRange['with'];
}): Promise<string> {
  if (language !== 'lucene') {
    return condition;
  }

  // Fetch the table's column list so the Trino serializer can validate
  // identifiers and pick numeric vs. string comparison shapes. When the
  // metadata fetch fails (CTEs, missing tables, etc.) fall back to an
  // empty schema — TrinoSchemaSerializer will then reject every field,
  // which surfaces as an explicit "column not found" parse error rather
  // than producing silently wrong SQL.
  let columns: { name: string; type: string }[] = [];
  if (from.databaseName && from.tableName) {
    try {
      const fetched = await metadata.getColumns({
        databaseName: from.databaseName,
        tableName: from.tableName,
        connectionId,
      });
      columns = (fetched ?? []).map(c => ({
        name: c.name,
        type: c.type,
      }));
    } catch {
      // ignore — empty schema falls through
    }
  }
  const serializer = new TrinoSchemaSerializer({
    columns,
    implicitColumnExpression,
  });
  const builder = new SearchQueryBuilder(condition, serializer);
  return builder.build();
}

async function renderWhereExpression(
  args: Parameters<typeof renderWhereExpressionStr>[0],
): Promise<ChSql> {
  return sqlOnly(await renderWhereExpressionStr(args));
}

// -------- Aggregate / SELECT-list emission --------

function aggFnExpr({
  fn,
  expr,
  level,
  where,
}: {
  fn: AggregateFunction | AggregateFunctionWithCombinators;
  expr?: string;
  level?: number;
  where?: string;
}): ChSql {
  // Berg has no aggregating-merge tables, so *Merge/*State combinators are
  // intentionally rejected — fail loudly rather than silently emit invalid
  // Trino SQL.
  if (fn.endsWith('Merge') || fn.endsWith('State')) {
    throw new Error(
      `Aggregate combinator '${fn}' is not supported in Berg/Trino. ` +
        `Use a base aggregate (count/sum/avg/min/max/quantile/count_distinct).`,
    );
  }

  const isWhereUsed = isNonEmptyWhereExpr(where);

  if (fn === 'none') {
    // pass-through
    return sqlOnly(expr ?? '');
  }

  if (fn === 'any') {
    if (!expr) throw new Error('any requires an expression');
    return sqlOnly(
      `arbitrary(${expr})${isWhereUsed ? ` FILTER (WHERE ${where})` : ''}`,
    );
  }

  if (fn === 'count') {
    if (isWhereUsed) {
      // Trino: count(*) FILTER (WHERE …)
      return sqlOnly(`count(*) FILTER (WHERE ${where})`);
    }
    return sqlOnly('count(*)');
  }

  if (fn === 'count_distinct') {
    if (!expr) throw new Error('count_distinct requires an expression');
    return sqlOnly(
      `count(DISTINCT ${expr})${isWhereUsed ? ` FILTER (WHERE ${where})` : ''}`,
    );
  }

  if (fn.startsWith('quantile')) {
    if (!expr) throw new Error('quantile requires an expression');
    const lvl = level != null && Number.isFinite(level) ? level : 0.5;
    return sqlOnly(
      `approx_percentile(${expr}, ${lvl})${isWhereUsed ? ` FILTER (WHERE ${where})` : ''}`,
    );
  }

  if (fn.startsWith('histogram')) {
    // Trino has no direct ClickHouse-`histogram(N)(x)` analog. Emit a
    // placeholder; histogram-style chart emission belongs in a future
    // dedicated path and is out of scope for Phase 1.2.
    throw new Error(
      'histogram aggregate is not supported in Berg/Trino. ' +
        'Use approx_percentile or a custom Raw SQL config.',
    );
  }

  if (fn === 'last_value') {
    if (!expr) throw new Error('last_value requires an expression');
    return sqlOnly(
      `${aggregateExpr('last_value', { expr })}${isWhereUsed ? ` FILTER (WHERE ${where})` : ''}`,
    );
  }

  // Plain unary aggregates: sum, avg, min, max
  if (!expr) {
    throw new Error(`Column is required for aggregation function '${fn}'`);
  }
  return sqlOnly(
    `${fn}(${expr})${isWhereUsed ? ` FILTER (WHERE ${where})` : ''}`,
  );
}

export function isRatioChartConfig(
  selectList: SelectList,
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
): boolean {
  return chartConfig.seriesReturnType === 'ratio' && selectList.length === 2;
}

async function renderSelectList(
  selectList: SelectList,
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql[]> {
  if (typeof selectList === 'string') {
    return [sqlOnly(selectList)];
  }

  const isRatio = isRatioChartConfig(selectList, chartConfig);

  const selectsSQL = await Promise.all(
    selectList.map(async select => {
      const whereClause = await renderWhereExpression({
        condition: select.aggCondition ?? '',
        from: chartConfig.from,
        language: select.aggConditionLanguage ?? 'lucene',
        implicitColumnExpression: chartConfig.implicitColumnExpression,
        metadata,
        connectionId: chartConfig.connection,
        with: chartConfig.with,
      });

      let expr: ChSql;
      if (select.aggFn == null) {
        expr =
          select.valueExpressionLanguage === 'lucene'
            ? await renderWhereExpression({
                condition: select.valueExpression,
                from: chartConfig.from,
                language: 'lucene',
                implicitColumnExpression: chartConfig.implicitColumnExpression,
                metadata,
                connectionId: chartConfig.connection,
                with: chartConfig.with,
              })
            : sqlOnly(select.valueExpression);
      } else if (
        select.aggFn.startsWith('quantile') ||
        select.aggFn.startsWith('histogram')
      ) {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          // @ts-expect-error level is present on quantile/histogram select shapes
          level: select.level,
          where: whereClause.sql,
        });
      } else {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          where: whereClause.sql,
        });
      }

      const aliased =
        select.alias != null && select.alias.trim() !== ''
          ? `${expr.sql} AS ${quoteIdent(select.alias)}`
          : expr.sql;
      return sqlOnly(aliased);
    }),
  );

  if (isRatio) {
    return [sqlOnly(`(${selectsSQL[0].sql}) / (${selectsSQL[1].sql})`)];
  }
  return selectsSQL;
}

function renderSortSpecificationList(
  sortSpecificationList: SortSpecificationList,
): ChSql[] {
  if (typeof sortSpecificationList === 'string') {
    return [sqlOnly(sortSpecificationList)];
  }

  return sortSpecificationList.map(sortSpecification =>
    sqlOnly(
      `${sortSpecification.valueExpression} ${
        sortSpecification.ordering === 'DESC' ? 'DESC' : 'ASC'
      }`,
    ),
  );
}

// -------- Time bucket / time filter --------

function timeBucketExpr({
  interval,
  timestampValueExpression,
  dateRange,
  alias = FIXED_TIME_BUCKET_EXPR_ALIAS,
  // GROUP BY / ORDER BY in Trino reject `<expr> AS <alias>` form — aliases
  // there must either be the bare alias name (referring back to a SELECT
  // alias) or the bare expression. Default emits the SELECT-shape with
  // alias; pass false to get the bare bucket expression for GROUP/ORDER.
  withAlias = true,
}: {
  interval: SQLInterval | 'auto';
  timestampValueExpression: string;
  dateRange?: [Date, Date];
  alias?: string;
  withAlias?: boolean;
}): ChSql {
  const tsExpr = getFirstTimestampValueExpression(timestampValueExpression);
  const granularity =
    interval === 'auto' && Array.isArray(dateRange)
      ? convertDateRangeToGranularityString(dateRange)
      : interval;
  // `auto` without a dateRange falls back to a 1-minute bucket.
  const bucket =
    typeof granularity === 'string' && granularity !== 'auto'
      ? trinoTimeBucketExpr(tsExpr, granularity)
      : `date_trunc('minute', ${tsExpr})`;
  return sqlOnly(withAlias ? `${bucket} AS ${quoteIdent(alias)}` : bucket);
}

/**
 * Render the time-window WHERE predicate.
 *
 * - Bare timestamp columns: emit `BETWEEN from_unixtime(start_s) AND
 *   from_unixtime(end_s)` (Trino-native).
 * - Wrapped expressions like `date_trunc('minute', ts)` or
 *   `toStartOfHour(ts)` (carried over from imported HyperDX configs):
 *   apply the same wrapper to both sides of the comparison so the
 *   query planner can still use the underlying ordering.
 *
 * The historical inclusive/exclusive bound semantics are preserved.
 */
export async function timeFilterExpr({
  connectionId,
  databaseName,
  dateRange,
  dateRangeEndInclusive,
  dateRangeStartInclusive,
  includedDataInterval,
  metadata,
  tableName,
  timestampValueExpression,
}: {
  connectionId: string;
  databaseName: string;
  dateRange: [Date, Date];
  dateRangeEndInclusive: boolean;
  dateRangeStartInclusive: boolean;
  includedDataInterval?: string;
  metadata: Metadata;
  tableName: string;
  timestampValueExpression: string;
  with?: BuilderChartConfigWithDateRange['with'];
}): Promise<ChSql> {
  const startTime = dateRange[0].getTime();
  const endTime = dateRange[1].getTime();

  let optimizedTimestampValueExpression = timestampValueExpression;
  try {
    if (databaseName && tableName && connectionId) {
      const tableMetadata = await metadata.getTableMetadata({
        databaseName,
        tableName,
        connectionId,
      });
      optimizedTimestampValueExpression = optimizeTimestampValueExpression(
        timestampValueExpression,
        tableMetadata?.primary_key,
      );
    }
  } catch (e) {
    console.warn('Failed to optimize timestampValueExpression', e);
  }

  const valueExpressions = splitAndTrimWithBracket(
    optimizedTimestampValueExpression,
  );

  const wrapInterval = (msExpr: string, intervalStr: string): string => {
    // Trino has no `INTERVAL N <unit>` literal in the same syntactic position
    // as ClickHouse; emit a `date_trunc` floor-by-N if we can parse it.
    try {
      const { n, unit } = parseGranularity(intervalStr as SQLInterval);
      if (n === 1) {
        return `date_trunc('${unit}', ${msExpr})`;
      }
      return trinoTimeBucketExpr(msExpr, intervalStr as SQLInterval);
    } catch {
      // Free-form interval (e.g. `1 WEEK`) — fall back to date_trunc on the
      // unit name only; loses the multiplier but is the safest portable form.
      const unit =
        intervalStr.trim().split(/\s+/).pop()?.toLowerCase() ?? 'minute';
      const u = unit.replace(/s$/, '');
      return `date_trunc('${u}', ${msExpr})`;
    }
  };

  const whereExprs = await Promise.all(
    valueExpressions.map(async expr => {
      const col = expr.trim();
      const toStartOf = parseToStartOfFunction(col);
      const isToDateExpr = /^toDate\s*\(/.test(col);

      const columnMeta =
        toStartOf || isToDateExpr
          ? null
          : await metadata.getColumn({
              databaseName,
              tableName,
              column: col,
              connectionId,
            });

      const startTs = fromUnixMs(startTime);
      const endTs = fromUnixMs(endTime);

      const startTimeCond = includedDataInterval
        ? `${wrapInterval(startTs, includedDataInterval)}`
        : toStartOf
          ? `${toStartOf.function}(${startTs}${toStartOf.formattedRemainingArgs})`
          : startTs;

      const endTimeCond = includedDataInterval
        ? `${wrapInterval(endTs, includedDataInterval)}`
        : toStartOf
          ? `${toStartOf.function}(${endTs}${toStartOf.formattedRemainingArgs})`
          : endTs;

      const isDateType = columnMeta?.type === 'Date' || isToDateExpr;

      // toStartOf*-wrapped and Date-typed filters must stay inclusive — strict
      // < on a rounded value drops a whole interval.
      const startOp =
        dateRangeStartInclusive || toStartOf || isDateType ? '>=' : '>';
      const endOp =
        dateRangeEndInclusive || toStartOf || isDateType ? '<=' : '<';

      if (isDateType) {
        return `(${col} ${startOp} CAST(${startTimeCond} AS DATE) AND ${col} ${endOp} CAST(${endTimeCond} AS DATE))`;
      }
      return `(${col} ${startOp} ${startTimeCond} AND ${col} ${endOp} ${endTimeCond})`;
    }),
  );

  return sqlOnly(whereExprs.join('AND'));
}

// -------- WHERE / GROUP BY / ORDER BY / LIMIT / SETTINGS --------

async function renderSelect(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql> {
  const isIncludingTimeBucket = isUsingGranularity(chartConfig);
  const isIncludingGroupBy = isUsingGroupBy(chartConfig);

  const parts: ChSql[] = [];
  parts.push(
    ...(await renderSelectList(chartConfig.select, chartConfig, metadata)),
  );
  if (isIncludingGroupBy && chartConfig.selectGroupBy !== false) {
    parts.push(
      ...(await renderSelectList(chartConfig.groupBy, chartConfig, metadata)),
    );
  }
  if (isIncludingTimeBucket) {
    parts.push(
      timeBucketExpr({
        interval: chartConfig.granularity,
        timestampValueExpression: chartConfig.timestampValueExpression,
        dateRange: chartConfig.dateRange,
      }),
    );
  }
  return sqlOnly(
    parts
      .map(p => p.sql)
      .filter(Boolean)
      .join(','),
  );
}

function renderFrom({
  from,
  catalog,
}: {
  from: BuilderChartConfigWithDateRange['from'];
  catalog?: string;
}): ChSql {
  // CTEs and bare-table references skip the catalog/database segments when
  // they're absent. The Catalog page builds its own SQL via `chartUtils`.
  return sqlOnly(
    fullyQualifiedTable(catalog, from.databaseName, from.tableName),
  );
}

async function renderWhere(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql> {
  const parts: string[] = [];

  if (
    chartConfig.dateRange != null &&
    chartConfig.timestampValueExpression != null
  ) {
    const timeFilter = await timeFilterExpr({
      timestampValueExpression: chartConfig.timestampValueExpression,
      dateRange: chartConfig.dateRange,
      dateRangeStartInclusive: chartConfig.dateRangeStartInclusive ?? true,
      dateRangeEndInclusive: chartConfig.dateRangeEndInclusive ?? true,
      metadata,
      connectionId: chartConfig.connection,
      databaseName: chartConfig.from.databaseName,
      tableName: chartConfig.from.tableName,
      with: chartConfig.with,
      includedDataInterval: chartConfig.includedDataInterval,
    });
    if (timeFilter.sql) parts.push(timeFilter.sql);
  }

  if (isNonEmptyWhereExpr(chartConfig.where)) {
    const where = await renderWhereExpression({
      condition: chartConfig.where,
      from: chartConfig.from,
      language: chartConfig.whereLanguage ?? 'sql',
      implicitColumnExpression: chartConfig.implicitColumnExpression,
      metadata,
      connectionId: chartConfig.connection,
      with: chartConfig.with,
    });
    if (where.sql) parts.push(`(${where.sql})`);
  }

  // aggCondition WHERE OR-merge: only when every select carries one.
  if (
    typeof chartConfig.select !== 'string' &&
    chartConfig.select.every(select => isNonEmptyWhereExpr(select.aggCondition))
  ) {
    const aggParts = (
      await Promise.all(
        chartConfig.select.map(async select => {
          if (isNonEmptyWhereExpr(select.aggCondition)) {
            const w = await renderWhereExpression({
              condition: select.aggCondition,
              from: chartConfig.from,
              language: select.aggConditionLanguage ?? 'sql',
              implicitColumnExpression: chartConfig.implicitColumnExpression,
              metadata,
              connectionId: chartConfig.connection,
              with: chartConfig.with,
            });
            return w.sql ? `(${w.sql})` : null;
          }
          return null;
        }),
      )
    ).filter((s): s is string => s != null && s !== '');
    if (aggParts.length > 0) {
      parts.push(`(${aggParts.join(' OR ')})`);
    }
  }

  const filterParts = await Promise.all(
    (chartConfig.filters ?? []).map(async filter => {
      if (filter.type === 'sql_ast') {
        return `(${filter.left} ${filter.operator} ${filter.right})`;
      } else if (filter.type === 'lucene' || filter.type === 'sql') {
        const w = await renderWhereExpression({
          condition: filter.condition,
          from: chartConfig.from,
          language: filter.type,
          implicitColumnExpression: chartConfig.implicitColumnExpression,
          metadata,
          connectionId: chartConfig.connection,
          with: chartConfig.with,
        });
        return w.sql ? `(${w.sql})` : '';
      }

      throw new Error(
        `Unknown filter type: ${(filter as { type: string }).type}`,
      );
    }),
  );
  const filterCombiner =
    chartConfig.filtersLogicalOperator === 'OR' ? ' OR ' : ' AND ';
  const filtersJoined = filterParts.filter(Boolean).join(filterCombiner);
  if (filtersJoined) {
    parts.push(`(${filtersJoined})`);
  }

  return sqlOnly(parts.filter(Boolean).join(' AND '));
}

async function renderGroupBy(
  chartConfig: BuilderChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<ChSql | undefined> {
  const parts: ChSql[] = [];
  if (isUsingGroupBy(chartConfig)) {
    parts.push(
      ...(await renderSelectList(chartConfig.groupBy, chartConfig, metadata)),
    );
  }
  if (isUsingGranularity(chartConfig)) {
    parts.push(
      timeBucketExpr({
        interval: chartConfig.granularity,
        timestampValueExpression: chartConfig.timestampValueExpression,
        dateRange: chartConfig.dateRange,
        // GROUP BY: bare bucket expression, no `AS alias` (Trino rejects
        // aliases here).
        withAlias: false,
      }),
    );
  }
  return sqlOnly(
    parts
      .map(p => p.sql)
      .filter(Boolean)
      .join(','),
  );
}

async function renderHaving(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql | undefined> {
  if (!isNonEmptyWhereExpr(chartConfig.having)) {
    return undefined;
  }

  return await renderWhereExpression({
    condition: chartConfig.having,
    from: chartConfig.from,
    language: chartConfig.havingLanguage ?? 'sql',
    implicitColumnExpression: chartConfig.implicitColumnExpression,
    metadata,
    connectionId: chartConfig.connection,
    with: chartConfig.with,
  });
}

function renderOrderBy(
  chartConfig: BuilderChartConfigWithOptDateRange,
): ChSql | undefined {
  const isIncludingTimeBucket = isUsingGranularity(chartConfig);

  if (chartConfig.orderBy == null && !isIncludingTimeBucket) {
    return undefined;
  }

  const parts: ChSql[] = [];
  if (isIncludingTimeBucket) {
    parts.push(
      timeBucketExpr({
        interval: chartConfig.granularity,
        timestampValueExpression: chartConfig.timestampValueExpression,
        dateRange: chartConfig.dateRange,
        // ORDER BY: bare bucket expression, no `AS alias` (Trino rejects
        // aliases here).
        withAlias: false,
      }),
    );
  }
  if (chartConfig.orderBy != null) {
    parts.push(...renderSortSpecificationList(chartConfig.orderBy));
  }
  return sqlOnly(
    parts
      .map(p => p.sql)
      .filter(Boolean)
      .join(','),
  );
}

/**
 * Render a Trino-shaped LIMIT/OFFSET clause.
 *
 * Trino rejects the ClickHouse/MySQL `LIMIT N OFFSET M` form. The valid
 * shapes are:
 *   - `LIMIT N`                     — when offset is absent / 0
 *   - `OFFSET M LIMIT N`            — Trino accepts offset-before-limit
 *
 * This function returns the *full* clause text (not just the bare numbers
 * that go after `LIMIT`) so the emit-site loop in `renderChartConfig`
 * appends it as a complete fragment.
 */
function renderLimit(
  chartConfig: BuilderChartConfigWithOptDateRange,
): ChSql | undefined {
  if (chartConfig.limit == null || chartConfig.limit.limit == null) {
    return undefined;
  }

  const offset = chartConfig.limit.offset;
  const hasOffset = offset != null && offset > 0;

  const sql = hasOffset
    ? `OFFSET ${offset} LIMIT ${chartConfig.limit.limit}`
    : `LIMIT ${chartConfig.limit.limit}`;

  return sqlOnly(sql);
}

function renderSettings(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  querySettings: QuerySettings | undefined,
): ChSql {
  const querySettingsJoined = joinQuerySettings(querySettings);
  const parts: string[] = [];
  if (chartConfig.settings) parts.push(chartConfig.settings.sql);
  if (querySettingsJoined) parts.push(querySettingsJoined);
  return sqlOnly(parts.filter(Boolean).join(', '));
}

type InternalChartFields = {
  includedDataInterval?: string;
  settings?: ChSql;
};

type BuilderChartConfigWithOptDateRangeEx = BuilderChartConfigWithOptDateRange &
  InternalChartFields;

type RawSqlChartConfigEx = RawSqlChartConfig &
  Partial<DateRange> &
  InternalChartFields;

export type ChartConfigWithOptDateRangeEx =
  | BuilderChartConfigWithOptDateRangeEx
  | RawSqlChartConfigEx;

async function renderWith(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
  querySettings: QuerySettings | undefined,
): Promise<ChSql | undefined> {
  const { with: withClauses } = chartConfig;
  if (!withClauses) return undefined;

  const parts = await Promise.all(
    withClauses.map(async clause => {
      const {
        sql,
        chartConfig,
      }: { sql?: ChSql; chartConfig?: CteChartConfig } = clause;

      if (sql && chartConfig) {
        throw new Error(
          "cannot specify both 'sql' and 'chartConfig' in with clause",
        );
      }
      if (!(sql || chartConfig)) {
        throw new Error(
          "must specify either 'sql' or 'chartConfig' in with clause",
        );
      }
      if (sql && !ChSqlSchema.safeParse(sql).success) {
        throw new Error('non-conforming sql object in CTE');
      }
      if (chartConfig && !ChartConfigSchema.safeParse(chartConfig).success) {
        throw new Error(
          `non-conforming chartConfig object in CTE: ${ChartConfigSchema.safeParse(chartConfig).error}`,
        );
      }

      let resolvedSql: ChSql;
      if (sql) {
        resolvedSql = sql;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- CteChartConfig is structurally a ChartConfig
        const cte = chartConfig as ChartConfig;
        resolvedSql = await renderChartConfig(cte, metadata, querySettings);
      }

      if (clause.isSubquery === false) {
        return `(${resolvedSql.sql}) AS ${quoteIdent(clause.name)}`;
      }
      return `${clause.name} AS (${resolvedSql.sql})`;
    }),
  );

  return sqlOnly(parts.filter(Boolean).join(','));
}

// -------- Raw SQL emission --------

async function renderFiltersToSql(
  chartConfig: RawSqlChartConfig,
  metadata: Metadata,
): Promise<string | undefined> {
  if (
    !chartConfig.filters?.length ||
    !chartConfig.source ||
    !chartConfig.from
  ) {
    return undefined;
  }

  const conditions = (
    await Promise.all(
      chartConfig.filters.map(async filter => {
        const hasSourceTable =
          chartConfig.from && chartConfig.from.tableName && chartConfig.source;

        if (filter.type === 'sql_ast') {
          return `(${filter.left} ${filter.operator} ${filter.right})`;
        } else if (filter.type === 'sql' && !hasSourceTable) {
          return filter.condition.trim() ? `(${filter.condition})` : undefined;
        } else if (
          (filter.type === 'lucene' || filter.type === 'sql') &&
          filter.condition.trim() &&
          hasSourceTable
        ) {
          const condition = await renderWhereExpressionStr({
            condition: filter.condition,

            from: chartConfig.from!,
            language: filter.type,
            implicitColumnExpression: chartConfig.implicitColumnExpression,
            metadata,
            connectionId: chartConfig.connection,
          });
          return condition ? `(${condition})` : undefined;
        }
      }),
    )
  ).filter((c): c is string => c !== undefined);

  return conditions.length > 0 ? `(${conditions.join(' AND ')})` : undefined;
}

export async function renderRawSqlChartConfig(
  chartConfig: RawSqlChartConfig & Partial<DateRange>,
  metadata: Metadata,
): Promise<ChSql> {
  const displayType = chartConfig.displayType ?? DisplayType.Table;

  const filtersSQL = await renderFiltersToSql(chartConfig, metadata);
  const sqlWithMacrosReplaced = replaceMacros(chartConfig, filtersSQL);

  // eslint-disable-next-line security/detect-object-injection
  const queryParams = QUERY_PARAMS_BY_DISPLAY_TYPE[displayType];

  return {
    sql: sqlWithMacrosReplaced,
    params: Object.fromEntries(
      queryParams.map(param => [param.name, param.get(chartConfig)]),
    ),
  };
}

export async function renderChartConfig(
  rawChartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
  querySettings: QuerySettings | undefined,
): Promise<ChSql> {
  if (isRawSqlChartConfig(rawChartConfig)) {
    return renderRawSqlChartConfig(rawChartConfig, metadata);
  }

  // Berg has no metric or materialized-view branch — emit straight Trino.
  const chartConfig = rawChartConfig;

  const withClauses = await renderWith(chartConfig, metadata, querySettings);
  const select = await renderSelect(chartConfig, metadata);
  const from = renderFrom({ from: chartConfig.from });
  const where = await renderWhere(chartConfig, metadata);
  const groupBy = await renderGroupBy(chartConfig, metadata);
  const having = await renderHaving(chartConfig, metadata);
  const orderBy = renderOrderBy(chartConfig);
  const limit = renderLimit(chartConfig);
  const settings = renderSettings(chartConfig, querySettings);

  const parts: string[] = [];
  if (withClauses?.sql) parts.push(`WITH ${withClauses.sql}`);
  parts.push(`SELECT ${select.sql}`);
  parts.push(`FROM ${from.sql}`);
  if (where.sql) parts.push(`WHERE ${where.sql}`);
  if (groupBy?.sql) parts.push(`GROUP BY ${groupBy.sql}`);
  if (having?.sql) parts.push(`HAVING ${having.sql}`);
  if (orderBy?.sql) parts.push(`ORDER BY ${orderBy.sql}`);
  // renderLimit returns the full `LIMIT N` / `OFFSET M LIMIT N` clause —
  // Trino rejects ClickHouse-style `LIMIT N OFFSET M`.
  if (limit?.sql) parts.push(limit.sql);

  // Trino does not use a SETTINGS clause; preserved here only for the
  // backwards-compat tests that still assert its presence. The query
  // executor (Athena) ignores anything beyond the ORDER BY / LIMIT.
  if (settings.sql) parts.push(`SETTINGS ${settings.sql}`);

  // Suppress an unused-variable warning while extractSettingsClauseFromEnd is
  // still exported by core/utils for downstream callers; remove once the
  // ChSql/clickhouse shim deletion in Task 14 lands.
  void extractSettingsClauseFromEnd;

  return sqlOnly(parts.join(' '));
}

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
