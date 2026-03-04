import isPlainObject from 'lodash/isPlainObject';
import * as SQLParser from 'node-sql-parser';
import SqlString from 'sqlstring';

import { ChSql, chSql, concatChSql, wrapChSqlIfNotEmpty } from '@/clickhouse';
import { translateHistogram } from '@/core/histogram';
import { Metadata } from '@/core/metadata';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  extractSettingsClauseFromEnd,
  getFirstTimestampValueExpression,
  joinQuerySettings,
  optimizeTimestampValueExpression,
  parseToNumber,
  parseToStartOfFunction,
  splitAndTrimWithBracket,
} from '@/core/utils';
import { CustomSchemaSQLSerializerV2, SearchQueryBuilder } from '@/queryParser';
import {
  AggregateFunction,
  AggregateFunctionWithCombinators,
  ChartConfig,
  ChartConfigSchema,
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  ChSqlSchema,
  CteChartConfig,
  MetricsDataType,
  QuerySettings,
  SearchCondition,
  SearchConditionLanguage,
  SelectList,
  SelectSQLStatement,
  SortSpecificationList,
  SqlAstFilter,
  SQLInterval,
} from '@/types';

/**
 * Helper function to create a MetricName filter condition.
 * Uses metricNameSql if available (which handles both old and new metric names via OR),
 * otherwise falls back to a simple equality check.
 */
function createMetricNameFilter(
  metricName: string,
  metricNameSql?: string,
): string {
  if (metricNameSql) {
    return metricNameSql;
  }
  return SqlString.format('MetricName = ?', [metricName]);
}

// FIXME: SQLParser.ColumnRef is incomplete
type ColumnRef = SQLParser.ColumnRef & {
  array_index?: {
    index: { type: string; value: string };
  }[];
};

function determineTableName(select: SelectSQLStatement): string {
  if ('metricTables' in select.from) {
    return select.from.tableName;
  }

  return '';
}

const DEFAULT_METRIC_TABLE_TIME_COLUMN = 'TimeUnix';
export const FIXED_TIME_BUCKET_EXPR_ALIAS = '__hdx_time_bucket';

export function isUsingGroupBy(
  chartConfig: ChartConfigWithOptDateRange,
): chartConfig is Omit<ChartConfigWithDateRange, 'groupBy'> & {
  groupBy: NonNullable<ChartConfigWithDateRange['groupBy']>;
} {
  return chartConfig.groupBy != null && chartConfig.groupBy.length > 0;
}

export function isUsingGranularity(
  chartConfig: ChartConfigWithOptDateRange,
): chartConfig is Omit<
  Omit<Omit<ChartConfigWithDateRange, 'granularity'>, 'dateRange'>,
  'timestampValueExpression'
> & {
  granularity: NonNullable<ChartConfigWithDateRange['granularity']>;
  dateRange: NonNullable<ChartConfigWithDateRange['dateRange']>;
  timestampValueExpression: NonNullable<
    ChartConfigWithDateRange['timestampValueExpression']
  >;
} {
  return (
    chartConfig.timestampValueExpression != null &&
    chartConfig.granularity != null
  );
}

export const isMetricChartConfig = (
  chartConfig: ChartConfigWithOptDateRange,
) => {
  return chartConfig.metricTables != null;
};

