import isPlainObject from 'lodash/isPlainObject';
import * as SQLParser from 'node-sql-parser';

import { ChSql, chSql, concatChSql, wrapChSqlIfNotEmpty } from '@/clickhouse';
import { Metadata } from '@/metadata';
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
  SearchCondition,
  SearchConditionLanguage,
  SelectList,
  SelectSQLStatement,
  SortSpecificationList,
  SqlAstFilter,
  SQLInterval,
} from '@/types';
import {
  convertDateRangeToGranularityString,
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@/utils';

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

function isUsingGranularity(
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
            ? `delta(${s.aggFn}(${s.metricName}))`
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
    const parser = new SQLParser.Parser();
    const ast = parser.astify(rawSQL, {
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
          const _n = node as ColumnRef;
          // @ts-ignore
          if (typeof _n.column !== 'string') {
            // @ts-ignore
            colExpr = `${_n.column?.expr.value}['${_n.array_index?.[0]?.index.value}']`;
          }
          break;
        }
        case 'binary_expr': {
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
  quantileLevel,
  where,
}: {
  fn: AggregateFunction | AggregateFunctionWithCombinators;
  expr?: string;
  quantileLevel?: number;
  where?: string;
}) => {
  const isAny = fn === 'any';
  const isCount = fn.startsWith('count');
  const isWhereUsed = isNonEmptyWhereExpr(where);
  // Cast to float64 because the expr might not be a number
  const unsafeExpr = {
    UNSAFE_RAW_SQL: isAny ? `${expr}` : `toFloat64OrDefault(toString(${expr}))`,
  };
  const whereWithExtraNullCheck = `${where} AND ${unsafeExpr.UNSAFE_RAW_SQL} IS NOT NULL`;

  if (fn.endsWith('Merge')) {
    return chSql`${fn}(${{
      UNSAFE_RAW_SQL: expr ?? '',
    }})`;
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

  if (expr != null) {
    if (fn === 'count_distinct') {
      return chSql`count${isWhereUsed ? 'If' : ''}(DISTINCT ${{
        UNSAFE_RAW_SQL: expr,
      }}${isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: where }}` : ''})`;
    }

    if (quantileLevel != null) {
      return chSql`quantile${isWhereUsed ? 'If' : ''}(${{
        // Using Float64 param leads to an added coersion, but we don't need to
        // escape number values anyways
        UNSAFE_RAW_SQL: Number.isFinite(quantileLevel)
          ? `${quantileLevel}`
          : '0',
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

function withOptionalAlias(
  expr: ChSql,
  select: Exclude<SelectList[0], string>,
) {
  return chSql`${expr}${
    select.alias != null && select.alias.trim() !== ''
      ? chSql` AS "${{ UNSAFE_RAW_SQL: select.alias }}"`
      : []
  }`;
}

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
  const materializedFields = chartConfig.with?.length
    ? undefined
    : await metadata.getMaterializedColumnsLookupTable({
        connectionId: chartConfig.connection,
        databaseName: chartConfig.from.databaseName,
        tableName: chartConfig.from.tableName,
      });

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
        expr = chSql`${{ UNSAFE_RAW_SQL: select.valueExpression }}`;
      } else if (select.aggFn === 'quantile') {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          // @ts-ignore (TS doesn't know that we've already checked for quantile)
          quantileLevel: select.level,
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

      if (select.isDelta && chartConfig.timestampValueExpression) {
        const windowOrderBy = isUsingGranularity(chartConfig)
          ? timeBucketExpr({
              interval: chartConfig.granularity,
              timestampValueExpression: chartConfig.timestampValueExpression,
              dateRange: chartConfig.dateRange,
            })
          : chSql`${chartConfig.timestampValueExpression}`;

        const deltaExpr = concatChSql(
          ' ',
          chSql`${expr} - lag(${expr}) OVER (`,
          isUsingGroupBy(chartConfig)
            ? concatChSql(
                ' ',
                chSql`PARTITION BY`,
                await renderSelectList(
                  chartConfig.groupBy,
                  chartConfig,
                  metadata,
                ),
              )
            : [],
          chSql`ORDER BY ${windowOrderBy})`,
        );

        return withOptionalAlias(deltaExpr, select);
      } else {
        return withOptionalAlias(expr, select);
      }
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
        ? convertDateRangeToGranularityString(dateRange, 60)
        : interval,
  };

  return chSql`toStartOfInterval(toDateTime(${unsafeTimestampValueExpression}), INTERVAL ${unsafeInterval}) AS \`${{
    UNSAFE_RAW_SQL: alias,
  }}\``;
}

async function timeFilterExpr({
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
  const valueExpressions = splitAndTrimWithBracket(timestampValueExpression);
  const startTime = dateRange[0].getTime();
  const endTime = dateRange[1].getTime();

  const whereExprs = await Promise.all(
    valueExpressions.map(async expr => {
      const col = expr.trim();
      const columnMeta = withClauses?.length
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

      if (columnMeta == null && !withClauses?.length) {
        console.warn(
          `Column ${col} not found in ${databaseName}.${tableName} while inferring type for time filter`,
        );
      }

      const startTimeCond = includedDataInterval
        ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: startTime }}), INTERVAL ${includedDataInterval}) - INTERVAL ${includedDataInterval}`
        : chSql`fromUnixTimestamp64Milli(${{ Int64: startTime }})`;

      const endTimeCond = includedDataInterval
        ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: endTime }}), INTERVAL ${includedDataInterval}) + INTERVAL ${includedDataInterval}`
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

  const materializedFields = withClauses?.length
    ? undefined
    : await metadata.getMaterializedColumnsLookupTable({
        connectionId,
        databaseName: from.databaseName,
        tableName: from.tableName,
      });

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

// includedDataInterval isn't exported at this time. It's only used internally
// for metric SQL generation.
type ChartConfigWithOptDateRangeEx = ChartConfigWithOptDateRange & {
  includedDataInterval?: string;
  settings?: ChSql;
};

async function renderWith(
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
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
            throw new Error('non-conforming chartConfig object in CTE');
          }

          // Note that every NonRecursiveChartConfig object is also a ChartConfig object
          // without a `with` property. The type cast here prevents a type error but because
          // results in schema conformance.
          const resolvedSql = sql
            ? sql
            : await renderChartConfig(chartConfig as ChartConfig, metadata);

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

  const { metricType, metricName, ..._select } = select[0]; // Initial impl only supports one metric select per chart config
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
            condition: `MetricName = '${metricName}'`,
          },
        ],
      },
      metadata,
    );

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
              last_value(Value) AS LastValue,
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
            condition: `MetricName = '${metricName}'`,
          },
        ],
        includedDataInterval:
          chartConfig.granularity === 'auto' &&
          Array.isArray(chartConfig.dateRange)
            ? convertDateRangeToGranularityString(chartConfig.dateRange, 60)
            : chartConfig.granularity,
      },
      metadata,
    );

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
                    deltaSum(Value) OVER (PARTITION BY AttributesHash ORDER BY AttributesHash, TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
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
              ${valueHighCol} - ${valueHighPrevCol} AS Rate,
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
    // histograms are only valid for quantile selections
    const { aggFn, level, alias, ..._selectRest } = _select as {
      aggFn: string;
      level?: number;
      alias?: string;
    };

    if (aggFn !== 'quantile' || level == null) {
      throw new Error('quantile must be specified for histogram metrics');
    }

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
          condition: `MetricName = '${metricName}'`,
        },
      ],
      includedDataInterval:
        chartConfig.granularity === 'auto' &&
        Array.isArray(chartConfig.dateRange)
          ? convertDateRangeToGranularityString(chartConfig.dateRange, 60)
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
      with: [
        {
          name: 'source',
          sql: chSql`
          SELECT
            MetricName,
            ExplicitBounds,
            ${timeBucketSelect.sql ? chSql`${timeBucketSelect},` : 'TimeUnix AS `__hdx_time_bucket`'}
            ${groupBy ? chSql`[${groupBy}] as group,` : ''}
            sumForEach(deltas) as rates
          FROM (
            SELECT
              TimeUnix,
              MetricName,
              ResourceAttributes,
              Attributes,
              ExplicitBounds,
              attr_hash,
              any(attr_hash) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_attr_hash,
              any(bounds_hash) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_bounds_hash,
              any(counts) OVER (ROWS BETWEEN 1 preceding AND 1 preceding) AS prev_counts,
              counts,
              IF(
                  AggregationTemporality = 1 ${'' /* denotes a metric that is not monotonic e.g. already a delta */}
                      OR prev_attr_hash != attr_hash ${'' /* the attributes have changed so this is a different metric */}
                      OR bounds_hash != prev_bounds_hash ${'' /* the bucketing has changed so should be treated as different metric */}
                      OR arrayExists((x) -> x.2 < x.1, arrayZip(prev_counts, counts)), ${'' /* a data point has gone down, probably a reset event */}
                  counts,
                  counts - prev_counts
              ) AS deltas
            FROM (
              SELECT
                  TimeUnix,
                  MetricName,
                  AggregationTemporality,
                  ExplicitBounds,
                  ResourceAttributes,
                  Attributes,
                  cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS attr_hash,
                  cityHash64(ExplicitBounds) AS bounds_hash,
                  CAST(BucketCounts AS Array(Int64)) counts
              FROM ${renderFrom({ from: { ...from, tableName: metricTables[MetricsDataType.Histogram] } })}
              WHERE ${where}
              ORDER BY attr_hash, TimeUnix ASC
            )
          )
          GROUP BY \`__hdx_time_bucket\`, MetricName, ${groupBy ? 'group, ' : ''}ExplicitBounds
          ORDER BY \`__hdx_time_bucket\`
          `,
        },
        {
          name: 'points',
          sql: chSql`
          SELECT
            \`__hdx_time_bucket\`,
            MetricName,
            ${groupBy ? 'group,' : ''}
            arrayZipUnaligned(arrayCumSum(rates), ExplicitBounds) as point,
            length(point) as n
          FROM source
          `,
        },
        {
          name: 'metrics',
          sql: chSql`
          SELECT
            \`__hdx_time_bucket\`,
            MetricName,
            ${groupBy ? 'group,' : ''}
            point[n].1 AS total,
            ${{ Float64: level }} * total AS rank,
            arrayFirstIndex(x -> if(x.1 > rank, 1, 0), point) AS upper_idx,
            point[upper_idx].1 AS upper_count,
            ifNull(point[upper_idx].2, inf) AS upper_bound,
            CASE
              WHEN upper_idx > 1 THEN point[upper_idx - 1].2
              WHEN point[upper_idx].2 > 0 THEN 0
              ELSE inf
            END AS lower_bound,
            if (
              lower_bound = 0,
              0,
              point[upper_idx - 1].1
            ) AS lower_count,
            CASE
                WHEN upper_bound = inf THEN point[upper_idx - 1].2
                WHEN lower_bound = inf THEN point[1].2
                ELSE lower_bound + (upper_bound - lower_bound) * ((rank - lower_count) / (upper_count - lower_count))
            END AS "${valueAlias}"
          FROM points
          WHERE length(point) > 1 AND total > 0
          `,
        },
      ],
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
  rawChartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<ChSql> {
  // metric types require more rewriting since we know more about the schema
  // but goes through the same generation process
  const chartConfig = isMetricChartConfig(rawChartConfig)
    ? await translateMetricChartConfig(rawChartConfig, metadata)
    : rawChartConfig;

  const withClauses = await renderWith(chartConfig, metadata);
  const select = await renderSelect(chartConfig, metadata);
  const from = renderFrom(chartConfig);
  const where = await renderWhere(chartConfig, metadata);
  const groupBy = await renderGroupBy(chartConfig, metadata);
  const orderBy = renderOrderBy(chartConfig);
  //const fill = renderFill(chartConfig); //TODO: Fill breaks heatmaps and some charts
  const limit = renderLimit(chartConfig);

  return concatChSql(' ', [
    chSql`${withClauses?.sql ? chSql`WITH ${withClauses}` : ''}`,
    chSql`SELECT ${select}`,
    chSql`FROM ${from}`,
    chSql`${where.sql ? chSql`WHERE ${where}` : ''}`,
    chSql`${groupBy?.sql ? chSql`GROUP BY ${groupBy}` : ''}`,
    chSql`${orderBy?.sql ? chSql`ORDER BY ${orderBy}` : ''}`,
    //chSql`${fill?.sql ? chSql`WITH FILL ${fill}` : ''}`,
    chSql`${limit?.sql ? chSql`LIMIT ${limit}` : ''}`,
    chSql`${'settings' in chartConfig ? chSql`SETTINGS ${chartConfig.settings as ChSql}` : []}`,
  ]);
}

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
