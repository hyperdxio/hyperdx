import isPlainObject from 'lodash/isPlainObject';
import * as SQLParser from 'node-sql-parser';
import SqlString from 'sqlstring';

import { ChSql, chSql, concatChSql, wrapChSqlIfNotEmpty } from '@/clickhouse';
import {
  GROUP_ALIAS,
  translateExponentialHistogram,
  translateHistogram,
} from '@/core/histogram';
import { Metadata } from '@/core/metadata';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  extractSettingsClauseFromEnd,
  getFirstTimestampValueExpression,
  joinQuerySettings,
  optimizeTimestampValueExpression,
  parseToStartOfFunction,
  pickBucketTimestampColumn,
  splitAndTrimWithBracket,
} from '@/core/utils';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@/guards';
import { replaceMacros } from '@/macros';
import {
  buildTextIndexInfoLookup,
  CustomSchemaSQLSerializerV2,
  SearchQueryBuilder,
  TextIndexInfoLookup,
} from '@/queryParser';
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
  MetricsDataType,
  PromqlChartConfig,
  QuerySettings,
  RawSqlChartConfig,
  SearchCondition,
  SearchConditionLanguage,
  SelectList,
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

const DEFAULT_METRIC_TABLE_TIME_COLUMN = 'TimeUnix';
export const FIXED_TIME_BUCKET_EXPR_ALIAS = '__hdx_time_bucket';

// Maximum number of distinct groups shown in a time chart when using 'increase' with a groupBy.
const INCREASE_MAX_NUM_GROUPS = 20;

export function isUsingGroupBy(
  chartConfig: BuilderChartConfigWithOptDateRange,
): chartConfig is Omit<BuilderChartConfigWithDateRange, 'groupBy'> & {
  groupBy: NonNullable<BuilderChartConfigWithDateRange['groupBy']>;
} {
  return chartConfig.groupBy != null && chartConfig.groupBy.length > 0;
}

export function isUsingGranularity<
  T extends BuilderChartConfigWithOptDateRange,
>(
  chartConfig: T,
): chartConfig is T &
  Omit<
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

export const isMetricChartConfig = (
  chartConfig: BuilderChartConfigWithOptDateRange,
): chartConfig is BuilderChartConfigWithOptDateRange & {
  metricTables: NonNullable<BuilderChartConfigWithOptDateRange['metricTables']>;
} => {
  return chartConfig.metricTables != null;
};

// TODO: apply this to all chart configs
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
          (s.aggFn === 'increase'
            ? `increase(${s.metricName})`
            : s.isDelta
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
  // only split metric queries for now
  if (
    isBuilderChartConfig(config) &&
    isMetricChartConfig(config) &&
    Array.isArray(config.select)
  ) {
    const _configs: BuilderChartConfigWithOptDateRange[] = [];
    // split the query into multiple queries
    for (const select of config.select) {
      _configs.push({
        ...config,
        select: [select],
      });
    }
    return _configs;
  }

  if (
    isRawSqlChartConfig(config) ||
    isPromqlChartConfig(config) ||
    isBuilderChartConfig(config)
  ) {
    return [config];
  }

  throw new Error(`Unexpected chart config type: ${JSON.stringify(config)}`);
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

function hasSubqueryCte(
  withClauses: BuilderChartConfigWithDateRange['with'],
): boolean {
  return withClauses?.some(w => w.isSubquery !== false) ?? false;
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
  } catch {
    return rawSQL;
  }
};

function generateHasSqlForKvItemsColumn(
  column: string,
  key: string,
  separator: string,
  value: string,
): string {
  return SqlString.format('has(??, concat(?, ?, ?))', [
    column,
    key,
    separator,
    value,
  ]);
}

export const rewriteSqlFilterWithKvItems = (
  condition: string,
  textIndexInfoLookup: TextIndexInfoLookup,
): string => {
  if (textIndexInfoLookup.size === 0) return condition;
  try {
    const parser = new SQLParser.Parser();
    const prefix = 'SELECT 1 FROM `t` WHERE ';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ast = parser.astify(`${prefix}${condition}`, {
      database: 'Postgresql',
    }) as SQLParser.Select;

    const tryOptimize = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList,
    ): void => {
      if (!('operator' in node)) return;
      const op = String(node.operator ?? '').toUpperCase();
      if (op !== '=' && op !== 'IN') return;
      const left = node.left;
      if (
        left?.type !== 'column_ref' ||
        ('column' in left && typeof left.column === 'string')
      ) {
        return;
      }
      const mapColumn = left['column']?.expr?.value;
      const arrIdx = left['array_index'];
      if (
        typeof mapColumn !== 'string' ||
        !Array.isArray(arrIdx) ||
        arrIdx.length !== 1
      ) {
        return;
      }
      const idxNode = arrIdx[0]?.index;
      if (
        idxNode?.type !== 'single_quote_string' ||
        typeof idxNode.value !== 'string'
      ) {
        return;
      }
      const mapKey: string = idxNode.value;
      const info = textIndexInfoLookup.get(mapColumn)?.kv;
      if (!info) return;

      let values: string[];
      if (op === '=') {
        const right = node.right;
        if (
          right?.type !== 'single_quote_string' ||
          typeof right.value !== 'string'
        ) {
          return;
        }
        values = [right.value];
      } else {
        const right = node.right;
        if (right?.type !== 'expr_list' || !Array.isArray(right.value)) return;
        const collected: string[] = [];
        for (const item of right.value) {
          if (
            item?.type !== 'single_quote_string' ||
            typeof item.value !== 'string'
          ) {
            return;
          }
          collected.push(item.value);
        }
        values = collected;
      }
      // Bail on empty values: `Map['k']='' ` also matches absent keys because
      // Map(String, String)'s subscript default is '', which `has(items, 'k=')`
      // alone does not preserve. Same rationale for empty entries in IN lists.
      if (values.length === 0 || values.some(v => v === '')) return;

      let replacement: string;
      if (values.length === 1) {
        replacement = generateHasSqlForKvItemsColumn(
          info.columnName,
          mapKey,
          info.separator,
          values[0],
        );
      } else if (info.useHasAny) {
        // ClickHouse >= 26.5 supports `hasAny` over the direct_read map items
        // column in a single call.
        replacement = `hasAny(${SqlString.format('??', [
          info.columnName,
        ])}, array(${values
          .map(v =>
            SqlString.format('concat(?, ?, ?)', [mapKey, info.separator, v]),
          )
          .join(', ')}))`;
      } else {
        // Backport branches (26.2/26.3/26.4) support `has` but not `hasAny` over
        // the items column, so we fall back to a chain of `has(...) OR ...`.
        replacement = `(${values
          .map(v =>
            generateHasSqlForKvItemsColumn(
              info.columnName,
              mapKey,
              info.separator,
              v,
            ),
          )
          .join(' OR ')})`;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- astify returns union type, we expect Select
      const replAst = parser.astify(`${prefix}${replacement}`, {
        database: 'Postgresql',
      }) as SQLParser.Select;
      const newWhere = replAst.where;
      if (newWhere == null) return;
      for (const k of Object.keys(node)) delete node[k];
      Object.assign(node, newWhere);
    };

    const traverse = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList | null,
    ): void => {
      if (node == null) return;
      if (node.type === 'binary_expr') {
        if ('left' in node) {
          traverse(node.left);
        }
        if ('right' in node) {
          traverse(node.right);
        }
        tryOptimize(node);
      } else if (node.type === 'expr_list' && Array.isArray(node.value)) {
        node.value.forEach(traverse);
      }
    };
    traverse(ast.where);

    return parser.sqlify(ast).slice(prefix.length);
  } catch {
    return condition;
  }
};