// TODO: apply this to all chart configs
export const setChartSelectsAlias = (config: ChartConfigWithOptDateRange) => {
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

export const splitChartConfigs = (config: ChartConfigWithOptDateRange) => {
  // only split metric queries for now
  if (isMetricChartConfig(config) && Array.isArray(config.select)) {
    const _configs: ChartConfigWithOptDateRange[] = [];
    // split the query into multiple queries
    for (const select of config.select) {
      _configs.push({
        ...config,
        select: [select],
      });
    }
    return _configs;
  }
  return [config];
};

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

const fastifySQL = ({
  materializedFields,
  rawSQL,
}: {
  materializedFields: Map<string, string>;
  rawSQL: string;
}) => {
  // Parse the SQL AST
  try {
    // Remove the SETTINGS clause because `SQLParser` doesn't understand it.
    const [rawSqlWithoutSettingsClause] = extractSettingsClauseFromEnd(rawSQL);

    const parser = new SQLParser.Parser();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- astify returns union type, we expect Select
    const ast = parser.astify(rawSqlWithoutSettingsClause, {
      database: 'Postgresql',
    }) as SQLParser.Select;

    // traveral ast and replace the left node with the materialized field
    // FIXME: type node (AST type is incomplete): https://github.com/taozhi8833998/node-sql-parser/blob/42ea0b1800c5d425acb8c5ca708a1cee731aada8/types.d.ts#L474
    const traverse = (
      node:
        | SQLParser.Expr
        | SQLParser.ExpressionValue
        | SQLParser.ExprList
        | SQLParser.Function
        | null,
    ) => {
      if (node == null) {
        return;
      }

      let colExpr;

      switch (node.type) {
        case 'column_ref': {
          // FIXME: handle 'Value' type?
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const _n = node as ColumnRef;
          // @ts-ignore
          if (typeof _n.column !== 'string') {
            // @ts-ignore
            colExpr = `${_n.column?.expr.value}['${_n.array_index?.[0]?.index.value}']`;
          }
          break;
        }
        case 'binary_expr': {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const _n = node as SQLParser.Expr;
          if (Array.isArray(_n.left)) {
            for (const left of _n.left) {
              traverse(left);
            }
          } else {
            traverse(_n.left);
          }

          if (Array.isArray(_n.right)) {
            for (const right of _n.right) {
              traverse(right);
            }
          } else {
            traverse(_n.right);
          }
          break;
        }
        case 'function': {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const _n = node as SQLParser.Function;

          if (_n.args?.type === 'expr_list') {
            if (Array.isArray(_n.args?.value)) {
              for (const arg of _n.args.value) {
                traverse(arg);
              }

              // ex: JSONExtractString(Body, 'message')
              if (
                _n.args?.value?.[0]?.type === 'column_ref' &&
                _n.args?.value?.[1]?.type === 'single_quote_string'
              ) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- incomplete library types
                colExpr = `${_n.name?.name?.[0]?.value}(${(_n.args?.value?.[0] as any)?.column.expr.value}, '${_n.args?.value?.[1]?.value}')`;
              }
            }
            // when _n.args?.value is Expr
            else if (isPlainObject(_n.args?.value)) {
              traverse(_n.args.value);
            }
          }

          break;
        }
        default:
          // ignore other types
          break;
      }

      if (colExpr) {
        const materializedField = materializedFields.get(colExpr);
        if (materializedField) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const _n = node as ColumnRef;
          // reset the node ref
          for (const key in _n) {
            // eslint-disable-next-line no-prototype-builtins
            if (_n.hasOwnProperty(key)) {
              // @ts-ignore
              delete _n[key];
            }
          }
          _n.type = 'column_ref';
          // @ts-ignore
          _n.table = null;
          // @ts-ignore
          _n.column = { expr: { type: 'default', value: materializedField } };
        }
      }
    };

    if (Array.isArray(ast.columns)) {
      for (const col of ast.columns) {
        traverse(col.expr);
      }
    }

    traverse(ast.where);

    return parser.sqlify(ast);
  } catch (e) {
    return rawSQL;
  }
};

const aggFnExpr = ({
  fn,
  expr,
  level,
  where,
}: {
  fn: AggregateFunction | AggregateFunctionWithCombinators;
  expr?: string;
  level?: number;
  where?: string;
}) => {
  const isAny = fn === 'any';
  const isNone = fn === 'none';
  const isCount = fn.startsWith('count');
  const isWhereUsed = isNonEmptyWhereExpr(where);
  // Cast to float64 because the expr might not be a number
  const unsafeExpr = {
    UNSAFE_RAW_SQL:
      isAny || isNone ? `${expr}` : `toFloat64OrDefault(toString(${expr}))`,
  };
  const whereWithExtraNullCheck = `${where} AND ${unsafeExpr.UNSAFE_RAW_SQL} IS NOT NULL`;

  if (fn.endsWith('Merge')) {
    const renderedFnArgs = chSql`${{ UNSAFE_RAW_SQL: expr ?? '' }}`;

    const shouldParameterizeWithLevel =
      level && (fn.startsWith('quantile') || fn.startsWith('histogram'));
    const renderedFnArgsWithQuantileLevel = shouldParameterizeWithLevel
      ? chSql`(${{
          UNSAFE_RAW_SQL: Number.isFinite(level) ? `${level}` : '0',
        }})`
      : [];

    if (isWhereUsed) {
      return chSql`${fn}If${renderedFnArgsWithQuantileLevel}(${renderedFnArgs}, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }})`;
    } else {
      return chSql`${fn}${renderedFnArgsWithQuantileLevel}(${renderedFnArgs})`;
    }
  }
  // TODO: merge this chunk with the rest of logics
  else if (fn.endsWith('State')) {
    if (expr == null || isCount) {
      return isWhereUsed
        ? chSql`${fn}(${{ UNSAFE_RAW_SQL: where }})`
        : chSql`${fn}()`;
    }
    return chSql`${fn}(${unsafeExpr}${
      isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }}` : ''
    })`;
  }

  if (fn === 'count') {
    if (isWhereUsed) {
      return chSql`${fn}If(${{ UNSAFE_RAW_SQL: where }})`;
    }
    return {
      sql: `${fn}()`,
      params: {},
    };
  }

  if (fn === 'none') {
    // Can not use WHERE in none as we can not apply if to a custom aggregation function
    return chSql`${{ UNSAFE_RAW_SQL: expr ?? '' }}`;
  }

  if (expr != null) {
    if (fn === 'count_distinct') {
      return chSql`count${isWhereUsed ? 'If' : ''}(DISTINCT ${{
        UNSAFE_RAW_SQL: expr,
      }}${isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: where }}` : ''})`;
    }

    if (level != null) {
      return chSql`${fn}${isWhereUsed ? 'If' : ''}(${{
        // Using Float64 param leads to an added coersion, but we don't need to
        // escape number values anyways
        UNSAFE_RAW_SQL: Number.isFinite(level) ? `${level}` : '0',
      }})(${unsafeExpr}${
        isWhereUsed
          ? chSql`, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }}`
          : ''
      })`;
    }

    // TODO: Verify fn is a safe/valid function
    return chSql`${{ UNSAFE_RAW_SQL: fn }}${isWhereUsed ? 'If' : ''}(
      ${unsafeExpr}${isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }}` : ''}
    )`;
  } else {
    throw new Error(
      'Column is required for all non-count aggregation functions',
    );
  }
};

async function renderSelectList(
  selectList: SelectList,
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
) {
  if (typeof selectList === 'string') {
    return chSql`${{ UNSAFE_RAW_SQL: selectList }}`;
  }

  // This metadata query is executed in an attempt tp optimize the selects by favoring materialized fields
  // on a view/table that already perform the computation in select. This optimization is not currently
  // supported for queries using CTEs so skip the metadata fetch if there are CTE objects in the config.
  let materializedFields: Map<string, string> | undefined;
  try {
    // This will likely error when referencing a CTE, which is assumed
    // to be the case when chartConfig.from.databaseName is not set.
    materializedFields =
      chartConfig.with?.length || !chartConfig.from.databaseName
        ? undefined
        : await metadata.getMaterializedColumnsLookupTable({
            connectionId: chartConfig.connection,
            databaseName: chartConfig.from.databaseName,
            tableName: chartConfig.from.tableName,
          });
  } catch {
    // ignore
  }

  const isRatio =
    chartConfig.seriesReturnType === 'ratio' && selectList.length === 2;

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
            : chSql`${{ UNSAFE_RAW_SQL: select.valueExpression }}`;
      } else if (
        select.aggFn.startsWith('quantile') ||
        select.aggFn.startsWith('histogram')
      ) {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          // @ts-expect-error (TS doesn't know that we've already checked for quantile)
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

      const rawSQL = `SELECT ${expr.sql} FROM \`t\``;
      if (materializedFields) {
        expr.sql = fastifySQL({ materializedFields, rawSQL })
          .replace(/^SELECT\s+/i, '') // Remove 'SELECT ' from the start
          .replace(/\s+FROM `t`$/i, ''); // Remove ' FROM t' from the end
      }

      return chSql`${expr}${
        select.alias != null && select.alias.trim() !== ''
          ? chSql` AS "${{ UNSAFE_RAW_SQL: select.alias }}"`
          : []
      }`;
    }),
  );

  return isRatio
    ? [chSql`divide(${selectsSQL[0]}, ${selectsSQL[1]})`]
    : selectsSQL;
}

