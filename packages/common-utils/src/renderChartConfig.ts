import isPlainObject from 'lodash/isPlainObject';
import * as SQLParser from 'node-sql-parser';

import { ChSql, chSql, concatChSql, wrapChSqlIfNotEmpty } from '@/clickhouse';
import { Metadata } from '@/metadata';
import { CustomSchemaSQLSerializerV2, SearchQueryBuilder } from '@/queryParser';
import {
  AggregateFunction,
  AggregateFunctionWithCombinators,
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  DerivedColumn,
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
    console.error('[renderWhereExpression]feat: Failed to parse SQL AST', e);
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
  const isCount = fn.startsWith('count');
  const isWhereUsed = isNonEmptyWhereExpr(where);
  // Cast to float64 because the expr might not be a number
  const unsafeExpr = { UNSAFE_RAW_SQL: `toFloat64OrNull(toString(${expr}))` };
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

async function renderSelectList(
  selectList: SelectList,
  chartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
) {
  if (typeof selectList === 'string') {
    return chSql`${{ UNSAFE_RAW_SQL: selectList }}`;
  }

  const materializedFields = await metadata.getMaterializedColumnsLookupTable({
    connectionId: chartConfig.connection,
    databaseName: chartConfig.from.databaseName,
    tableName: chartConfig.from.tableName,
  });

  return Promise.all(
    selectList.map(async select => {
      const whereClause = await renderWhereExpression({
        condition: select.aggCondition ?? '',
        from: chartConfig.from,
        language: select.aggConditionLanguage ?? 'lucene',
        implicitColumnExpression: chartConfig.implicitColumnExpression,
        metadata,
        connectionId: chartConfig.connection,
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
      // strip 'SELECT * FROM `t` WHERE ' from the sql
      expr.sql = fastifySQL({ materializedFields, rawSQL })
        .replace(/^SELECT\s+/i, '') // Remove 'SELECT ' from the start
        .replace(/\s+FROM `t`$/i, ''); // Remove ' FROM t' from the end

      return chSql`${expr}${
        select.alias != null
          ? chSql` AS \`${{ UNSAFE_RAW_SQL: select.alias }}\``
          : []
      }`;
    }),
  );
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
  timestampValueExpression,
  dateRange,
  dateRangeStartInclusive,
  databaseName,
  tableName,
  metadata,
  connectionId,
}: {
  timestampValueExpression: string;
  dateRange: [Date, Date];
  dateRangeStartInclusive: boolean;
  metadata: Metadata;
  connectionId: string;
  databaseName: string;
  tableName: string;
}) {
  const valueExpressions = timestampValueExpression.split(',');
  const startTime = dateRange[0].getTime();
  const endTime = dateRange[1].getTime();

  const whereExprs = await Promise.all(
    valueExpressions.map(async expr => {
      const col = expr.trim();
      const columnMeta = await metadata.getColumn({
        databaseName,
        tableName,
        column: col,
        connectionId,
      });

      const unsafeTimestampValueExpression = {
        UNSAFE_RAW_SQL: col,
      };

      if (columnMeta == null) {
        console.warn(
          `Column ${col} not found in ${databaseName}.${tableName} while inferring type for time filter`,
        );
      }

      // If it's a date type
      if (columnMeta?.type === 'Date') {
        return chSql`(${unsafeTimestampValueExpression} ${
          dateRangeStartInclusive ? '>=' : '>'
        } toDate(fromUnixTimestamp64Milli(${{
          Int64: startTime,
        }})) AND ${unsafeTimestampValueExpression} <= toDate(fromUnixTimestamp64Milli(${{
          Int64: endTime,
        }})))`;
      } else {
        return chSql`(${unsafeTimestampValueExpression} ${
          dateRangeStartInclusive ? '>=' : '>'
        } fromUnixTimestamp64Milli(${{
          Int64: startTime,
        }}) AND ${unsafeTimestampValueExpression} <= fromUnixTimestamp64Milli(${{
          Int64: endTime,
        }}))`;
      }
    }),
  );

  return concatChSql('AND', ...whereExprs);
}

async function renderSelect(
  chartConfig: ChartConfigWithOptDateRange,
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
  return chSql`${{ Identifier: from.databaseName }}.${{
    Identifier: from.tableName,
  }}`;
}

async function renderWhereExpression({
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
  from: ChartConfigWithDateRange['from'];
  implicitColumnExpression?: string;
  connectionId: string;
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

  const materializedFields = await metadata.getMaterializedColumnsLookupTable({
    connectionId,
    databaseName: from.databaseName,
    tableName: from.tableName,
  });

  const _sqlPrefix = 'SELECT * FROM `t` WHERE ';
  const rawSQL = `${_sqlPrefix}${_condition}`;
  // strip 'SELECT * FROM `t` WHERE ' from the sql
  _condition = fastifySQL({ materializedFields, rawSQL }).replace(
    _sqlPrefix,
    '',
  );
  return chSql`${{ UNSAFE_RAW_SQL: _condition }}`;
}

async function renderWhere(
  chartConfig: ChartConfigWithOptDateRange,
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
          metadata,
          connectionId: chartConfig.connection,
          databaseName: chartConfig.from.databaseName,
          tableName: chartConfig.from.tableName,
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

function translateMetricChartConfig(
  chartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
): ChartConfigWithOptDateRange {
  const metricTables = chartConfig.metricTables;
  if (!metricTables) {
    return chartConfig;
  }

  // assumes all the selects are from a single metric type, for now
  const { select, from, ...restChartConfig } = chartConfig;
  if (!select || !Array.isArray(select)) {
    throw new Error('multi select or string select on metrics not supported');
  }

  let tableName: string | undefined;
  const newSelect = select.map(s => {
    const { metricType, metricName, ...rest } = s;
    if (metricType === 'gauge' || metricType === 'sum') {
      if (!tableName) {
        tableName =
          metricType === 'gauge' ? metricTables.gauge : metricTables.sum;
      }
      return {
        ...rest,
        valueExpression: 'Value',
        aggCondition: `MetricName = '${metricName}'`,
        aggConditionLanguage: 'sql',
      };
    }
    return s;
  }) as [DerivedColumn];

  if (!tableName) {
    throw new Error('no table name found');
  }

  return {
    ...restChartConfig,
    select: newSelect,
    from: { ...from, tableName },
    groupBy: 'MetricName, ResourceAttributes', // replace with metric specific fields
  };
}

export async function renderChartConfig(
  rawChartConfig: ChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<ChSql> {
  // metric types require more rewriting since we know more about the schema
  // but goes through the same generation process
  const chartConfig =
    rawChartConfig.from.tableName === 'metrics'
      ? translateMetricChartConfig(rawChartConfig, metadata)
      : rawChartConfig;

  const select = await renderSelect(chartConfig, metadata);
  const from = renderFrom(chartConfig);
  const where = await renderWhere(chartConfig, metadata);
  const groupBy = await renderGroupBy(chartConfig, metadata);
  const orderBy = renderOrderBy(chartConfig);
  const limit = renderLimit(chartConfig);

  return chSql`SELECT ${select} FROM ${from} ${where?.sql ? chSql`WHERE ${where}` : ''} ${
    groupBy?.sql ? chSql`GROUP BY ${groupBy}` : ''
  } ${orderBy?.sql ? chSql`ORDER BY ${orderBy}` : ''} ${
    limit?.sql ? chSql`LIMIT ${limit}` : ''
  }`;
}

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