const aggFnExpr = ({
  fn,
  expr,
  level,
  where,
  sampleWeightExpression,
}: {
  fn: AggregateFunction | AggregateFunctionWithCombinators;
  expr?: string;
  level?: number;
  where?: string;
  sampleWeightExpression?: string;
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

  // Sample-weighted aggregations: when sampleWeightExpression is set,
  // each row carries a weight (defaults to 1 for unsampled spans).
  // Corrected formulas account for upstream sampling (1-in-N).
  // The greatest(..., 1) ensures unsampled rows (missing/empty/zero)
  // are counted at weight 1 rather than dropped.
  if (
    sampleWeightExpression &&
    !fn.endsWith('Merge') &&
    !fn.endsWith('State')
  ) {
    const sampleWeightExpr = `greatest(toUInt64OrZero(toString(${sampleWeightExpression})), 1)`;
    const w = { UNSAFE_RAW_SQL: sampleWeightExpr };

    if (fn === 'count') {
      return isWhereUsed
        ? chSql`sumIf(${w}, ${{ UNSAFE_RAW_SQL: where }})`
        : chSql`sum(${w})`;
    }

    if (fn === 'none') {
      return chSql`${{ UNSAFE_RAW_SQL: expr ?? '' }}`;
    }

    if (expr != null) {
      if (fn === 'count_distinct' || fn === 'min' || fn === 'max') {
        // These cannot be corrected for sampling; pass through unchanged
        if (fn === 'count_distinct') {
          return chSql`count${isWhereUsed ? 'If' : ''}(DISTINCT ${{
            UNSAFE_RAW_SQL: expr,
          }}${isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: where }}` : ''})`;
        }
        return chSql`${{ UNSAFE_RAW_SQL: fn }}${isWhereUsed ? 'If' : ''}(
          ${unsafeExpr}${isWhereUsed ? chSql`, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }}` : ''}
        )`;
      }

      if (fn === 'avg') {
        const weightedVal = {
          UNSAFE_RAW_SQL: `${unsafeExpr.UNSAFE_RAW_SQL} * ${sampleWeightExpr}`,
        };
        const nullCheck = `${unsafeExpr.UNSAFE_RAW_SQL} IS NOT NULL`;
        if (isWhereUsed) {
          const cond = { UNSAFE_RAW_SQL: `${where} AND ${nullCheck}` };
          return chSql`sumIf(${weightedVal}, ${cond}) / nullIf(sumIf(${w}, ${cond}), 0)`;
        }
        return chSql`sumIf(${weightedVal}, ${{ UNSAFE_RAW_SQL: nullCheck }}) / nullIf(sumIf(${w}, ${{ UNSAFE_RAW_SQL: nullCheck }}), 0)`;
      }

      if (fn === 'sum') {
        const weightedVal = {
          UNSAFE_RAW_SQL: `${unsafeExpr.UNSAFE_RAW_SQL} * ${sampleWeightExpr}`,
        };
        if (isWhereUsed) {
          return chSql`sumIf(${weightedVal}, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }})`;
        }
        return chSql`sum(${weightedVal})`;
      }

      if (level != null && fn.startsWith('quantile')) {
        const levelStr = Number.isFinite(level) ? `${level}` : '0';
        const weightArg = {
          UNSAFE_RAW_SQL: `toUInt32(${sampleWeightExpr})`,
        };
        if (isWhereUsed) {
          return chSql`quantileTDigestWeightedIf(${{ UNSAFE_RAW_SQL: levelStr }})(${unsafeExpr}, ${weightArg}, ${{ UNSAFE_RAW_SQL: whereWithExtraNullCheck }})`;
        }
        return chSql`quantileTDigestWeighted(${{ UNSAFE_RAW_SQL: levelStr }})(${unsafeExpr}, ${weightArg})`;
      }

      // For any other fn (last_value, any, etc.), fall through to default
    }
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
) {
  if (typeof selectList === 'string') {
    return chSql`${{ UNSAFE_RAW_SQL: selectList }}`;
  }

  // This metadata query is executed in an attempt tp optimize the selects by favoring materialized fields
  // on a view/table that already perform the computation in select. This optimization is not currently
  // supported for queries using subquery CTEs so skip the metadata fetch if there are subquery CTE
  // objects in the config. Expression aliases (isSubquery: false) do not affect the base table.
  let materializedFields: Map<string, string> | undefined;
  try {
    // This will likely error when referencing a CTE, which is assumed
    // to be the case when chartConfig.from.databaseName is not set.
    materializedFields =
      hasSubqueryCte(chartConfig.with) || !chartConfig.from.databaseName
        ? undefined
        : await metadata.getMaterializedColumnsLookupTable({
            connectionId: chartConfig.connection,
            databaseName: chartConfig.from.databaseName,
            tableName: chartConfig.from.tableName,
          });
  } catch {
    // ignore
  }

  const isRatio = isRatioChartConfig(selectList, chartConfig);

  const selectsSQL = await Promise.all(
    selectList.map(async select => {
      const whereClause = isNonEmptyWhereExpr(select.aggCondition)
        ? await renderWhereExpression({
            condition: select.aggCondition ?? '',
            from: chartConfig.from,
            language: select.aggConditionLanguage ?? 'lucene',
            implicitColumnExpression: chartConfig.implicitColumnExpression,
            bodyExpression: chartConfig.bodyExpression,
            useTextIndexForImplicitColumn:
              chartConfig.useTextIndexForImplicitColumn,
            metadata,
            connectionId: chartConfig.connection,
            with: chartConfig.with,
          })
        : chSql``;

      let expr: ChSql;
      if (select.aggFn == null) {
        expr =
          select.valueExpressionLanguage === 'lucene'
            ? await renderWhereExpression({
                condition: select.valueExpression,
                from: chartConfig.from,
                language: 'lucene',
                implicitColumnExpression: chartConfig.implicitColumnExpression,
                bodyExpression: chartConfig.bodyExpression,
                useTextIndexForImplicitColumn:
                  chartConfig.useTextIndexForImplicitColumn,
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
          sampleWeightExpression: chartConfig.sampleWeightExpression,
        });
      } else {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          where: whereClause.sql,
          sampleWeightExpression: chartConfig.sampleWeightExpression,
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
  bucketTimestampValueExpression,
  dateRange,
  alias = FIXED_TIME_BUCKET_EXPR_ALIAS,
  isRenderingRawSqlTemplate,
}: {
  interval: SQLInterval | 'auto';
  timestampValueExpression: string;
  /**
   * Pre-resolved single column for the bucket. Threaded down from
   * `renderChartConfig` via `pickBucketTimestampColumn`. When absent we
   * fall back to the first token of `timestampValueExpression` so existing
   * single-column sources keep working.
   */
  bucketTimestampValueExpression?: string;
  dateRange?: [Date, Date];
  alias?: string;
  isRenderingRawSqlTemplate?: boolean;
}) {
  const unsafeTimestampValueExpression = {
    UNSAFE_RAW_SQL:
      bucketTimestampValueExpression ??
      getFirstTimestampValueExpression(timestampValueExpression),
  };

  if (isRenderingRawSqlTemplate) {
    return chSql`$__timeInterval(${unsafeTimestampValueExpression}) AS \`${{
      UNSAFE_RAW_SQL: alias,
    }}\``;
  }

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
  isRenderingRawSqlTemplate,
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
  isRenderingRawSqlTemplate?: boolean;
  includedDataInterval?: string;
  metadata: Metadata;
  tableName: string;
  timestampValueExpression: string;
  with?: BuilderChartConfigWithDateRange['with'];
}) {
  const startTime = dateRange[0].getTime();
  const endTime = dateRange[1].getTime();

  let optimizedTimestampValueExpression = timestampValueExpression;
  try {
    // Not all of these will be available when selecting from a CTE
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

  const whereExprs = await Promise.all(
    valueExpressions.map(async expr => {
      const col = expr.trim();

      // If the expression includes a toStartOf...(...) function, the RHS of the
      // timestamp comparison must also have the same function
      const toStartOf = parseToStartOfFunction(col);

      // Detect toDate(...) wrapper expressions
      const isToDateExpr = /^toDate\s*\(/.test(col);

      // Skip the column-metadata lookup when:
      //   - the FROM references a CTE alias (no real base table to DESCRIBE), or
      //   - the expression isn't a bare column name (wrapped in toStartOf/toDate).
      // A subquery CTE alone is not enough — when `databaseName` is set, `col` still
      // references a real base-table column whose type (e.g. Date) we need to know
      // to generate a correct time filter.
      const skipColumnLookup =
        (hasSubqueryCte(withClauses) && !databaseName) ||
        !!toStartOf ||
        isToDateExpr;

      const columnMeta = skipColumnLookup
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

      if (columnMeta == null && !skipColumnLookup) {
        console.warn(
          `Column ${col} not found in ${databaseName}.${tableName} while inferring type for time filter`,
        );
      }

      const rawStartBound = isRenderingRawSqlTemplate
        ? includedDataInterval
          ? chSql`toStartOfInterval($__fromTime_ms, INTERVAL $__interval_s second) - INTERVAL $__interval_s second`
          : chSql`$__fromTime_ms`
        : includedDataInterval
          ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: startTime }}), INTERVAL ${includedDataInterval}) - INTERVAL ${includedDataInterval}`
          : chSql`fromUnixTimestamp64Milli(${{ Int64: startTime }})`;

      const rawEndBound = isRenderingRawSqlTemplate
        ? includedDataInterval
          ? chSql`toStartOfInterval($__toTime_ms, INTERVAL $__interval_s second) + INTERVAL $__interval_s second`
          : chSql`$__toTime_ms`
        : includedDataInterval
          ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: endTime }}), INTERVAL ${includedDataInterval}) + INTERVAL ${includedDataInterval}`
          : chSql`fromUnixTimestamp64Milli(${{ Int64: endTime }})`;

      const startTimeCond = toStartOf
        ? chSql`${toStartOf.function}(${rawStartBound}${toStartOf.formattedRemainingArgs})`
        : rawStartBound;

      const endTimeCond = toStartOf
        ? chSql`${toStartOf.function}(${rawEndBound}${toStartOf.formattedRemainingArgs})`
        : rawEndBound;

      const isDateType = columnMeta?.type === 'Date' || isToDateExpr;

      // toStartOf* and Date filters must stay inclusive — strict < on a rounded value drops a whole interval
      const startOp =
        dateRangeStartInclusive || toStartOf || isDateType ? '>=' : '>';
      const endOp =
        dateRangeEndInclusive || toStartOf || isDateType ? '<=' : '<';

      if (isDateType) {
        return chSql`(${unsafeTimestampValueExpression} ${startOp} toDate(${startTimeCond}) AND ${unsafeTimestampValueExpression} ${endOp} toDate(${endTimeCond}))`;
      } else {
        return chSql`(${unsafeTimestampValueExpression} ${startOp} ${startTimeCond} AND ${unsafeTimestampValueExpression} ${endOp} ${endTimeCond})`;
      }
    }),
  );

  return concatChSql('AND', ...whereExprs);
}