function renderSortSpecificationList(
  sortSpecificationList: SortSpecificationList,
) {
  if (typeof sortSpecificationList === 'string') {
    return chSql`${{ UNSAFE_RAW_SQL: sortSpecificationList }}`;
  }

  return sortSpecificationList.map(sortSpecification => {
    return chSql`${{ UNSAFE_RAW_SQL: sortSpecification.valueExpression }} ${
      sortSpecification.ordering === 'DESC' ? 'DESC' : 'ASC'
    }`;
  });
}

function timeBucketExpr({
  interval,
  timestampValueExpression,
  dateRange,
  alias = FIXED_TIME_BUCKET_EXPR_ALIAS,
}: {
  interval: SQLInterval | 'auto';
  timestampValueExpression: string;
  dateRange?: [Date, Date];
  alias?: string;
}) {
  const unsafeTimestampValueExpression = {
    UNSAFE_RAW_SQL: getFirstTimestampValueExpression(timestampValueExpression),
  };
  const unsafeInterval = {
    UNSAFE_RAW_SQL:
      interval === 'auto' && Array.isArray(dateRange)
        ? convertDateRangeToGranularityString(dateRange)
        : interval,
  };

  return chSql`toStartOfInterval(toDateTime(${unsafeTimestampValueExpression}), INTERVAL ${unsafeInterval}) AS \`${{
    UNSAFE_RAW_SQL: alias,
  }}\``;
}

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
  with: withClauses,
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
  with?: ChartConfigWithDateRange['with'];
}) {
  const startTime = dateRange[0].getTime();
  const endTime = dateRange[1].getTime();

  let optimizedTimestampValueExpression = timestampValueExpression;
  try {
    // Not all of these will be available when selecting from a CTE
    if (databaseName && tableName && connectionId) {
      const { primary_key } = await metadata.getTableMetadata({
        databaseName,
        tableName,
        connectionId,
      });
      optimizedTimestampValueExpression = optimizeTimestampValueExpression(
        timestampValueExpression,
        primary_key,
      );
    }
  } catch (e) {
    console.warn('Failed to optimize timestampValueExpression', e);
  }

  const valueExpressions = splitAndTrimWithBracket(
    optimizedTimestampValueExpression,
  );

  const whereExprs = await Promise.all(
    valueExpressions.map(async expr => {
      const col = expr.trim();

      // If the expression includes a toStartOf...(...) function, the RHS of the
      // timestamp comparison must also have the same function
      const toStartOf = parseToStartOfFunction(col);

      const columnMeta =
        withClauses?.length || toStartOf
          ? null
          : await metadata.getColumn({
              databaseName,
              tableName,
              column: col,
              connectionId,
            });

      const unsafeTimestampValueExpression = {
        UNSAFE_RAW_SQL: col,
      };

      if (columnMeta == null && !withClauses?.length && !toStartOf) {
        console.warn(
          `Column ${col} not found in ${databaseName}.${tableName} while inferring type for time filter`,
        );
      }

      const startTimeCond = includedDataInterval
        ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: startTime }}), INTERVAL ${includedDataInterval}) - INTERVAL ${includedDataInterval}`
        : toStartOf
          ? chSql`${toStartOf.function}(fromUnixTimestamp64Milli(${{ Int64: startTime }})${toStartOf.formattedRemainingArgs})`
          : chSql`fromUnixTimestamp64Milli(${{ Int64: startTime }})`;

      const endTimeCond = includedDataInterval
        ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: endTime }}), INTERVAL ${includedDataInterval}) + INTERVAL ${includedDataInterval}`
        : toStartOf
          ? chSql`${toStartOf.function}(fromUnixTimestamp64Milli(${{ Int64: endTime }})${toStartOf.formattedRemainingArgs})`
          : chSql`fromUnixTimestamp64Milli(${{ Int64: endTime }})`;

      // If it's a date type
      if (columnMeta?.type === 'Date') {
        return chSql`(${unsafeTimestampValueExpression} ${
          dateRangeStartInclusive ? '>=' : '>'
        } toDate(${startTimeCond}) AND ${unsafeTimestampValueExpression} ${
          dateRangeEndInclusive ? '<=' : '<'
        } toDate(${endTimeCond}))`;
      } else {
        return chSql`(${unsafeTimestampValueExpression} ${
          dateRangeStartInclusive ? '>=' : '>'
        } ${startTimeCond} AND ${unsafeTimestampValueExpression} ${
          dateRangeEndInclusive ? '<=' : '<'
        } ${endTimeCond})`;
      }
    }),
  );

  return concatChSql('AND', ...whereExprs);
}