async function renderSelect(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
          bucketTimestampValueExpression:
            chartConfig.bucketTimestampValueExpression,
          dateRange: chartConfig.dateRange,
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        })
      : [],
  );
}

function renderFrom({
  from,
  isRenderingRawSqlTemplate,
  metricType,
}: {
  from: BuilderChartConfigWithDateRange['from'];
  isRenderingRawSqlTemplate?: boolean;
  /** Value passed to $__sourceTable(MetricType) when rendering a metric query as a SQL template */
  metricType?: MetricsDataType;
}): ChSql {
  if (isRenderingRawSqlTemplate) {
    if (metricType != null) {
      return chSql`$__sourceTable(${{ UNSAFE_RAW_SQL: metricType }})`;
    }
    // The $__sourceTable macro only stands in for the real source table. A
    // FROM with no database is a CTE reference, so render it literally.
    if (from.databaseName !== '') {
      return chSql`$__sourceTable`;
    }
  }
  return concatChSql(
    '.',
    chSql`${from.databaseName === '' ? '' : { Identifier: from.databaseName }}`,
    chSql`${{
      Identifier: from.tableName,
    }}`,
  );
}

async function renderWhereExpressionStr({
  condition,
  language,
  metadata,
  from,
  implicitColumnExpression,
  bodyExpression,
  useTextIndexForImplicitColumn,
  connectionId,
  with: withClauses,
}: {
  condition: SearchCondition;
  language: SearchConditionLanguage;
  metadata: Metadata;
  from: BuilderChartConfigWithDateRange['from'];
  implicitColumnExpression?: string;
  bodyExpression?: string;
  useTextIndexForImplicitColumn?: BuilderChartConfigWithDateRange['useTextIndexForImplicitColumn'];
  connectionId: string;
  with?: BuilderChartConfigWithDateRange['with'];
}): Promise<string> {
  let _condition = condition;
  if (language === 'lucene') {
    const serializer = new CustomSchemaSQLSerializerV2({
      metadata,
      databaseName: from.databaseName,
      tableName: from.tableName,
      implicitColumnExpression,
      bodyExpression,
      useTextIndexForImplicitColumn,
      connectionId: connectionId,
    });
    const builder = new SearchQueryBuilder(condition, serializer);
    _condition = await builder.build();
  }

  // This metadata query is executed in an attempt tp optimize the selects by favoring materialized fields
  // on a view/table that already perform the computation in select. This optimization is not currently
  // supported for queries using subquery CTEs so skip the metadata fetch if there are subquery CTE
  // objects in the config. Expression aliases (isSubquery: false) do not affect the base table.
  let materializedFields: Map<string, string> | undefined;
  try {
    // This will likely error when referencing a CTE, which is assumed
    // to be the case when from.databaseName is not set.
    materializedFields =
      hasSubqueryCte(withClauses) || !from.databaseName
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

  return _condition;
}

async function renderWhereExpression(
  args: Parameters<typeof renderWhereExpressionStr>[0],
): Promise<ChSql> {
  const _condition = await renderWhereExpressionStr(args);
  return chSql`${{ UNSAFE_RAW_SQL: _condition }}`;
}

async function renderWhere(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
        bodyExpression: chartConfig.bodyExpression,
        useTextIndexForImplicitColumn:
          chartConfig.useTextIndexForImplicitColumn,
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
              bodyExpression: chartConfig.bodyExpression,
              useTextIndexForImplicitColumn:
                chartConfig.useTextIndexForImplicitColumn,
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

  const hasSqlFilter =
    chartConfig.filters?.some(f => f.type === 'sql') ?? false;
  const textIndexInfoLookup: TextIndexInfoLookup =
    hasSqlFilter &&
    chartConfig.from.databaseName &&
    chartConfig.from.tableName &&
    !hasSubqueryCte(chartConfig.with)
      ? await buildTextIndexInfoLookup({
          metadata,
          databaseName: chartConfig.from.databaseName,
          tableName: chartConfig.from.tableName,
          connectionId: chartConfig.connection,
        })
      : new Map();

  const filterConditions = await Promise.all(
    (chartConfig.filters ?? []).map(async filter => {
      if (filter.type === 'sql_ast') {
        return wrapChSqlIfNotEmpty(
          chSql`${{ UNSAFE_RAW_SQL: filter.left }} ${filter.operator} ${{ UNSAFE_RAW_SQL: filter.right }}`,
          '(',
          ')',
        );
      } else if (filter.type === 'lucene' || filter.type === 'sql') {
        const condition =
          filter.type === 'sql'
            ? rewriteSqlFilterWithKvItems(filter.condition, textIndexInfoLookup)
            : filter.condition;
        return wrapChSqlIfNotEmpty(
          await renderWhereExpression({
            condition,
            from: chartConfig.from,
            language: filter.type,
            implicitColumnExpression: chartConfig.implicitColumnExpression,
            bodyExpression: chartConfig.bodyExpression,
            useTextIndexForImplicitColumn:
              chartConfig.useTextIndexForImplicitColumn,
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
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
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
    // $__filters expands (at query time) to the dashboard filters, which
    // reference columns of the real source table. Only emit it when this WHERE
    // targets that source table (indicated by a non-empty databaseName).
    chartConfig.isRenderingRawSqlTemplate &&
      chartConfig.from.databaseName !== ''
      ? chSql`$__filters`
      : [],
  );
}

async function renderGroupBy(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
          bucketTimestampValueExpression:
            chartConfig.bucketTimestampValueExpression,
          dateRange: chartConfig.dateRange,
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        })
      : [],
  );
}

async function renderSeriesLimitCte(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
  {
    from,
    where,
    groupBy,
  }: { from: ChSql; where: ChSql; groupBy: ChSql | undefined },
): Promise<{ cte: ChSql; predicate: ChSql } | undefined> {
  const { seriesLimit } = chartConfig;
  if (
    seriesLimit == null ||
    !isUsingGroupBy(chartConfig) ||
    !isUsingGranularity(chartConfig) ||
    chartConfig.selectGroupBy === false ||
    // Skip CTE/metric sources (no real table to re-scan) and string selects.
    !chartConfig.from?.databaseName ||
    !chartConfig.from?.tableName ||
    !Array.isArray(chartConfig.select) ||
    chartConfig.select.length === 0 ||
    groupBy == null
  ) {
    return undefined;
  }

  // When the query was chunked into time windows, rank over the shared
  // range the caller pinned (the newest window) instead of each chunk's own
  // window — otherwise each chunk keeps its own top-N and the union across
  // chunks exceeds N. Inclusivity is normalized so all chunks emit an
  // identical CTE (non-first windows set dateRangeEndInclusive=false).
  const cteConfig = chartConfig.seriesLimitDateRange
    ? {
        ...chartConfig,
        dateRange: chartConfig.seriesLimitDateRange,
        dateRangeStartInclusive: true,
        dateRangeEndInclusive: true,
      }
    : undefined;
  // groupBy is re-rendered (not reused) because timeBucketExpr derives the
  // bucket size from dateRange when granularity is 'auto'.
  const [cteWhere = where, cteGroupBy = groupBy] = cteConfig
    ? await Promise.all([
        renderWhere(cteConfig, metadata),
        renderGroupBy(cteConfig, metadata),
      ])
    : [];

  // One ChSql per group-by column (groupBy may be an array or a comma-separated
  // string). splitAndTrimWithBracket respects []/()/quotes so it won't split
  // inside Map['a,b']; the per-column null filter below needs them separated.
  let groupByCols: ChSql[];
  if (typeof chartConfig.groupBy === 'string') {
    groupByCols = splitAndTrimWithBracket(chartConfig.groupBy).map(
      col => chSql`${{ UNSAFE_RAW_SQL: col }}`,
    );
  } else {
    // Strip aliases: these go inside tuple(...)/`IS NOT NULL`, where an
    // `AS "alias"` suffix is a syntax error (unlike the outer GROUP BY).
    const rendered = await renderSelectList(
      chartConfig.groupBy.map(col => ({ ...col, alias: undefined })),
      chartConfig,
      metadata,
    );
    groupByCols = Array.isArray(rendered) ? rendered : [rendered];
  }
  const groupByTuple = concatChSql(',', groupByCols);

  // Rank by the chart's first aggregate (alias stripped — we add our own).
  const firstSelect = chartConfig.select[0];
  const rankSelectList =
    typeof firstSelect === 'string'
      ? firstSelect
      : [{ ...firstSelect, alias: undefined }];
  const rankRendered = await renderSelectList(
    rankSelectList,
    chartConfig,
    metadata,
  );
  const rankValue = Array.isArray(rankRendered)
    ? rankRendered[0]
    : rankRendered;

  // Drop NULL components only (no-op on non-nullable columns).
  const groupByNotNullFilter = concatChSql(
    ' AND ',
    groupByCols.map(g => chSql`${g} IS NOT NULL`),
  );
  const innerWhere = cteWhere.sql
    ? concatChSql(' AND ', cteWhere, groupByNotNullFilter)
    : groupByNotNullFilter;

  // Per-(group, bucket) aggregate, then max per group, keeping the top N.
  const cte = chSql`\`__hdx_series_limit\` AS (
    SELECT \`group\`
    FROM (
      SELECT tuple(${groupByTuple}) AS \`group\`, ${rankValue} AS \`__hdx_series_rank\`
      FROM ${from}
      WHERE ${innerWhere}
      GROUP BY ${cteGroupBy}
    )
    GROUP BY \`group\`
    ORDER BY max(\`__hdx_series_rank\`) DESC, \`group\`
    LIMIT ${{ Int32: seriesLimit }}
  )`;

  const predicate = chSql`tuple(${groupByTuple}) IN (SELECT \`group\` FROM \`__hdx_series_limit\`)`;

  return { cte, predicate };
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
    bodyExpression: chartConfig.bodyExpression,
    useTextIndexForImplicitColumn: chartConfig.useTextIndexForImplicitColumn,
    metadata,
    connectionId: chartConfig.connection,
    with: chartConfig.with,
  });
}

function renderOrderBy(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
          bucketTimestampValueExpression:
            chartConfig.bucketTimestampValueExpression,
          dateRange: chartConfig.dateRange,
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        })
      : [],
    chartConfig.orderBy != null
      ? renderSortSpecificationList(chartConfig.orderBy)
      : [],
  );
}

function renderLimit(
  chartConfig: BuilderChartConfigWithOptDateRange,
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
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
type InternalChartFields = {
  includedDataInterval?: string;
  settings?: ChSql;
  /**
   * Pre-resolved single column from the (possibly multi-column)
   * `timestampValueExpression`, used for the time-bucket and time-math
   * expressions only. Resolved once at the top of `renderChartConfig` via
   * `pickBucketTimestampColumn` so the bucket isn't pinned to a Date-typed
   * partition column when a higher-precision DateTime column is also listed.
   *
   * Closes HDX-4371. The WHERE clause keeps using the multi-column form so
   * partition pruning via the Date column continues to work.
   */
  bucketTimestampValueExpression?: string;
  /**
   * Emit raw-SQL-template macros ($__fromTime_ms, $__toTime_ms,
   * $__timeInterval, $__sourceTable, $__filters) instead of bound
   * date/interval/table values, so the result can be used as an editable
   * `sqlTemplate`.
   */
  isRenderingRawSqlTemplate?: boolean;
};

type BuilderChartConfigWithOptDateRangeEx = BuilderChartConfigWithOptDateRange &
  InternalChartFields;

type RawSqlChartConfigEx = RawSqlChartConfig &
  Partial<DateRange> &
  InternalChartFields;

type PromqlChartConfigEx = PromqlChartConfig &
  Partial<DateRange> &
  InternalChartFields;

export type ChartConfigWithOptDateRangeEx =
  | BuilderChartConfigWithOptDateRangeEx
  | RawSqlChartConfigEx
  | PromqlChartConfigEx;

async function renderWith(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
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
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  valueExpression: string,
) {
  const interval =
    chartConfig.granularity === 'auto' && Array.isArray(chartConfig.dateRange)
      ? convertDateRangeToGranularityString(chartConfig.dateRange)
      : chartConfig.granularity;
  const intervalInSeconds = convertGranularityToSeconds(interval ?? '');

  // Use the pre-resolved bucket column for time math too. If
  // `chartConfig.timestampValueExpression` lists multiple columns (the
  // LogHouse `"EventDate, EventTime"` pattern), feeding it directly to
  // `argMin`/`argMax`/`min`/`max` would emit invalid SQL like
  // `argMax(value, EventDate, EventTime)`. Picking the highest-precision
  // DateTime token via `bucketTimestampValueExpression` keeps the SQL
  // valid and the math correct.
  const timeExpr =
    chartConfig.bucketTimestampValueExpression ??
    getFirstTimestampValueExpression(
      chartConfig.timestampValueExpression ?? '',
    );

  const valueDiff = `(argMax(${valueExpression}, ${timeExpr}) - argMin(${valueExpression}, ${timeExpr}))`;
  const timeDiffInSeconds = `date_diff('second', min(toDateTime(${timeExpr})), max(toDateTime(${timeExpr})))`;

  // Prevent division by zero, if timeDiffInSeconds is 0, return 0
  // The delta is extrapolated to the bucket interval, to match prometheus delta() behavior
  return `IF(${timeDiffInSeconds} > 0, ${valueDiff} * ${intervalInSeconds} / ${timeDiffInSeconds}, 0)`;
}

async function translateMetricChartConfig(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<BuilderChartConfigWithOptDateRangeEx> {
  const metricTables = chartConfig.metricTables;
  if (!metricTables) {
    return chartConfig;
  }

  // assumes all the selects are from a single metric type, for now
  const { select, from, filters, ...restChartConfig } = chartConfig;
  if (!select || !Array.isArray(select)) {
    throw new Error('multi select or string select on metrics not supported');
  }

  const { metricType, metricName, metricNameSql, ..._select } = select[0]; // Initial impl only supports one metric select per chart config

  // 'increase' is only valid for Sum metrics.
  if (_select.aggFn === 'increase' && metricType !== MetricsDataType.Sum) {
    throw new Error(
      `aggFn 'increase' is only supported for Sum (counter) metrics (got metricType=${metricType})`,
    );
  }

  const isExponentialHistogram =
    metricType === MetricsDataType.ExponentialHistogram &&
    metricName &&
    MetricsDataType.ExponentialHistogram in metricTables &&
    metricTables[MetricsDataType.ExponentialHistogram];
  const isHistogram =
    metricType === MetricsDataType.Histogram &&
    metricName &&
    MetricsDataType.Histogram in metricTables &&
    metricTables[MetricsDataType.Histogram];

  // AttributesHash is computed inline with a variadic cityHash64 call
  // (HDX-4466). This works for both Map(LowCardinality(String), String) and
  // JSON attribute columns, so no schema detection round-trip is needed.

  if (
    metricType === MetricsDataType.Gauge &&
    metricName &&
    MetricsDataType.Gauge in metricTables &&
    metricTables[MetricsDataType.Gauge]
  ) {
    const timeBucketCol = '__hdx_time_bucket2';
    const timeExpr = timeBucketExpr({
      interval: chartConfig.granularity || 'auto',
      timestampValueExpression:
        chartConfig.timestampValueExpression ||
        DEFAULT_METRIC_TABLE_TIME_COLUMN,
      bucketTimestampValueExpression:
        chartConfig.bucketTimestampValueExpression,
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
      isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
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
              cityHash64(ScopeAttributes, ResourceAttributes, Attributes) AS AttributesHash
            FROM ${renderFrom({ from: { ...from, tableName: metricTables[MetricsDataType.Gauge] }, isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate, metricType: MetricsDataType.Gauge })}
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
  } else if (
    metricType === MetricsDataType.Sum &&
    metricName &&
    MetricsDataType.Sum in metricTables &&
    metricTables[MetricsDataType.Sum]
  ) {
    const timeBucketCol = '__hdx_time_bucket2';
    const timeExpr = timeBucketExpr({
      interval: chartConfig.granularity || 'auto',
      timestampValueExpression:
        chartConfig.timestampValueExpression || 'TimeUnix',
      bucketTimestampValueExpression:
        chartConfig.bucketTimestampValueExpression,
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
      isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
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
    const sumWith: NonNullable<BuilderChartConfigWithOptDateRangeEx['with']> = [
      {
        // Source: per-raw-row counter delta (Rate) and cumulative value (Sum)
        // for each (AttributesHash, TimeUnix) point. On the first row of each
        // series partition, lagInFrame returns NULL; `Value - NULL` is NULL,
        // and `greatest(NULL, 0)` resolves to 0 — so Rate is 0 (contributing
        // nothing to the bucket sum) rather than leaking the cumulative value.
        //
        // Counter-reset handling: `greatest(..., 0)` clamps negative deltas
        // (counter resets/decreases) to 0. This differs from the Prometheus
        // convention where a reset is treated as `current_value` (assuming
        // the counter restarted from 0). The clamping approach under-reports
        // the increase in the bucket immediately after a reset, but avoids
        // injecting the full post-reset value as a spike.
        name: 'Source',
        sql: chSql`
                SELECT
                  *,
                  cityHash64(ScopeAttributes, ResourceAttributes, Attributes) AS AttributesHash,
                  IF(
                    AggregationTemporality = 1,
                    Value, -- DELTA: Value is already the per-interval increase
                    greatest(Value - lagInFrame(toNullable(Value), 1, NULL) OVER (PARTITION BY AttributesHash ORDER BY TimeUnix), 0)
                  ) AS Rate,
                  IF(
                    AggregationTemporality = 1,
                    SUM(Value) OVER (PARTITION BY AttributesHash ORDER BY TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
                    Value
                  ) AS Sum
                FROM ${renderFrom({ from: { ...from, tableName: metricTables[MetricsDataType.Sum] }, isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate, metricType: MetricsDataType.Sum })}
                WHERE ${where}`,
      },
      {
        // Bucketed: one row per (AttributesHash, bucket). The aggregation is
        // wrapped in an inner subquery so ClickHouse exposes Rate/Sum as plain
        // columns; without the wrapper, outer `sum(Rate)` would lexically
        // expand to the rejected `sum(sum(Source.Rate))`.
        name: 'Bucketed',
        sql: chSql`
            SELECT
              \`${timeBucketCol}\`,
              AttributesHash,
              Rate,
              Sum,
              ResourceAttributes,
              ResourceSchemaUrl,
              ScopeName,
              ScopeVersion,
              ScopeAttributes,
              ScopeDroppedAttrCount,
              ScopeSchemaUrl,
              ServiceName,
              MetricName,
              MetricDescription,
              MetricUnit,
              Attributes,
              StartTimeUnix,
              Flags,
              AggregationTemporality,
              IsMonotonic
            FROM (
              SELECT
                ${timeExpr},
                AttributesHash,
                -- Per-bucket increase: sum of raw per-row deltas. NULL
                -- Source.Rate (first row of each partition) is ignored by sum().
                sum(Source.Rate) AS Rate,
                -- Last cumulative reading in the bucket (by time), used by
                -- the no-aggFn last_value(Sum) outer projection. argMax is
                -- deterministic w.r.t. TimeUnix ordering unlike last_value
                -- which in a GROUP BY context is anyLast (order-dependent).
                argMax(Source.Sum, TimeUnix) AS Sum,
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
            )
          `,
      },
    ];

    // For aggFn='increase' + groupBy, restrict the outer query to the top N
    // groups (mirrors v1's MAX_NUM_GROUPS). Ranking is done in a separate
    // CTE rather than a window, since ClickHouse can't reference a
    // window-aggregate inside another window's ORDER BY.
    const shouldApplyIncreaseGroupLimit =
      _select.aggFn === 'increase' && isUsingGroupBy(chartConfig);

    let outerWhere: string = '';

    if (shouldApplyIncreaseGroupLimit) {
      // Render the user's groupBy against the Bucketed CTE so column
      // references resolve to the CTE's projection.
      const groupByForRank = await renderSelectList(
        chartConfig.groupBy!,
        {
          ...chartConfig,
          from: { databaseName: '', tableName: 'Bucketed' },
          with: sumWith,
        } as BuilderChartConfigWithOptDateRangeEx,
        metadata,
      );
      const groupBySql = concatChSql(',', groupByForRank);

      // Exclude rows where any groupBy column is NULL/empty so they don't
      // collapse into a single dominating '-' series.
      const groupByEmptyFilter = concatChSql(
        ' AND ',
        (Array.isArray(groupByForRank) ? groupByForRank : [groupByForRank]).map(
          g => chSql`(${g} IS NOT NULL AND toString(${g}) != '')`,
        ),
      );

      // Rank by max-per-bucket summed Rate so a group that spikes in one
      // bucket still makes the top N. tuple() wraps multi-column groupBys
      // into a single comparable column.
      sumWith.push({
        name: 'TopGroups',
        sql: chSql`
            SELECT \`group\`
            FROM (
              SELECT
                tuple(${groupBySql}) AS \`group\`,
                sum(Rate) AS \`bucket_value\`
              FROM Bucketed
              WHERE ${groupByEmptyFilter}
              GROUP BY \`group\`, \`${timeBucketCol}\`
            )
            GROUP BY \`group\`
            ORDER BY max(\`bucket_value\`) DESC, \`group\`
            LIMIT ${{ Int32: INCREASE_MAX_NUM_GROUPS }}
          `,
      });

      // Safety: groupBySql is built from metric groupBy expressions which are
      // always simple column references (UNSAFE_RAW_SQL). Verify no parameterized
      // values leaked through — if they did, .sql would contain param placeholders
      // but the string-based outer WHERE would lose the param bindings.
      if (Object.keys(groupBySql.params).length > 0) {
        throw new Error(
          'increase + groupBy: unexpected parameterized groupBy expressions',
        );
      }
      outerWhere = `tuple(${groupBySql.sql}) IN (SELECT \`group\` FROM TopGroups)`;
    }

    return {
      ...restChartConfig,
      with: sumWith,
      select: [
        // HDX-1543: aggFn => use computed rate; no aggFn => use raw cumulative.
        // For 'increase', sum Rate across sub-series that share the user's
        // groupBy (e.g. groupBy teamName while rows also vary by customerId).
        _select.aggFn === 'increase'
          ? {
              alias: 'Value',
              ..._select,
              aggFn: 'sum',
              valueExpression: 'Rate',
              aggCondition: '',
            }
          : _select.aggFn
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
      // outerWhere is only set when restricting to top-N groups; otherwise
      // cleared since the upstream CTE already applied the user's where.
      // Force SQL parsing because outerWhere is raw SQL referencing
      // TopGroups; the user's whereLanguage may be Lucene.
      where: outerWhere,
      whereLanguage: shouldApplyIncreaseGroupLimit
        ? 'sql'
        : restChartConfig.whereLanguage,
      timestampValueExpression: `\`${timeBucketCol}\``,
    };
  } else if (isHistogram || isExponentialHistogram) {
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
        // eslint-disable-next-line security/detect-object-injection
        tableName: metricTables[metricType],
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
    } satisfies BuilderChartConfigWithOptDateRangeEx;

    const hasGranularity = isUsingGranularity(cteChartConfig);
    const timeBucketSelect = hasGranularity
      ? timeBucketExpr({
          interval: cteChartConfig.granularity,
          timestampValueExpression: cteChartConfig.timestampValueExpression,
          dateRange: cteChartConfig.dateRange,
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        })
      : undefined;
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

    const translationInput = {
      select: _select,
      timeBucketSelect,
      groupBy,
      from: renderFrom({
        from: {
          ...from,
          // eslint-disable-next-line security/detect-object-injection
          tableName: metricTables[metricType],
        },
        isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        metricType,
      }),
      where,
      valueAlias,
    };

    return {
      ...restChartConfig,
      with: isExponentialHistogram
        ? translateExponentialHistogram(translationInput)
        : translateHistogram(translationInput),
      select: [
        ...(hasGranularity ? [`\`${FIXED_TIME_BUCKET_EXPR_ALIAS}\``] : []),
        ...(groupBy ? [GROUP_ALIAS] : []),
        `"${valueAlias}"`,
      ].join(', '),
      from: {
        databaseName: '',
        tableName: 'metrics',
      },
      where: '', // clear up the condition since the where clause is already applied at the upstream CTE
      // Timeseries queries discard padded buckets here. Non-timeseries queries
      // scan only the visible range and have no time dimension to filter.
      dateRange: hasGranularity ? restChartConfig.dateRange : undefined,
      groupBy: undefined,
      granularity: undefined, // time bucketing and granularity is applied at the source CTE
      timestampValueExpression: hasGranularity
        ? `\`${FIXED_TIME_BUCKET_EXPR_ALIAS}\``
        : restChartConfig.timestampValueExpression,
      settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
    };
  }

  throw new Error(`no query support for metric type=${metricType}`);
}

/** Renders the config's filters into a SQL condition string */
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
          chartConfig.from &&
          chartConfig.from.tableName && // tableName is falsy for metric sources
          chartConfig.source;

        if (filter.type === 'sql_ast') {
          return `(${filter.left} ${filter.operator} ${filter.right})`;
        } else if (filter.type === 'sql' && !hasSourceTable) {
          return filter.condition.trim()
            ? `(${filter.condition})` // Don't pass to renderWhereExpressionStr since it requires source table metadata
            : undefined;
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
            bodyExpression: chartConfig.bodyExpression,
            useTextIndexForImplicitColumn:
              chartConfig.useTextIndexForImplicitColumn,
            metadata,
            connectionId: chartConfig.connection,
          });
          return condition ? `(${condition})` : undefined;
        }
      }),
    )
  ).filter(condition => condition !== undefined);

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
  if (isPromqlChartConfig(rawChartConfig)) {
    // PromQL queries are executed server-side via the Prometheus API route,
    // not via SQL generation. Return empty SQL as a no-op.
    return { sql: '', params: {} };
  }
  if (isRawSqlChartConfig(rawChartConfig)) {
    return renderRawSqlChartConfig(rawChartConfig, metadata);
  }

  // metric types require more rewriting since we know more about the schema
  // but goes through the same generation process
  const translatedChartConfig = isMetricChartConfig(rawChartConfig)
    ? await translateMetricChartConfig(rawChartConfig, metadata)
    : rawChartConfig;

  // Resolve the bucket column once for the whole render. A source with
  // `timestampValueExpression = "EventDate, EventTime"` should bucket on
  // `EventTime` (highest-precision DateTime), not on `EventDate` (the first
  // token). Keep the multi-column form on `timestampValueExpression` so
  // `timeFilterExpr` can prune partitions via the Date column. HDX-4371.
  const chartConfig: BuilderChartConfigWithOptDateRangeEx = {
    ...translatedChartConfig,
    bucketTimestampValueExpression:
      translatedChartConfig.bucketTimestampValueExpression ??
      (translatedChartConfig.timestampValueExpression &&
      translatedChartConfig.from?.databaseName &&
      translatedChartConfig.from?.tableName
        ? await pickBucketTimestampColumn({
            timestampValueExpression:
              translatedChartConfig.timestampValueExpression,
            metadata,
            databaseName: translatedChartConfig.from.databaseName,
            tableName: translatedChartConfig.from.tableName,
            connectionId: translatedChartConfig.connection,
          })
        : undefined),
  };

  let withClauses = await renderWith(chartConfig, metadata, querySettings);
  const select = await renderSelect(chartConfig, metadata);
  const from = renderFrom({
    from: chartConfig.from,
    isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
  });
  let where = await renderWhere(chartConfig, metadata);
  const groupBy = await renderGroupBy(chartConfig, metadata);
  const having = await renderHaving(chartConfig, metadata);
  const orderBy = renderOrderBy(chartConfig);
  //const fill = renderFill(chartConfig); //TODO: Fill breaks heatmaps and some charts
  const limit = renderLimit(chartConfig);
  const settings = renderSettings(chartConfig, querySettings);

  const seriesCap = await renderSeriesLimitCte(chartConfig, metadata, {
    from,
    where,
    groupBy,
  });
  if (seriesCap) {
    withClauses = withClauses
      ? concatChSql(',', withClauses, seriesCap.cte)
      : seriesCap.cte;
    where = where.sql
      ? concatChSql(' AND ', where, seriesCap.predicate)
      : seriesCap.predicate;
  }

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