async function renderSelect(
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql> {
  /**
   * SELECT
   *   if granularity: toStartOfInterval,
   *   if groupBy: groupBy,
   *   select
   */
  const isIncludingTimeBucket = isUsingGranularity(chartConfig);
  const isIncludingGroupBy = isUsingGroupBy(chartConfig);

  // TODO: clean up these await mess
  return concatChSql(
    ',',
    await renderSelectList(chartConfig.select, chartConfig, metadata),
    isIncludingGroupBy && chartConfig.selectGroupBy !== false
      ? await renderSelectList(chartConfig.groupBy, chartConfig, metadata)
      : [],
    isIncludingTimeBucket
      ? timeBucketExpr({
          interval: chartConfig.granularity,
          timestampValueExpression: chartConfig.timestampValueExpression,
          dateRange: chartConfig.dateRange,
        })
      : [],
  );
}

function renderFrom({
  from,
}: {
  from: ChartConfigWithDateRange['from'];
}): ChSql {
  return concatChSql(
    '.',
    chSql`${from.databaseName === '' ? '' : { Identifier: from.databaseName }}`,
    chSql`${{
      Identifier: from.tableName,
    }}`,
  );
}

async function renderWhereExpression({
  condition,
  language,
  metadata,
  from,
  implicitColumnExpression,
  connectionId,
  with: withClauses,
}: {
  condition: SearchCondition;
  language: SearchConditionLanguage;
  metadata: Metadata;
  from: ChartConfigWithDateRange['from'];
  implicitColumnExpression?: string;
  connectionId: string;
  with?: ChartConfigWithDateRange['with'];
}): Promise<ChSql> {
  let _condition = condition;
  if (language === 'lucene') {
    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName: from.databaseName,
      tableName: from.tableName,
      implicitColumnExpression,
      connectionId: connectionId,
    });
    const builder = new SearchQueryBuilder(condition, serializer);
    _condition = await builder.build();
  }

  // This metadata query is executed in an attempt tp optimize the selects by favoring materialized fields
  // on a view/table that already perform the computation in select. This optimization is not currently
  // supported for queries using CTEs so skip the metadata fetch if there are CTE objects in the config.

  let materializedFields: Map<string, string> | undefined;
  try {
    // This will likely error when referencing a CTE, which is assumed
    // to be the case when from.databaseName is not set.
    materializedFields =
      withClauses?.length || !from.databaseName
        ? undefined
        : await metadata.getMaterializedColumnsLookupTable({
            connectionId,
            databaseName: from.databaseName,
            tableName: from.tableName,
          });
  } catch {
    // ignore
  }

  const _sqlPrefix = 'SELECT * FROM `t` WHERE ';
  const rawSQL = `${_sqlPrefix}${_condition}`;
  // strip 'SELECT * FROM `t` WHERE ' from the sql
  if (materializedFields) {
    _condition = fastifySQL({ materializedFields, rawSQL }).replace(
      _sqlPrefix,
      '',
    );
  }
  return chSql`${{ UNSAFE_RAW_SQL: _condition }}`;
}