/** Overall cap on exemplar markers returned for a single chart, so a wide
 * time range can't flood the chart overlay with thousands of points. */
export const EXEMPLAR_QUERY_LIMIT = 200;

/**
 * Builds a ClickHouse query that surfaces native exemplars stored on an OTel
 * metric table (`Exemplars.TraceId/SpanId/Value/TimeUnix`). Returns null when
 * the config is not a single-metric chart we can resolve a table for.
 *
 * Reuses `renderWhere` so the exemplar scan honors the exact same time range,
 * metric-name, and user filters as the rendered series. Exemplars are kept as
 * their own raw points (the marker sits at the exemplar's own value/time), not
 * bucketed — so no `timeBucketExpr` here.
 */
export async function renderMetricExemplarsChartConfig(
  chartConfig: ChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<ChSql | null> {
  if (
    isRawSqlChartConfig(chartConfig) ||
    isPromqlChartConfig(chartConfig) ||
    !isMetricChartConfig(chartConfig) ||
    !Array.isArray(chartConfig.select) ||
    // Exemplars carry a single series' raw measurement (e.g. latency). They are
    // meaningless on a ratio axis and ambiguous across multiple series, so only
    // surface them for a single, non-ratio metric series.
    chartConfig.select.length !== 1 ||
    chartConfig.seriesReturnType === 'ratio'
  ) {
    return null;
  }
  const { metricTables, select } = chartConfig;
  const { metricType, metricName, metricNameSql } = select[0] ?? {};
  const table =
    metricType && metricTables ? metricTables[metricType] : undefined;
  if (!metricType || !metricName || !table) {
    return null;
  }
  // Keep exemplars to latency metrics for now: a histogram's exemplar value is a
  // request duration, which shares the chart's y-axis unit. Other metric types
  // (counts/gauges/rates) put exemplars on an incompatible scale.
  if (metricType !== MetricsDataType.Histogram) {
    return null;
  }

  // Build a config that points at the concrete metric-type table and carries
  // the metric-name predicate alongside the user filters, then let renderWhere
  // assemble the time filter + filters exactly as the main query does. The
  // guards above narrow chartConfig to the metric builder config, so no cast.
  const whereConfig: BuilderChartConfigWithOptDateRangeEx = {
    ...chartConfig,
    from: { ...chartConfig.from, tableName: table },
    timestampValueExpression:
      chartConfig.timestampValueExpression || DEFAULT_METRIC_TABLE_TIME_COLUMN,
    // Keep the original select so renderWhere applies the series' aggCondition —
    // otherwise the exemplar scan would surface traces from other series (e.g.
    // other services/routes/tenants) that share the same metric name.
  };

  const where = await renderWhere(whereConfig, metadata);
  const from = renderFrom({ from: whereConfig.from });

  // The metric-name predicate is REQUIRED and must always be ANDed. Appending it
  // to `chartConfig.filters` would subject it to the chart's
  // `filtersLogicalOperator`, so an 'OR' filter group would produce
  // `userFilterA OR userFilterB OR MetricName = ...` and let the exemplar scan
  // surface traces from other metrics. AND it separately from the user filters.
  const metricNameCondition = createMetricNameFilter(metricName, metricNameSql);

  return concatChSql(' ', [
    chSql`SELECT
      toUnixTimestamp64Milli(ex_TimeUnix) AS timestamp,
      ex_Value AS value,
      ex_TraceId AS traceId,
      ex_SpanId AS spanId`,
    chSql`FROM ${from}`,
    chSql`ARRAY JOIN
      \`Exemplars.TimeUnix\` AS ex_TimeUnix,
      \`Exemplars.Value\` AS ex_Value,
      \`Exemplars.TraceId\` AS ex_TraceId,
      \`Exemplars.SpanId\` AS ex_SpanId`,
    chSql`WHERE ${where.sql ? where : chSql`1 = 1`} AND (${metricNameCondition}) AND notEmpty(ex_TraceId)`,
    // Native exemplars carry no interestingness signal; keep the highest-value
    // ones as a stable cap. ponytail: value-desc cap, revisit if even sampling
    // across buckets is wanted.
    chSql`ORDER BY value DESC LIMIT ${{ Int32: EXEMPLAR_QUERY_LIMIT }}`,
  ]);
}

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