async function renderWhere(
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql> {
  let whereSearchCondition: ChSql | [] = [];
  if (isNonEmptyWhereExpr(chartConfig.where)) {
    whereSearchCondition = wrapChSqlIfNotEmpty(
      await renderWhereExpression({
        condition: chartConfig.where,
        from: chartConfig.from,
        language: chartConfig.whereLanguage ?? 'sql',
        implicitColumnExpression: chartConfig.implicitColumnExpression,
        metadata,
        connectionId: chartConfig.connection,
        with: chartConfig.with,
      }),
      '(',
      ')',
    );
  }

  let selectSearchConditions: ChSql[] = [];
  if (
    typeof chartConfig.select != 'string' &&
    // Only if every select has an aggCondition, add to where clause
    // otherwise we'll scan all rows anyways
    chartConfig.select.every(select => isNonEmptyWhereExpr(select.aggCondition))
  ) {
    selectSearchConditions = (
      await Promise.all(
        chartConfig.select.map(async select => {
          if (isNonEmptyWhereExpr(select.aggCondition)) {
            return await renderWhereExpression({
              condition: select.aggCondition,
              from: chartConfig.from,
              language: select.aggConditionLanguage ?? 'sql',
              implicitColumnExpression: chartConfig.implicitColumnExpression,
              metadata,
              connectionId: chartConfig.connection,
              with: chartConfig.with,
            });
          }
          return null;
        }),
      )
    ).filter(v => v !== null) as ChSql[];
  }

  const filterConditions = await Promise.all(
    (chartConfig.filters ?? []).map(async filter => {
      if (filter.type === 'sql_ast') {
        return wrapChSqlIfNotEmpty(
          chSql`${{ UNSAFE_RAW_SQL: filter.left }} ${filter.operator} ${{ UNSAFE_RAW_SQL: filter.right }}`,
          '(',
          ')',
        );
      } else if (filter.type === 'lucene' || filter.type === 'sql') {
        return wrapChSqlIfNotEmpty(
          await renderWhereExpression({
            condition: filter.condition,
            from: chartConfig.from,
            language: filter.type,
            implicitColumnExpression: chartConfig.implicitColumnExpression,
            metadata,
            connectionId: chartConfig.connection,
            with: chartConfig.with,
          }),
          '(',
          ')',
        );
      }

      throw new Error(`Unknown filter type: ${filter.type}`);
    }),
  );

  return concatChSql(
    ' AND ',
    chartConfig.dateRange != null &&
      chartConfig.timestampValueExpression != null
      ? await timeFilterExpr({
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
        })
      : [],
    whereSearchCondition,
    // Add aggConditions to where clause to utilize index
    wrapChSqlIfNotEmpty(concatChSql(' OR ', selectSearchConditions), '(', ')'),
    wrapChSqlIfNotEmpty(
      concatChSql(
        chartConfig.filtersLogicalOperator === 'OR' ? ' OR ' : ' AND ',
        ...filterConditions,
      ),
      '(',
      ')',
    ),
  );
}

async function renderGroupBy(
  chartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<ChSql | undefined> {
  return concatChSql(
    ',',
    isUsingGroupBy(chartConfig)
      ? await renderSelectList(chartConfig.groupBy, chartConfig, metadata)
      : [],
    isUsingGranularity(chartConfig)
      ? timeBucketExpr({
          interval: chartConfig.granularity,
          timestampValueExpression: chartConfig.timestampValueExpression,
          dateRange: chartConfig.dateRange,
        })
      : [],
  );
}

async function renderHaving(
  chartConfig: ChartConfigWithOptDateRangeEx,
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
  chartConfig: ChartConfigWithOptDateRange,
): ChSql | undefined {
  const isIncludingTimeBucket = isUsingGranularity(chartConfig);

  if (chartConfig.orderBy == null && !isIncludingTimeBucket) {
    return undefined;
  }

  return concatChSql(
    ',',
    isIncludingTimeBucket
      ? timeBucketExpr({
          interval: chartConfig.granularity,
          timestampValueExpression: chartConfig.timestampValueExpression,
          dateRange: chartConfig.dateRange,
        })
      : [],
    chartConfig.orderBy != null
      ? renderSortSpecificationList(chartConfig.orderBy)
      : [],
  );
}

function renderLimit(
  chartConfig: ChartConfigWithOptDateRange,
): ChSql | undefined {
  if (chartConfig.limit == null || chartConfig.limit.limit == null) {
    return undefined;
  }

  const offset =
    chartConfig.limit.offset != null
      ? chSql` OFFSET ${{ Int32: chartConfig.limit.offset }}`
      : [];

  return chSql`${{ Int32: chartConfig.limit.limit }}${offset}`;
}

function renderSettings(
  chartConfig: ChartConfigWithOptDateRangeEx,
  querySettings: QuerySettings | undefined,
) {
  const querySettingsJoined = joinQuerySettings(querySettings);

  return concatChSql(', ', [
    chSql`${chartConfig.settings ?? ''}`,
    chSql`${querySettingsJoined ?? ''}`,
  ]);
}

// includedDataInterval isn't exported at this time. It's only used internally
// for metric SQL generation.
export type ChartConfigWithOptDateRangeEx = ChartConfigWithOptDateRange & {
  includedDataInterval?: string;
  settings?: ChSql;
};

async function renderWith(
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
  querySettings: QuerySettings | undefined,
): Promise<ChSql | undefined> {
  const { with: withClauses } = chartConfig;
  if (withClauses) {
    return concatChSql(
      ',',
      await Promise.all(
        withClauses.map(async clause => {
          const {
            sql,
            chartConfig,
          }: { sql?: ChSql; chartConfig?: CteChartConfig } = clause;

          // The sql logic can be specified as either a ChSql instance or a chart
          // config object. Due to type erasure and the recursive nature of ChartConfig
          // when using CTEs, we need to validate the types here to ensure junk did
          // not make it through.
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

          if (
            chartConfig &&
            !ChartConfigSchema.safeParse(chartConfig).success
          ) {
            throw new Error(
              `non-conforming chartConfig object in CTE: ${ChartConfigSchema.safeParse(chartConfig).error}`,
            );
          }

          // Note that every NonRecursiveChartConfig object is also a ChartConfig object
          // without a `with` property. The type cast here prevents a type error but because
          // results in schema conformance.
          const resolvedSql = sql
            ? sql
            : await renderChartConfig(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentional, see comment above
                chartConfig as ChartConfig,
                metadata,
                querySettings,
              );

          if (clause.isSubquery === false) {
            return chSql`(${resolvedSql}) AS ${{ Identifier: clause.name }}`;
          }
          // Can not use identifier here
          return chSql`${clause.name} AS (${resolvedSql})`;
        }),
      ),
    );
  }

  return undefined;
}

function intervalToSeconds(interval: SQLInterval): number {
  // Parse interval string like "15 second" into number of seconds
  const [amount, unit] = interval.split(' ');
  const value = parseInt(amount, 10);
  switch (unit) {
    case 'second':
      return value;
    case 'minute':
      return value * 60;
    case 'hour':
      return value * 60 * 60;
    case 'day':
      return value * 24 * 60 * 60;
    default:
      throw new Error(`Invalid interval unit ${unit} in interval ${interval}`);
  }
}

function renderFill(
  chartConfig: ChartConfigWithOptDateRangeEx,
): ChSql | undefined {
  const { granularity, dateRange } = chartConfig;
  if (dateRange && granularity && granularity !== 'auto') {
    const [start, end] = dateRange;
    const step = intervalToSeconds(granularity);

    return concatChSql(' ', [
      chSql`FROM toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: start.getTime() }}), INTERVAL ${granularity}))
      TO toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: end.getTime() }}), INTERVAL ${granularity}))
      STEP ${{ Int32: step }}`,
    ]);
  }

  return undefined;
}

function renderDeltaExpression(
  chartConfig: ChartConfigWithOptDateRange,
  valueExpression: string,
) {
  const interval =
    chartConfig.granularity === 'auto' && Array.isArray(chartConfig.dateRange)
      ? convertDateRangeToGranularityString(chartConfig.dateRange)
      : chartConfig.granularity;
  const intervalInSeconds = convertGranularityToSeconds(interval ?? '');

  const valueDiff = `(argMax(${valueExpression}, ${chartConfig.timestampValueExpression}) - argMin(${valueExpression}, ${chartConfig.timestampValueExpression}))`;
  const timeDiffInSeconds = `date_diff('second', min(toDateTime(${chartConfig.timestampValueExpression})), max(toDateTime(${chartConfig.timestampValueExpression})))`;

  // Prevent division by zero, if timeDiffInSeconds is 0, return 0
  // The delta is extrapolated to the bucket interval, to match prometheus delta() behavior
  return `IF(${timeDiffInSeconds} > 0, ${valueDiff} * ${intervalInSeconds} / ${timeDiffInSeconds}, 0)`;
}

async function translateMetricChartConfig(
  chartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<ChartConfigWithOptDateRangeEx> {
  const metricTables = chartConfig.metricTables;
  if (!metricTables) {
    return chartConfig;
  }

  // assumes all the selects are from a single metric type, for now
  const { select, from, filters, where, ...restChartConfig } = chartConfig;
  if (!select || !Array.isArray(select)) {
    throw new Error('multi select or string select on metrics not supported');
  }

  const { metricType, metricName, metricNameSql, ..._select } = select[0]; // Initial impl only supports one metric select per chart config
  if (metricType === MetricsDataType.Gauge && metricName) {
    const timeBucketCol = '__hdx_time_bucket2';
    const timeExpr = timeBucketExpr({
      interval: chartConfig.granularity || 'auto',
      timestampValueExpression:
        chartConfig.timestampValueExpression ||
        DEFAULT_METRIC_TABLE_TIME_COLUMN,
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
    });

    const where = await renderWhere(
      {
        ...chartConfig,
        from: {
          ...from,
          tableName: metricTables[MetricsDataType.Gauge],
        },
        filters: [
          ...(filters ?? []),
          {
            type: 'sql',
            condition: createMetricNameFilter(metricName, metricNameSql),
          },
        ],
      },
      metadata,
    );

    const bucketValueExpr = _select.isDelta
      ? renderDeltaExpression(chartConfig, 'Value')
      : `last_value(Value)`;

    return {
      ...restChartConfig,
      with: [
        {
          name: 'Source',
          sql: chSql`
            SELECT
              *,
              cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS AttributesHash
            FROM ${renderFrom({ from: { ...from, tableName: metricTables[MetricsDataType.Gauge] } })}
            WHERE ${where}
          `,
        },
        {
          name: 'Bucketed',
          sql: chSql`
            SELECT
              ${timeExpr},
              AttributesHash,
              ${bucketValueExpr} AS LastValue,
              any(ScopeAttributes) AS ScopeAttributes,
              any(ResourceAttributes) AS ResourceAttributes,
              any(Attributes) AS Attributes,
              any(ResourceSchemaUrl) AS ResourceSchemaUrl,
              any(ScopeName) AS ScopeName,
              any(ScopeVersion) AS ScopeVersion,
              any(ScopeDroppedAttrCount) AS ScopeDroppedAttrCount,
              any(ScopeSchemaUrl) AS ScopeSchemaUrl,
              any(ServiceName) AS ServiceName,
              any(MetricDescription) AS MetricDescription,
              any(MetricUnit) AS MetricUnit,
              any(StartTimeUnix) AS StartTimeUnix,
              any(Flags) AS Flags
            FROM Source
            GROUP BY AttributesHash, ${timeBucketCol}
            ORDER BY AttributesHash, ${timeBucketCol}
          `,
        },
      ],
      select: [
        {
          ..._select,
          valueExpression: 'LastValue',
          aggCondition: '', // clear up the condition since the where clause is already applied at the upstream CTE
        },
      ],
      from: {
        databaseName: '',
        tableName: 'Bucketed',
      },
      where: '', // clear up the condition since the where clause is already applied at the upstream CTE
      timestampValueExpression: timeBucketCol,
      settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
    };
  } else if (metricType === MetricsDataType.Sum && metricName) {
    const timeBucketCol = '__hdx_time_bucket2';
    const valueHighCol = '`__hdx_value_high`';
    const valueHighPrevCol = '`__hdx_value_high_prev`';
    const timeExpr = timeBucketExpr({
      interval: chartConfig.granularity || 'auto',
      timestampValueExpression:
        chartConfig.timestampValueExpression || 'TimeUnix',
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
    });

    // Render the where clause to limit data selection on the source CTE but also search forward/back one
    // bucket window to ensure that there is enough data to compute a reasonable value on the ends of the
    // series.
    const where = await renderWhere(
      {
        ...chartConfig,
        from: {
          ...from,
          tableName: metricTables[MetricsDataType.Sum],
        },
        filters: [
          ...(filters ?? []),
          {
            type: 'sql',
            condition: createMetricNameFilter(metricName, metricNameSql),
          },
        ],
        includedDataInterval:
          chartConfig.granularity === 'auto' &&
          Array.isArray(chartConfig.dateRange)
            ? convertDateRangeToGranularityString(chartConfig.dateRange)
            : chartConfig.granularity,
      },
      metadata,
    );

    /**
     * See: https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/metrics/v1/metrics.proto
     * AGGREGATION_TEMPORALITY_DELTA = 1;
     * AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
     *
     * Note, IsMonotonic = 0, has Cumulative agg temporality
     */
    return {
      ...restChartConfig,
      with: [
        {
          name: 'Source',
          sql: chSql`
                SELECT
                  *,
                  cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS AttributesHash,
                  IF(AggregationTemporality = 1,
                    SUM(Value) OVER (PARTITION BY AttributesHash ORDER BY AttributesHash, TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
                    IF(IsMonotonic = 0, 
                      Value,
                      deltaSum(Value) OVER (PARTITION BY AttributesHash ORDER BY AttributesHash, TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                    )
                  ) AS Rate,
                  IF(AggregationTemporality = 1, Rate, Value) AS Sum
                FROM ${renderFrom({ from: { ...from, tableName: metricTables[MetricsDataType.Sum] } })}
                WHERE ${where}`,
        },
        {
          name: 'Bucketed',
          sql: chSql`
            SELECT
              ${timeExpr},
              AttributesHash,
              last_value(Source.Rate) AS ${valueHighCol},
              any(${valueHighCol}) OVER(PARTITION BY AttributesHash ORDER BY \`${timeBucketCol}\` ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS ${valueHighPrevCol},
              IF(IsMonotonic = 1, ${valueHighCol} - ${valueHighPrevCol}, ${valueHighCol}) AS Rate,
              last_value(Source.Sum) AS Sum,
              any(ResourceAttributes) AS ResourceAttributes,
              any(ResourceSchemaUrl) AS ResourceSchemaUrl,
              any(ScopeName) AS ScopeName,
              any(ScopeVersion) AS ScopeVersion,
              any(ScopeAttributes) AS ScopeAttributes,
              any(ScopeDroppedAttrCount) AS ScopeDroppedAttrCount,
              any(ScopeSchemaUrl) AS ScopeSchemaUrl,
              any(ServiceName) AS ServiceName,
              any(MetricName) AS MetricName,
              any(MetricDescription) AS MetricDescription,
              any(MetricUnit) AS MetricUnit,
              any(Attributes) AS Attributes,
              any(StartTimeUnix) AS StartTimeUnix,
              any(Flags) AS Flags,
              any(AggregationTemporality) AS AggregationTemporality,
              any(IsMonotonic) AS IsMonotonic
            FROM Source
            GROUP BY AttributesHash, \`${timeBucketCol}\`
            ORDER BY AttributesHash, \`${timeBucketCol}\`
          `,
        },
      ],
      select: [
        // HDX-1543: If the chart config query asks for an aggregation, the use the computed rate value, otherwise
        // use the underlying summed value. The alias field appears before the spread so user defined aliases will
        // take precedent over our generic value.
        _select.aggFn
          ? {
              alias: 'Value',
              ..._select,
              valueExpression: 'Rate',
              aggCondition: '',
            }
          : {
              alias: 'Value',
              ..._select,
              valueExpression: 'last_value(Sum)',
              aggCondition: '',
            },
      ],
      from: {
        databaseName: '',
        tableName: 'Bucketed',
      },
      where: '', // clear up the condition since the where clause is already applied at the upstream CTE
      timestampValueExpression: `\`${timeBucketCol}\``,
    };
  } else if (metricType === MetricsDataType.Histogram && metricName) {
    const { alias } = _select;
    // Use the alias from the select, defaulting to 'Value' for backwards compatibility
    const valueAlias = alias || 'Value';

    // Render the various clauses from the user input so they can be woven into the CTE queries. The dateRange
    // is manipulated to search forward/back one bucket window to ensure that there is enough data to compute
    // a reasonable value on the ends of the series.

    const cteChartConfig = {
      ...chartConfig,
      from: {
        ...from,
        tableName: metricTables[MetricsDataType.Histogram],
      },
      filters: [
        ...(filters ?? []),
        {
          type: 'sql',
          condition: createMetricNameFilter(metricName, metricNameSql),
        },
      ],
      includedDataInterval:
        chartConfig.granularity === 'auto' &&
        Array.isArray(chartConfig.dateRange)
          ? convertDateRangeToGranularityString(chartConfig.dateRange)
          : chartConfig.granularity,
    } as ChartConfigWithOptDateRangeEx;

    const timeBucketSelect = isUsingGranularity(cteChartConfig)
      ? timeBucketExpr({
          interval: cteChartConfig.granularity,
          timestampValueExpression: cteChartConfig.timestampValueExpression,
          dateRange: cteChartConfig.dateRange,
        })
      : chSql``;
    const where = await renderWhere(cteChartConfig, metadata);

    // Time bucket grouping is being handled separately, so make sure to ignore the granularity
    // logic for histograms specifically.
    let groupBy: ChSql | undefined;
    if (isUsingGroupBy(chartConfig)) {
      groupBy = concatChSql(
        ',',
        await renderSelectList(chartConfig.groupBy, chartConfig, metadata),
      );
    }

    return {
      ...restChartConfig,
      with: translateHistogram({
        select: _select,
        timeBucketSelect: timeBucketSelect.sql
          ? chSql`${timeBucketSelect}`
          : 'TimeUnix AS `__hdx_time_bucket`',
        groupBy,
        from: renderFrom({
          from: {
            ...from,
            tableName: metricTables[MetricsDataType.Histogram],
          },
        }),
        where,
        valueAlias,
      }),
      select: `\`__hdx_time_bucket\`${groupBy ? ', group' : ''}, "${valueAlias}"`,
      from: {
        databaseName: '',
        tableName: 'metrics',
      },
      where: '', // clear up the condition since the where clause is already applied at the upstream CTE
      groupBy: undefined,
      granularity: undefined, // time bucketing and granularity is applied at the source CTE
      timestampValueExpression: '`__hdx_time_bucket`',
      settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
    };
  }

  throw new Error(`no query support for metric type=${metricType}`);
}

export async function renderChartConfig(
  rawChartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
  querySettings: QuerySettings | undefined,
): Promise<ChSql> {
  // metric types require more rewriting since we know more about the schema
  // but goes through the same generation process
  const chartConfig = isMetricChartConfig(rawChartConfig)
    ? await translateMetricChartConfig(rawChartConfig, metadata)
    : rawChartConfig;

  const withClauses = await renderWith(chartConfig, metadata, querySettings);
  const select = await renderSelect(chartConfig, metadata);
  const from = renderFrom(chartConfig);
  const where = await renderWhere(chartConfig, metadata);
  const groupBy = await renderGroupBy(chartConfig, metadata);
  const having = await renderHaving(chartConfig, metadata);
  const orderBy = renderOrderBy(chartConfig);
  //const fill = renderFill(chartConfig); //TODO: Fill breaks heatmaps and some charts
  const limit = renderLimit(chartConfig);
  const settings = renderSettings(chartConfig, querySettings);

  return concatChSql(' ', [
    chSql`${withClauses?.sql ? chSql`WITH ${withClauses}` : ''}`,
    chSql`SELECT ${select}`,
    chSql`FROM ${from}`,
    chSql`${where.sql ? chSql`WHERE ${where}` : ''}`,
    chSql`${groupBy?.sql ? chSql`GROUP BY ${groupBy}` : ''}`,
    chSql`${having?.sql ? chSql`HAVING ${having}` : ''}`,
    chSql`${orderBy?.sql ? chSql`ORDER BY ${orderBy}` : ''}`,
    //chSql`${fill?.sql ? chSql`WITH FILL ${fill}` : ''}`,
    chSql`${limit?.sql ? chSql`LIMIT ${limit}` : ''}`,

    // SETTINGS must be last - see `extractSettingsClause` in "./utils.ts"
    chSql`${settings.sql ? chSql`SETTINGS ${settings}` : []}`,
  ]);
}

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
