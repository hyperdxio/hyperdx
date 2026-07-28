import isPlainObject from 'lodash/isPlainObject';
import * as SQLParser from 'node-sql-parser';
import SqlString from 'sqlstring';

import { ChSql, chSql, concatChSql, wrapChSqlIfNotEmpty } from '@/clickhouse';
import { translateHistogram } from '@/core/histogram';
import { Metadata } from '@/core/metadata';
import {
  gaugeCtesV2,
  gaugeRollupCtesV2,
  parseSeriesNeeds,
  seriesCteV2,
  sumCtesV2,
  sumRollupCtesV2,
  translateExpHistogramRollupV2,
  translateExpHistogramV2,
  translateHistogramRollupV2,
  translateHistogramV2,
  translateSummaryV2,
} from '@/core/metricsV2';
import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  extractSettingsClauseFromEnd,
  getFirstTimestampValueExpression,
  joinQuerySettings,
  optimizeTimestampValueExpression,
  parseToStartOfFunction,
  pickBucketTimestampColumn,
  SCRAPE_INTERVAL_GRANULARITY_SNAP_ENABLED,
  snapDisplayGranularity,
  splitAndTrimWithBracket,
} from '@/core/utils';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@/guards';
import { replaceMacros } from '@/macros';
import {
  buildKvItemsLookup,
  CustomSchemaSQLSerializerV2,
  KvItemsInfo,
  KvItemsLookup,
  SearchQueryBuilder,
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
  isMetricsV2Tables,
  METRICS_V2_METRIC_TYPE,
  MetricsDataType,
  PromqlChartConfig,
  QuerySettings,
  RawSqlChartConfig,
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
export function createMetricNameFilter(
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

// Maximum number of distinct groups shown in a time chart when using 'increase' with a groupBy.
const INCREASE_MAX_NUM_GROUPS = 20;

/**
 * Max raw-scan window for quantile queries on metric types with no usable
 * rollup tier (exponential histograms until their tier ships, summaries
 * always). Raw quantile shapes do per-point work; beyond a few hours they
 * cannot finish inside typical execution timeouts and each retry burns
 * hundreds of CPU-seconds. ~3h holds with the branched/tuple-state exp
 * shapes; count/avg (scalar) panels are not capped.
 */
const RAW_QUANTILE_MAX_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Whale-metric guard for raw fine-bucket scans: display buckets finer than
 * 5m force the raw tier (rollups cannot produce sub-5m buckets), and a
 * fine-bucket panel over a very-high-cardinality metric reads tens of
 * millions of raw rows regardless of how narrow series resolution is
 * (measured: ~19.6M rows on an 848k-series metric — points-scan-bound).
 * Beyond this window, sub-5m buckets require the matched-series estimate to
 * stay under the threshold (i.e. a label filter). `auto` granularity never
 * produces sub-5m buckets for windows over 1h, so this only fires on
 * user-forced fine granularities.
 */
const FINE_BUCKET_RAW_MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
const WHALE_SERIES_THRESHOLD = 100_000;

/**
 * Cost gate for summary quantile panels (summaries have no rollup tier, so
 * every window reads raw points). Raw-scan cost is
 * series × window ÷ scrape interval; a flat window cap wrongly blocks cheap
 * queries (a 10k-series summary at 6h is ~3.6M rows). Windows within
 * RAW_QUANTILE_MAX_WINDOW_MS skip the estimate entirely (always allowed —
 * preserves the previous behavior with zero extra metadata queries).
 */
const SUMMARY_RAW_SCAN_MAX_ROWS = 300_000_000;

/**
 * enable_parallel_replicas helps scan/aggregate-heavy panels and HURTS
 * small ones (coordination overhead; window stages don't distribute well) —
 * measured: global-on regressed small panels. Enabled per query when the
 * estimated scan (matched series × rows per series over the window)
 * crosses this many rows.
 *
 * DISABLED for now: treated as a server-level setting. Measured upside was
 * marginal anyway on the whale shapes (a 13.5M-series 24h tier panel
 * engaged 3 replicas for ~2% — the shapes are per-series-GROUP-BY-bound,
 * not scan-bound). Flip the flag to restore per-query gating; while off, no
 * cost-estimate query is issued for the gate and no SETTINGS override is
 * emitted.
 */
const PARALLEL_REPLICAS_GATE_ENABLED = false;
const PARALLEL_REPLICAS_MIN_SCAN_ROWS = 50_000_000;

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
  } catch (e) {
    return rawSQL;
  }
};

/**
 * The `*AttributeItems` columns index the whole `k=v` pair as ONE token
 * (text index, tokenizer = 'array'), so predicates use the token-matching
 * functions with exact-token ARRAY needles — `hasAllTokens(col,
 * array('k=v'))` — which is the shape the text index evaluates directly.
 * (String needles get re-tokenized by the default tokenizer and split on
 * '='; never emit those.)
 */
/** One collapsed all-pairs predicate: AND-connected equality matchers on
 * the same map fold into a single index lookup. */
function generateHasAllSqlForKvItemsColumn(
  column: string,
  tokens: string[],
): string {
  return `hasAllTokens(${SqlString.format('??', [column])}, array(${tokens
    .map(t => SqlString.format('?', [t]))
    .join(', ')}))`;
}

/** The index's disjunction primitive: any-of over pair tokens. */
function generateHasAnySqlForKvItemsColumn(
  column: string,
  tokens: string[],
): string {
  return `hasAnyTokens(${SqlString.format('??', [column])}, array(${tokens
    .map(t => SqlString.format('?', [t]))
    .join(', ')}))`;
}

/**
 * A fully-anchored alternation of literals — `^(a|b|c)$`, `^(?:a|b|c)$`, or
 * `^a$|^b$|^c$` — is exactly `IN ('a','b','c')`. Anything less anchored is
 * NOT: ClickHouse `match()` is an unanchored substring search, so a bare
 * `a|b|c` also matches 'ab-suffix', and `^a|b$` parses as `(^a)|(b$)`.
 * Returns the literal alternatives, or null when the pattern is a true regex.
 */
const parseAnchoredAlternation = (pattern: string): string[] | null => {
  const isLiteral = (s: string) => s !== '' && !/[\\^$.|?*+()[\]{}]/.test(s);
  const grouped = /^\^\((?:\?:)?([^()]*)\)\$$/.exec(pattern);
  if (grouped) {
    const alts = grouped[1].split('|');
    return alts.every(isLiteral) ? alts : null;
  }
  const alts: string[] = [];
  for (const piece of pattern.split('|')) {
    const anchored = /^\^(.*)\$$/.exec(piece);
    if (!anchored || !isLiteral(anchored[1])) return null;
    alts.push(anchored[1]);
  }
  return alts.length > 0 ? alts : null;
};

export const rewriteSqlFilterWithKvItems = (
  condition: string,
  kvItemsLookup: KvItemsLookup,
): string => {
  if (kvItemsLookup.size === 0) return condition;
  try {
    const parser = new SQLParser.Parser();
    const prefix = 'SELECT 1 FROM `t` WHERE ';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const ast = parser.astify(`${prefix}${condition}`, {
      database: 'Postgresql',
    }) as SQLParser.Select;

    // `Map['key']` against a map that has a kv-items column → the items
    // info + the subscripted key. Shared by the equality/IN matcher and the
    // match()-alternation matcher below.
    const extractItemsMapSubscript = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList | null | undefined,
    ): { info: KvItemsInfo; mapKey: string } | null => {
      if (
        node?.type !== 'column_ref' ||
        ('column' in node && typeof node.column === 'string')
      ) {
        return null;
      }
      const mapColumn = node['column']?.expr?.value;
      const arrIdx = node['array_index'];
      if (
        typeof mapColumn !== 'string' ||
        !Array.isArray(arrIdx) ||
        arrIdx.length !== 1
      ) {
        return null;
      }
      const idxNode = arrIdx[0]?.index;
      if (
        idxNode?.type !== 'single_quote_string' ||
        typeof idxNode.value !== 'string'
      ) {
        return null;
      }
      const info = kvItemsLookup.get(mapColumn);
      if (!info) return null;
      return { info, mapKey: idxNode.value };
    };

    // Recognizes `Map['key'] = 'v'` / `Map['key'] IN ('v1', ...)` — and
    // `match(Map['key'], '^(v1|v2)$')`, whose fully-anchored alternation is
    // exactly the same IN — against a map that has a kv-items column. Bails
    // on empty values: `Map['k'] = ''` also matches absent keys because
    // Map(String, String)'s subscript default is '', which the pair-token
    // predicate alone does not preserve.
    const matchKvEquality = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList,
    ): { info: KvItemsInfo; op: '=' | 'IN'; tokens: string[] } | null => {
      if (node.type === 'function') {
        // node-sql-parser's Function typing: name is a { name: [{ value }] }
        // wrapper, args an ExprList. The parser output for function nodes is
        // not fully typed, so read defensively through Records with runtime
        // checks on every step.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parser output, runtime-checked below
        const fn = node as unknown as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parser output, runtime-checked below
        const fnNameWrapper = fn.name as
          | { name?: Array<{ value?: unknown }> }
          | undefined;
        const fnName = fnNameWrapper?.name?.[0]?.value;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parser output, runtime-checked below
        const args = fn.args as
          | { type?: unknown; value?: unknown[] }
          | undefined;
        if (
          typeof fnName !== 'string' ||
          fnName.toLowerCase() !== 'match' ||
          args?.type !== 'expr_list' ||
          !Array.isArray(args.value) ||
          args.value.length !== 2
        ) {
          return null;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- expr_list members; both consumers re-check .type at runtime
        const [colArg, patArg] = args.value as Array<
          SQLParser.ExpressionValue | SQLParser.ExprList | null | undefined
        >;
        const sub = extractItemsMapSubscript(colArg);
        if (
          !sub ||
          patArg?.type !== 'single_quote_string' ||
          typeof patArg.value !== 'string'
        ) {
          return null;
        }
        const alts = parseAnchoredAlternation(patArg.value);
        if (!alts) return null;
        return {
          info: sub.info,
          op: alts.length === 1 ? '=' : 'IN',
          tokens: alts.map(v => `${sub.mapKey}${sub.info.separator}${v}`),
        };
      }
      if (!('operator' in node)) return null;
      const op = String(node.operator ?? '').toUpperCase();
      if (op !== '=' && op !== 'IN') return null;
      const sub = extractItemsMapSubscript(node.left);
      if (!sub) return null;
      const { info, mapKey } = sub;

      let values: string[];
      if (op === '=') {
        const right = node.right;
        if (
          right?.type !== 'single_quote_string' ||
          typeof right.value !== 'string'
        ) {
          return null;
        }
        values = [right.value];
      } else {
        const right = node.right;
        if (right?.type !== 'expr_list' || !Array.isArray(right.value))
          return null;
        const collected: string[] = [];
        for (const item of right.value) {
          if (
            item?.type !== 'single_quote_string' ||
            typeof item.value !== 'string'
          ) {
            return null;
          }
          collected.push(item.value);
        }
        values = collected;
      }
      if (values.length === 0 || values.some(v => v === '')) return null;
      return {
        info,
        op: op as '=' | 'IN',
        tokens: values.map(v => `${mapKey}${info.separator}${v}`),
      };
    };

    const replaceNode = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList,
      replacement: string,
    ): void => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- astify returns union type, we expect Select
      const replAst = parser.astify(`${prefix}${replacement}`, {
        database: 'Postgresql',
      }) as SQLParser.Select;
      const newWhere = replAst.where;
      if (newWhere == null) return;
      for (const k of Object.keys(node)) delete node[k];
      Object.assign(node, newWhere);
    };

    const rewriteSingle = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList,
    ): void => {
      const match = matchKvEquality(node);
      if (!match) return;
      const { info, tokens } = match;
      let replacement: string;
      if (tokens.length === 1) {
        // AND semantics — the default — collapse to hasAllTokens.
        replacement = generateHasAllSqlForKvItemsColumn(
          info.kvItemsColumn,
          tokens,
        );
      } else if (info.useHasAny) {
        // IN = disjunction of pair tokens.
        replacement = generateHasAnySqlForKvItemsColumn(
          info.kvItemsColumn,
          tokens,
        );
      } else {
        // Conservative fallback for branches without hasAnyTokens-over-items
        // support: a chain of single-token lookups.
        replacement = `(${tokens
          .map(t => generateHasAllSqlForKvItemsColumn(info.kvItemsColumn, [t]))
          .join(' OR ')})`;
      }
      replaceNode(node, replacement);
    };

    // Collapse pass: equality matchers joined by the top-level AND spine
    // fold into ONE hasAllTokens per items column (a single index lookup
    // instead of N). Only spine conjuncts are safe to merge — anything under
    // OR/NOT keeps its per-node rewrite below.
    const spine: Array<SQLParser.ExpressionValue | SQLParser.ExprList> = [];
    const walkSpine = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList | null,
    ): void => {
      if (node == null) return;
      if (
        node.type === 'binary_expr' &&
        'operator' in node &&
        String(node.operator).toUpperCase() === 'AND'
      ) {
        walkSpine(node.left);
        walkSpine(node.right);
      } else {
        spine.push(node);
      }
    };
    walkSpine(ast.where);
    const byColumn = new Map<
      string,
      {
        info: KvItemsInfo;
        tokens: string[];
        nodes: Array<SQLParser.ExpressionValue | SQLParser.ExprList>;
      }
    >();
    for (const conjunct of spine) {
      const match = matchKvEquality(conjunct);
      if (!match || match.op !== '=') continue;
      const group = byColumn.get(match.info.kvItemsColumn) ?? {
        info: match.info,
        tokens: [],
        nodes: [],
      };
      group.tokens.push(...match.tokens);
      group.nodes.push(conjunct);
      byColumn.set(match.info.kvItemsColumn, group);
    }
    for (const group of byColumn.values()) {
      if (group.nodes.length < 2) continue; // singles handled per-node below
      replaceNode(
        group.nodes[0],
        generateHasAllSqlForKvItemsColumn(group.info.kvItemsColumn, [
          ...new Set(group.tokens),
        ]),
      );
      for (const node of group.nodes.slice(1)) {
        replaceNode(node, '1 = 1');
      }
    }

    // OR-group pass: hasAnyTokens is the index's disjunction primitive. A
    // maximal OR subtree whose EVERY disjunct is a token-exact matcher
    // (equality, IN, or anchored-alternation match()) collapses to one
    // hasAnyTokens per items column — one index probe instead of N. A single
    // non-tokenizable disjunct disqualifies the whole group (the collapsed
    // predicate could no longer imply the original); its tokenizable
    // siblings still get their per-node rewrite below.
    const orNodes: Array<SQLParser.ExpressionValue | SQLParser.ExprList> = [];
    const findMaximalOrs = (
      node: SQLParser.ExpressionValue | SQLParser.ExprList | null,
      underOr: boolean,
    ): void => {
      if (node == null) return;
      const isOr =
        node.type === 'binary_expr' &&
        'operator' in node &&
        String(node.operator).toUpperCase() === 'OR';
      if (isOr && !underOr) orNodes.push(node);
      if (node.type === 'binary_expr') {
        if ('left' in node) findMaximalOrs(node.left, isOr);
        if ('right' in node) findMaximalOrs(node.right, isOr);
      } else if (node.type === 'expr_list' && Array.isArray(node.value)) {
        node.value.forEach(n => findMaximalOrs(n, false));
      }
    };
    findMaximalOrs(ast.where, false);
    for (const orNode of orNodes) {
      const disjuncts: Array<SQLParser.ExpressionValue | SQLParser.ExprList> =
        [];
      const flattenOr = (
        node: SQLParser.ExpressionValue | SQLParser.ExprList,
      ): void => {
        if (
          node.type === 'binary_expr' &&
          'operator' in node &&
          String(node.operator).toUpperCase() === 'OR'
        ) {
          flattenOr(node.left);
          flattenOr(node.right);
        } else {
          disjuncts.push(node);
        }
      };
      flattenOr(orNode);
      const groups = new Map<string, { info: KvItemsInfo; tokens: string[] }>();
      let allTokenizable = true;
      for (const d of disjuncts) {
        const match = matchKvEquality(d);
        if (!match) {
          allTokenizable = false;
          break;
        }
        const group = groups.get(match.info.kvItemsColumn) ?? {
          info: match.info,
          tokens: [],
        };
        group.tokens.push(...match.tokens);
        groups.set(match.info.kvItemsColumn, group);
      }
      if (!allTokenizable) continue;
      // Different items columns (e.g. a resource attr OR'd with a point
      // attr) OR their per-column probes — skip-index analysis unions the
      // candidate granules across an OR.
      const parts = [...groups.values()].map(group => {
        const tokens = [...new Set(group.tokens)];
        if (tokens.length === 1) {
          return generateHasAllSqlForKvItemsColumn(
            group.info.kvItemsColumn,
            tokens,
          );
        }
        if (group.info.useHasAny) {
          return generateHasAnySqlForKvItemsColumn(
            group.info.kvItemsColumn,
            tokens,
          );
        }
        // Legacy chain MUST carry its own parens: replaceNode drops the
        // original node's parentheses flag, and a bare `a OR b` grafted next
        // to an AND rebinds precedence (rows outside the AND leak through).
        return `(${tokens
          .map(t =>
            generateHasAllSqlForKvItemsColumn(group.info.kvItemsColumn, [t]),
          )
          .join(' OR ')})`;
      });
      replaceNode(
        orNode,
        parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`,
      );
    }

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
        rewriteSingle(node);
      } else if (node.type === 'expr_list' && Array.isArray(node.value)) {
        node.value.forEach(traverse);
      } else if (node.type === 'function') {
        // Standalone match() conjunct (anchored alternations only).
        rewriteSingle(node);
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
  isNumericExpr,
}: {
  fn: AggregateFunction | AggregateFunctionWithCombinators;
  expr?: string;
  level?: number;
  where?: string;
  sampleWeightExpression?: string;
  /** Skip the defensive float cast: expr is a known-numeric column. */
  isNumericExpr?: boolean;
}) => {
  const isAny = fn === 'any';
  const isNone = fn === 'none';
  const isCount = fn.startsWith('count');
  const isWhereUsed = isNonEmptyWhereExpr(where);
  // Cast to float64 because the expr might not be a number
  const unsafeExpr = {
    UNSAFE_RAW_SQL:
      isAny || isNone || isNumericExpr
        ? `${expr}`
        : `toFloat64OrDefault(toString(${expr}))`,
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
          isNumericExpr: select.isNumericValueExpression,
        });
      } else {
        expr = aggFnExpr({
          fn: select.aggFn,
          expr: select.valueExpression,
          where: whereClause.sql,
          sampleWeightExpression: chartConfig.sampleWeightExpression,
          isNumericExpr: select.isNumericValueExpression,
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
  prebucketed,
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
  /** The timestamp expression is ALREADY bucketed to this interval (e.g. a
   * metrics CTE's inner bucket column) — emit it bare instead of re-wrapping
   * in an identical toStartOfInterval. */
  prebucketed?: boolean;
}) {
  const unsafeTimestampValueExpression = {
    UNSAFE_RAW_SQL:
      bucketTimestampValueExpression ??
      getFirstTimestampValueExpression(timestampValueExpression),
  };

  if (prebucketed) {
    return chSql`${unsafeTimestampValueExpression} AS \`${{
      UNSAFE_RAW_SQL: alias,
    }}\``;
  }

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
  scanLookbackSeconds,
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
  scanLookbackSeconds?: number;
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

      // The lower bound aligns to the display-bucket start (so the first
      // bucket aggregates its full pre-window slice), then steps back by the
      // sample lookback when one is set — the previous-sample distance for
      // rate/lag chains — or by one bucket otherwise (v1 parity).
      const lookbackSql =
        scanLookbackSeconds != null
          ? `${Math.ceil(scanLookbackSeconds)} second`
          : undefined;
      const rawStartBound = isRenderingRawSqlTemplate
        ? includedDataInterval
          ? lookbackSql
            ? chSql`toStartOfInterval($__fromTime_ms, INTERVAL $__interval_s second) - INTERVAL ${lookbackSql}`
            : chSql`toStartOfInterval($__fromTime_ms, INTERVAL $__interval_s second) - INTERVAL $__interval_s second`
          : chSql`$__fromTime_ms`
        : includedDataInterval
          ? chSql`toStartOfInterval(fromUnixTimestamp64Milli(${{ Int64: startTime }}), INTERVAL ${includedDataInterval}) - INTERVAL ${lookbackSql ?? includedDataInterval}`
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
          prebucketed: chartConfig.timestampPrebucketed,
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
  // kv-items index companions: SQL equality matchers on attribute maps are
  // rewritten to has(<Items column>, 'k=v') wherever the FROM table exposes
  // the *AttributeItems ALIAS columns + text indexes (detection is
  // per-table via buildKvItemsLookup). Applies to the where string, sql
  // filters, and sql aggConditions alike — the map-value skip index cannot
  // prune common values, the pair token can. Lucene conditions get the same
  // treatment inside SearchQueryBuilder.
  const hasSqlFilter =
    chartConfig.filters?.some(f => f.type === 'sql') ?? false;
  const hasSqlWhere =
    isNonEmptyWhereExpr(chartConfig.where) &&
    (chartConfig.whereLanguage ?? 'sql') === 'sql';
  const hasSqlAggCondition =
    typeof chartConfig.select !== 'string' &&
    chartConfig.select.some(
      s =>
        isNonEmptyWhereExpr(s.aggCondition) &&
        (s.aggConditionLanguage ?? 'sql') === 'sql',
    );
  const kvItemsLookup: KvItemsLookup =
    (hasSqlFilter || hasSqlWhere || hasSqlAggCondition) &&
    chartConfig.from.databaseName &&
    chartConfig.from.tableName &&
    !hasSubqueryCte(chartConfig.with)
      ? await buildKvItemsLookup({
          metadata,
          databaseName: chartConfig.from.databaseName,
          tableName: chartConfig.from.tableName,
          connectionId: chartConfig.connection,
        })
      : new Map();

  let whereSearchCondition: ChSql | [] = [];
  if (isNonEmptyWhereExpr(chartConfig.where)) {
    whereSearchCondition = wrapChSqlIfNotEmpty(
      await renderWhereExpression({
        condition: hasSqlWhere
          ? rewriteSqlFilterWithKvItems(chartConfig.where, kvItemsLookup)
          : chartConfig.where,
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
              condition:
                (select.aggConditionLanguage ?? 'sql') === 'sql'
                  ? rewriteSqlFilterWithKvItems(
                      select.aggCondition,
                      kvItemsLookup,
                    )
                  : select.aggCondition,
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
            ? rewriteSqlFilterWithKvItems(filter.condition, kvItemsLookup)
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
          scanLookbackSeconds: chartConfig.scanLookbackSeconds,
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
    // targets that source table (indicated by a non-empty databaseName) and
    // the caller hasn't marked the scan as label-free (v2 points/rollup
    // tables carry no label columns — a substituted label filter there is an
    // unknown-identifier error; the series-table WHERE is the legal site).
    chartConfig.isRenderingRawSqlTemplate &&
      chartConfig.from.databaseName !== '' &&
      !chartConfig.omitFiltersMacro
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
          prebucketed: chartConfig.timestampPrebucketed,
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
  // CTE-backed sources (translated metric configs select FROM a WITH clause,
  // e.g. `Metrics`/`Bucketed`) are re-scannable: the ranking CTE is appended
  // AFTER the translated CTEs in the same WITH list. Only skip when the FROM
  // is neither a real table nor a known CTE.
  const fromIsKnownCte =
    !chartConfig.from?.databaseName &&
    !!chartConfig.from?.tableName &&
    (chartConfig.with ?? []).some(w => w.name === chartConfig.from.tableName);
  if (
    seriesLimit == null ||
    !isUsingGroupBy(chartConfig) ||
    !isUsingGranularity(chartConfig) ||
    chartConfig.selectGroupBy === false ||
    // Skip sourceless/string-select configs (no scannable FROM).
    ((!chartConfig.from?.databaseName || !chartConfig.from?.tableName) &&
      !fromIsKnownCte) ||
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
          prebucketed: chartConfig.timestampPrebucketed,
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
  /**
   * Overrides the LOWER-bound widening only (the upper bound keeps the
   * `includedDataInterval` +1-bucket ceiling that feeds the final display
   * bucket): cumulative rate/lag chains need each series' PREVIOUS SAMPLE,
   * which lives up to a scrape interval before the window — one display
   * bucket is not enough (15s buckets on a 60s-interval metric render an
   * empty left edge). Raw scans look back max(2× estimated scrape interval,
   * 1 bucket); rollup chains exactly one TIER bucket.
   */
  scanLookbackSeconds?: number;
  settings?: ChSql;
  /**
   * The (translated) config's `timestampValueExpression` is already bucketed
   * to `granularity` (metrics CTEs bucket internally); the outer select/
   * group-by/order-by emit it bare instead of double-bucketing.
   */
  timestampPrebucketed?: boolean;
  /**
   * Suppress the $__filters macro in raw-SQL-template mode for WHEREs that
   * target label-free tables (v2 points/rollup scans).
   */
  omitFiltersMacro?: boolean;
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

  // OTel metrics v2 (series/points split schema) uses a different query shape
  if (isMetricsV2Tables(metricTables)) {
    return translateMetricChartConfigV2(chartConfig, metadata);
  }

  // assumes all the selects are from a single metric type, for now
  const { select, from, filters, where, ...restChartConfig } = chartConfig;
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
  } else if (
    metricType === MetricsDataType.Histogram &&
    metricName &&
    MetricsDataType.Histogram in metricTables &&
    metricTables[MetricsDataType.Histogram]
  ) {
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
    } satisfies BuilderChartConfigWithOptDateRangeEx;

    const timeBucketSelect = isUsingGranularity(cteChartConfig)
      ? timeBucketExpr({
          interval: cteChartConfig.granularity,
          timestampValueExpression: cteChartConfig.timestampValueExpression,
          dateRange: cteChartConfig.dateRange,
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
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
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
          metricType: MetricsDataType.Histogram,
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

/**
 * Metrics v2 (series/points split schema) translation. Produces the two-phase
 * query shape:
 *   Series CTE (label matchers on the text-indexed series table, Date-bounded)
 *   → points scan (TimeUnix-bounded, SeriesHash IN Series) aggregated per
 *   (series, time bucket) → label join → generic outer query.
 *
 * User where/filters/aggConditions are applied to the SERIES table (label
 * matchers); they cannot reference point columns like Value. The points scan
 * gets only the MetricName + time bounds.
 */
async function translateMetricChartConfigV2(
  chartConfig: BuilderChartConfigWithOptDateRangeEx,
  metadata: Metadata,
): Promise<BuilderChartConfigWithOptDateRangeEx> {
  const metricTables = chartConfig.metricTables;
  if (!metricTables || !isMetricsV2Tables(metricTables)) {
    return chartConfig;
  }

  const { select, from, filters, where, ...restChartConfig } = chartConfig;
  if (!select || !Array.isArray(select)) {
    throw new Error('multi select or string select on metrics not supported');
  }

  const { metricType, metricName, metricNameSql, ..._select } = select[0]; // Initial impl only supports one metric select per chart config

  if (!metricType || !metricName) {
    throw new Error('metricType and metricName are required for v2 metrics');
  }

  // 'increase' is only valid for Sum metrics.
  if (_select.aggFn === 'increase' && metricType !== MetricsDataType.Sum) {
    throw new Error(
      `aggFn 'increase' is only supported for Sum (counter) metrics (got metricType=${metricType})`,
    );
  }

  const seriesTable = metricTables.series;
  const pointsTable =
    metricType === MetricsDataType.Histogram
      ? metricTables.histogramPoints
      : metricType === MetricsDataType.ExponentialHistogram
        ? metricTables.expHistogramPoints
        : metricType === MetricsDataType.Summary
          ? metricTables.summaryPoints
          : metricTables.points;

  if (!pointsTable) {
    throw new Error(`no v2 points table configured for type=${metricType}`);
  }

  // Number/table tiles carry NO granularity — the CTE time expressions fall
  // back to 'auto' (timeBucketExpr), so interval resolution here must do the
  // same or the rate divisor, scan widening, and rollup routing all compute
  // against a phantom zero-width bucket (a 24h Number tile rendered
  // per-HOUR increases labeled per-second, and never routed to a tier).
  const effectiveGranularity = chartConfig.granularity || 'auto';

  // Whole-metric fast path: the panel aggregates the ENTIRE metric — no
  // label filters, no group-by — so `MetricName = '...'` alone is a PK scan
  // and series resolution adds nothing (the joinless shapes are emitted by
  // the CTE builders; hist/summary quantiles are excluded since they need
  // ExplicitBounds/Quantiles from the series table).
  // Raw-SQL templates are excluded: they are reusable with late-bound
  // $__filters, whose only legal landing site is the series-table WHERE —
  // templates must always keep the Series CTE.
  const isWholeMetric =
    !isNonEmptyWhereExpr(where) &&
    (filters ?? []).length === 0 &&
    !isNonEmptyWhereExpr(_select.aggCondition) &&
    !isUsingGroupBy(chartConfig) &&
    !chartConfig.isRenderingRawSqlTemplate;
  // Temporality/monotonicity + cross-type collision info from the series
  // profile (one cached narrow read) — the families table lacks Temporality
  // in this build. Fast-path candidates need it for the joinless shapes;
  // every other non-gauge panel uses it to emit a single temporality branch
  // instead of computing both variants per point (the dead variant is a
  // full window pass on sums). Unresolvable profiles fall back to the dual
  // shapes.
  const seriesProfile =
    isWholeMetric || metricType !== MetricsDataType.Gauge
      ? await metadata.getMetricSeriesProfile({
          databaseName: from.databaseName,
          tableName: seriesTable,
          metricNameCondition: createMetricNameFilter(
            metricName,
            metricNameSql,
          ),
          metricTypeValue: METRICS_V2_METRIC_TYPE[metricType],
          dateRange: Array.isArray(chartConfig.dateRange)
            ? chartConfig.dateRange
            : undefined,
          connectionId: chartConfig.connection,
        })
      : undefined;
  // Gauge and Sum share otel_metrics_points(+_5m/_1h); without the Series
  // CTE the MetricType guard is gone, so a same-name metric of the other
  // float type would co-mingle. Unknown profile (undefined otherMetricTypes:
  // failed or empty lookup) fails closed.
  const floatTableCollisionSafe =
    seriesProfile?.otherMetricTypes != null &&
    !seriesProfile.otherMetricTypes.includes(
      metricType === MetricsDataType.Gauge
        ? METRICS_V2_METRIC_TYPE[MetricsDataType.Sum]
        : METRICS_V2_METRIC_TYPE[MetricsDataType.Gauge],
    );
  // Resolved-but-not-fast profile info for the CTE builders: static
  // temporality branch with the label join kept.
  const resolvedProfile =
    seriesProfile?.temporality != null
      ? {
          temporality: seriesProfile.temporality,
          isMonotonic: seriesProfile.isMonotonic,
        }
      : undefined;

  // Rate/lag chains (cumulative or unresolved temporality) need each
  // series' PREVIOUS SAMPLE, which lives up to a scrape interval before the
  // window — one display bucket is not enough (a 15s-bucket panel on a
  // 60s-interval metric rendered an empty left edge for the first
  // scrape-interval of every chart). Raw scans look back
  // max(2× estimated scrape interval, 1 display bucket) (flat 5-minute
  // Prometheus default when the interval is unknown); rollup chains need
  // the previous TIER bucket (not a full display bucket — a 1d-bucket panel
  // on the 5m tier was scanning 1d of pre-window tier rows). The upper
  // bound keeps the +1-bucket ceiling: it feeds the final display bucket.
  // Delta-resolved shapes read no previous sample and keep ±1-bucket
  // parity; summary quantiles take the last point per bucket (no chain).
  const needsLookback =
    metricType !== MetricsDataType.Gauge &&
    seriesProfile?.temporality !== 'delta' &&
    !(metricType === MetricsDataType.Summary && _select.aggFn === 'quantile') &&
    Array.isArray(chartConfig.dateRange);
  // Auto-granularity snapping consumes the same day-cached estimate the
  // lookback padding does (one fetch, shared cache key). Template mode
  // never resolves auto: the bucket late-binds to $__timeInterval.
  // Estimate-driven snapping is currently DISABLED (the 60s auto-ladder
  // floor covers ≤60s scrape intervals statically) — see
  // SCRAPE_INTERVAL_GRANULARITY_SNAP_ENABLED in core/utils.
  const autoResolvable =
    effectiveGranularity === 'auto' &&
    Array.isArray(chartConfig.dateRange) &&
    !chartConfig.isRenderingRawSqlTemplate;
  const wantsAutoSnap =
    autoResolvable && SCRAPE_INTERVAL_GRANULARITY_SNAP_ENABLED;
  const scrapeIntervalEstimate =
    needsLookback || wantsAutoSnap
      ? await metadata.getMetricScrapeIntervalEstimate({
          databaseName: from.databaseName,
          tableName: pointsTable,
          metricNameCondition: createMetricNameFilter(
            metricName,
            metricNameSql,
          ),
          connectionId: chartConfig.connection,
          // template renders carry a SENTINEL dateRange (epoch) — anchoring
          // the sample there returns an always-empty probe and degrades the
          // baked lookback to the 300s fallback
          dateRange:
            Array.isArray(chartConfig.dateRange) &&
            !chartConfig.isRenderingRawSqlTemplate
              ? chartConfig.dateRange
              : undefined,
        })
      : undefined;

  // Display buckets NARROWER than the scrape interval sample a rotating
  // subset of the series population per bucket (square-wave charts,
  // alternating quantiles) — so auto granularity snaps UP to the metric's
  // estimated interval (2× when uncertain). Applies to every metric type
  // and path; the snapped value drives bucketing, tier routing, the rate
  // divisor, and scan widening below. Explicit granularities are never
  // rewritten (the UI warns instead).
  const snappedAutoInterval =
    effectiveGranularity === 'auto' && Array.isArray(chartConfig.dateRange)
      ? wantsAutoSnap
        ? snapDisplayGranularity(
            convertDateRangeToGranularityString(chartConfig.dateRange),
            scrapeIntervalEstimate,
          )
        : convertDateRangeToGranularityString(chartConfig.dateRange)
      : undefined;
  const resolvedInterval = snappedAutoInterval ?? chartConfig.granularity;
  const intervalSeconds = resolvedInterval
    ? convertGranularityToSeconds(resolvedInterval)
    : 0;

  // Sum/histogram-family types widen the scan by ±1 bucket so rates can be
  // computed at the range edges (v1 parity). Gauges scan the range as-is.
  const includedDataInterval =
    metricType === MetricsDataType.Gauge ? undefined : resolvedInterval;

  // Rollup tier routing: raw points for sub-5m buckets, the 5m tier for
  // 5m..1h buckets, the 1h tier beyond — the cookbook's "route by range×step"
  // (grain <= step always holds; HyperDX windows are ~60 buckets so the
  // >=3-rollup-buckets rule holds too). Gauge/sum use the float tiers;
  // explicit histograms use the histogram tiers; exponential histograms use
  // their own tiers (Scale in the aggregation key, Map-keyed buckets).
  // Summaries have NO rollup tiers (pre-computed quantiles are not
  // time-mergeable). Gauge isDelta stays on raw (needs per-point
  // timestamps). Exp avg is not supported on either tier, so it never
  // routes.
  const tier5m =
    metricType === MetricsDataType.Histogram
      ? metricTables.histogramPoints5m
      : metricType === MetricsDataType.ExponentialHistogram
        ? metricTables.expHistogramPoints5m
        : metricTables.points5m;
  const tier1h =
    metricType === MetricsDataType.Histogram
      ? metricTables.histogramPoints1h
      : metricType === MetricsDataType.ExponentialHistogram
        ? metricTables.expHistogramPoints1h
        : metricTables.points1h;
  const canUseRollup =
    (metricType === MetricsDataType.Gauge && !_select.isDelta) ||
    metricType === MetricsDataType.Sum ||
    metricType === MetricsDataType.Histogram ||
    (metricType === MetricsDataType.ExponentialHistogram &&
      _select.aggFn !== 'avg');
  const rollupTable = !canUseRollup
    ? undefined
    : intervalSeconds >= 3600 && tier1h
      ? tier1h
      : intervalSeconds >= 300 && tier5m
        ? tier5m
        : undefined;
  const tierSeconds =
    rollupTable == null ? undefined : rollupTable === tier1h ? 3600 : 300;
  const scanTable = rollupTable ?? pointsTable;

  // Routing guard — checked before rendering or estimating anything, so an
  // over-cap request issues at most the two cheap day-cached metadata
  // lookups above (profile + scrape interval), never a scan. It must run
  // AFTER snapping: a snapped-up bucket can newly qualify for a rollup
  // tier. Raw-tier quantile scans are per-point work that grows linearly
  // with the window (a 24h exp-hist quantile is structurally unable to
  // finish inside the execution timeout — measured retry storms burning
  // ~533 CPU-s per attempt). Applies to histogram-family quantiles that
  // resolved to a raw scan (rollup tables not configured, or a forced-fine
  // granularity pins them to raw). Summary quantiles — which can never
  // route to a tier — use the cost-based gate further down instead: their
  // per-point work is a plain array pick, so a flat window cap wrongly
  // blocks small metrics at 6h+. Count/avg panels on these types are scalar
  // math and stay uncapped.
  if (
    _select.aggFn === 'quantile' &&
    !rollupTable &&
    (metricType === MetricsDataType.Histogram ||
      metricType === MetricsDataType.ExponentialHistogram) &&
    Array.isArray(chartConfig.dateRange)
  ) {
    const windowMs =
      chartConfig.dateRange[1].getTime() - chartConfig.dateRange[0].getTime();
    if (windowMs > RAW_QUANTILE_MAX_WINDOW_MS) {
      throw new Error(
        `window too large for this metric type — reduce the window (${
          !tier5m && !tier1h
            ? 'no rollup tables are configured for this metric type, so the query reads raw points; configure the 5m/1h rollup tables on the source or reduce the window'
            : 'this granularity is too fine to use the 5m/1h rollup tiers, so the query reads raw points; use a coarser granularity or a smaller window'
        })`,
      );
    }
  }

  const MAX_SCAN_LOOKBACK_SECONDS = 6 * 60 * 60;
  // A bare 2× pad has ZERO margin at the two-interval boundary when the
  // estimate lands on a round number (exactly 120s for a 60s scrape): a
  // baseline sample at start−120.3s (one missed scrape + timestamp jitter)
  // is excluded and the first bucket's increase drops. V1_QUERY_PARITY §2:
  // pad by interval + jitter margin — 121s-class for a 60s scrape. The
  // margin lives HERE (not in the shared emission ceil, which also serves
  // the rollup branch): ceil(2×59.6)+1 must yield 121, not 2×60+1.
  const SCAN_LOOKBACK_JITTER_MARGIN_SECONDS = 1;
  const scanLookbackSeconds = !needsLookback
    ? undefined
    : Math.min(
        MAX_SCAN_LOOKBACK_SECONDS,
        rollupTable
          ? // rollup scans bound the toStartOfInterval-quantized TimeBucket —
            // grid points carry no jitter, so no margin needed here
            Math.max(
              tierSeconds ?? 300,
              scrapeIntervalEstimate?.intervalSeconds
                ? 2 * scrapeIntervalEstimate.intervalSeconds
                : 0,
            )
          : Math.max(
              scrapeIntervalEstimate?.intervalSeconds
                ? Math.ceil(2 * scrapeIntervalEstimate.intervalSeconds) +
                    SCAN_LOOKBACK_JITTER_MARGIN_SECONDS
                : 300,
              intervalSeconds || 0,
            ),
      );

  // Phase 1 WHERE: user where/filters/aggConditions (label matchers) +
  // MetricName + MetricType, bounded on the bare Date sort key (column
  // metadata identifies it as Date-typed so timeFilterExpr emits inclusive
  // toDate-wrapped bounds; wrapping the key column itself can weaken
  // pruning). The Date lower bound derives from the padded scan start
  // (scanLookbackSeconds) so the lookback rows resolve too.
  const seriesWhere = await renderWhere(
    {
      ...chartConfig,
      from: { databaseName: from.databaseName, tableName: seriesTable },
      filters: [
        ...(filters ?? []),
        {
          type: 'sql',
          condition: createMetricNameFilter(metricName, metricNameSql),
        },
        {
          type: 'sql',
          condition: SqlString.format('MetricType = ?', [
            METRICS_V2_METRIC_TYPE[metricType],
          ]),
        },
      ],
      timestampValueExpression: 'Date',
      bucketTimestampValueExpression: undefined,
      includedDataInterval,
      scanLookbackSeconds,
    },
    metadata,
  );

  // Day-rounded variant of the series WHERE for cost estimates: the
  // ms-precision bounds in `seriesWhere` change every refresh and would
  // defeat the estimate cache (and leak one MetadataCache entry per
  // refresh); day-rounding keys one uniq(SeriesHash) per (metric, filters,
  // day) and only ever over-counts (fails toward gating more /
  // parallelizing more). Raw-SQL-template renders bail: their sentinel
  // dateRange and late-bound $__ macros cannot be executed.
  const getSeriesCountForCost = async (): Promise<number | undefined> => {
    if (
      !Array.isArray(chartConfig.dateRange) ||
      chartConfig.isRenderingRawSqlTemplate
    ) {
      return undefined;
    }
    const estimateWhere = await renderWhere(
      {
        ...chartConfig,
        from: { databaseName: from.databaseName, tableName: seriesTable },
        filters: [
          ...(filters ?? []),
          {
            type: 'sql',
            condition: createMetricNameFilter(metricName, metricNameSql),
          },
          {
            type: 'sql',
            condition: SqlString.format('MetricType = ?', [
              METRICS_V2_METRIC_TYPE[metricType],
            ]),
          },
        ],
        timestampValueExpression: 'Date',
        bucketTimestampValueExpression: undefined,
        dateRange: [
          new Date(
            Math.floor(chartConfig.dateRange[0].getTime() / 86_400_000) *
              86_400_000,
          ),
          new Date(
            Math.ceil(chartConfig.dateRange[1].getTime() / 86_400_000) *
              86_400_000,
          ),
        ],
      },
      metadata,
    );
    return metadata.getMetricSeriesCountEstimate({
      databaseName: from.databaseName,
      tableName: seriesTable,
      where: estimateWhere,
      connectionId: chartConfig.connection,
    });
  };

  // Whale guard: raw scan forced by sub-5m display buckets + a long window.
  // Only now (after the cheap structural checks) is the series-count
  // estimate queried — one day-cached uniq(SeriesHash) over the day-rounded
  // resolution predicate, so a label filter that narrows the scope also
  // clears the guard (day-rounding only over-counts, which fails toward
  // gating). Fails open when the estimate is unavailable.
  if (
    !rollupTable &&
    intervalSeconds > 0 &&
    intervalSeconds < 300 &&
    Array.isArray(chartConfig.dateRange) &&
    chartConfig.dateRange[1].getTime() - chartConfig.dateRange[0].getTime() >
      FINE_BUCKET_RAW_MAX_WINDOW_MS
  ) {
    const seriesCount = await getSeriesCountForCost();
    if (seriesCount !== undefined && seriesCount > WHALE_SERIES_THRESHOLD) {
      throw new Error(
        `too many series for this granularity — narrow the scope or coarsen the buckets ` +
          `(~${Math.round(seriesCount / 1000)}k series match; sub-5-minute buckets read raw points, ` +
          `which stays interactive only with a label filter (<${WHALE_SERIES_THRESHOLD / 1000}k series) ` +
          `or a window under ${FINE_BUCKET_RAW_MAX_WINDOW_MS / 3600000}h` +
          `${
            metricType !== MetricsDataType.Summary
              ? '; buckets of 5 minutes or coarser route to the rollup tiers at any cardinality'
              : ''
          })`,
      );
    }
  }

  // Summary quantile cost gate: summaries have no rollup tier, so every
  // window reads raw points — but the cost is series × window ÷ interval,
  // and a flat window cap wrongly blocks trivially cheap 6h+ panels on
  // small metrics (the quantile columns render as per-bucket trends of the
  // client-computed quantiles — correct semantics; true re-aggregation of
  // pre-computed quantiles is impossible). Windows over the flat-cap
  // threshold consult the estimates; an unavailable series count falls back
  // to the previous flat cap (fail closed — an unbounded whale summary scan
  // is a guaranteed timeout storm). Count/sum panels are exact at any range
  // and are never gated.
  if (
    _select.aggFn === 'quantile' &&
    metricType === MetricsDataType.Summary &&
    Array.isArray(chartConfig.dateRange)
  ) {
    const windowMs =
      chartConfig.dateRange[1].getTime() - chartConfig.dateRange[0].getTime();
    if (windowMs > RAW_QUANTILE_MAX_WINDOW_MS) {
      const seriesCount = await getSeriesCountForCost();
      if (seriesCount === undefined) {
        throw new Error(
          `window too large for this metric type — reduce the window (summary quantiles are not time-mergeable and always read raw points; the series-count estimate is unavailable, so windows over ${RAW_QUANTILE_MAX_WINDOW_MS / 3_600_000}h are blocked)`,
        );
      }
      const summaryScrapeInterval =
        scrapeIntervalEstimate ??
        (await metadata.getMetricScrapeIntervalEstimate({
          databaseName: from.databaseName,
          tableName: pointsTable,
          metricNameCondition: createMetricNameFilter(
            metricName,
            metricNameSql,
          ),
          connectionId: chartConfig.connection,
          dateRange:
            Array.isArray(chartConfig.dateRange) &&
            !chartConfig.isRenderingRawSqlTemplate
              ? chartConfig.dateRange
              : undefined,
        }));
      const intervalS = summaryScrapeInterval?.intervalSeconds || 30;
      const estRows = (seriesCount * (windowMs / 1000)) / intervalS;
      if (estRows > SUMMARY_RAW_SCAN_MAX_ROWS) {
        throw new Error(
          `summary quantile scan too large — narrow the scope with a label filter or reduce the window ` +
            `(~${Math.round(seriesCount / 1000)}k matched series over ${Math.round(windowMs / 3_600_000)}h ` +
            `≈ ${Math.round(estRows / 1_000_000)}M raw points at a ~${Math.round(intervalS)}s scrape interval; ` +
            `the interactive limit is ${SUMMARY_RAW_SCAN_MAX_ROWS / 1_000_000}M. ` +
            `Count/sum panels on summaries are exact at any range)`,
        );
      }
    }
  }

  // Resolve narrow: project only the series columns this query's math and
  // group-by reference (the attribute maps are the fattest columns and
  // resolution is linear in matched series). Profile-resolved temporality
  // drops the Temporality/IsMonotonic projections too — the static branch
  // never reads them.
  const groupByText =
    typeof chartConfig.groupBy === 'string'
      ? chartConfig.groupBy
      : (chartConfig.groupBy ?? [])
          .map(g => `${g.valueExpression} ${g.alias ?? ''}`)
          .join(', ');
  const seriesNeeds = parseSeriesNeeds(
    [groupByText],
    metricType === MetricsDataType.Sum
      ? {
          temporality: resolvedProfile == null,
          monotonicity:
            resolvedProfile == null ||
            (resolvedProfile.temporality === 'cumulative' &&
              resolvedProfile.isMonotonic === undefined),
        }
      : metricType === MetricsDataType.Histogram
        ? {
            temporality: resolvedProfile == null,
            explicitBounds: _select.aggFn === 'quantile',
            metricName: _select.aggFn === 'quantile',
          }
        : metricType === MetricsDataType.ExponentialHistogram
          ? // LowCardinality scalar — cheap; used by the dual-path fallback
            // and the count path (the branched quantile shapes ignore it).
            { temporality: resolvedProfile == null }
          : metricType === MetricsDataType.Summary
            ? {
                quantiles: _select.aggFn === 'quantile',
                temporality:
                  _select.aggFn === 'count' && resolvedProfile == null,
              }
            : {},
  );

  // Phase 2 WHERE: MetricName + time bounds only (labels live on the series
  // table). SeriesHash IN (Series) is appended by the CTE builders. Rollup
  // tiers are scanned on their TimeBucket column instead of TimeUnix.
  const pointsTimestampExpr = rollupTable
    ? 'TimeBucket'
    : chartConfig.timestampValueExpression || DEFAULT_METRIC_TABLE_TIME_COLUMN;
  const pointsWhere = await renderWhere(
    {
      ...chartConfig,
      select: [],
      where: '',
      whereLanguage: 'sql',
      from: { databaseName: from.databaseName, tableName: scanTable },
      filters: [
        {
          type: 'sql',
          condition: createMetricNameFilter(metricName, metricNameSql),
        },
      ],
      timestampValueExpression: pointsTimestampExpr,
      includedDataInterval,
      scanLookbackSeconds,
      // v2 points/rollup tables carry no label columns — dashboard filters
      // must land on the series-table WHERE, never the scan.
      omitFiltersMacro: true,
    },
    metadata,
  );

  const seriesCte = seriesCteV2({
    seriesFrom: renderFrom({
      from: { databaseName: from.databaseName, tableName: seriesTable },
    }),
    seriesWhere,
    needs: seriesNeeds,
  });

  // Parallel-replicas gate: on only when the estimated scan (matched series
  // × rows per series over the window) is large enough that distribution
  // beats coordination overhead; 0 everywhere else (global-on measurably
  // regressed small panels). Capability-checked for WRITABILITY (a
  // settings-profile CONST constraint lists the setting but hard-fails any
  // override) so constrained users never see it. The estimate is day-cached
  // (see getSeriesCountForCost) and fails toward OFF.
  let parallelReplicas = false;
  if (PARALLEL_REPLICAS_GATE_ENABLED && Array.isArray(chartConfig.dateRange)) {
    const windowSec =
      (chartConfig.dateRange[1].getTime() -
        chartConfig.dateRange[0].getTime()) /
      1000;
    const rowsPerSeries = rollupTable
      ? windowSec / (tierSeconds ?? 300)
      : windowSec / (scrapeIntervalEstimate?.intervalSeconds || 30);
    const seriesCountForCost = await getSeriesCountForCost();
    if (
      seriesCountForCost != null &&
      seriesCountForCost * rowsPerSeries > PARALLEL_REPLICAS_MIN_SCAN_ROWS
    ) {
      parallelReplicas =
        (await metadata
          .isSettingChangeable({
            settingName: 'enable_parallel_replicas',
            connectionId: chartConfig.connection,
          })
          .catch(() => undefined)) === true;
    }
  }
  const v2Settings = parallelReplicas
    ? chSql`short_circuit_function_evaluation = 'force_enable', enable_parallel_replicas = 1`
    : chSql`short_circuit_function_evaluation = 'force_enable'`;

  const pointsFrom = renderFrom({
    from: { databaseName: from.databaseName, tableName: scanTable },
  });

  if (metricType === MetricsDataType.Gauge) {
    const timeBucketCol = '__hdx_time_bucket2';
    const timeExpr = timeBucketExpr({
      // resolvedInterval carries the scrape-interval snap for 'auto'
      interval: resolvedInterval ?? 'auto',
      timestampValueExpression: pointsTimestampExpr,
      bucketTimestampValueExpression:
        chartConfig.bucketTimestampValueExpression,
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
      // template mode must late-bind the bucket to $__timeInterval — baking
      // the sentinel-range 'auto' resolution pins every dashboard window to
      // a conversion-time constant
      isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
    });

    // Only consumed by the raw gaugeCtesV2 path (the rollup builder hardcodes
    // argMaxMerge(Last)). ValueMax is the per-(series, ts) duplicate collapse
    // done in the raw Bucketed CTE's inner subquery.
    const bucketValueExpr = _select.isDelta
      ? renderDeltaExpression(
          { ...chartConfig, timestampValueExpression: pointsTimestampExpr },
          'ValueMax',
        )
      : // argMax is deterministic w.r.t. TimeUnix ordering, unlike v1's
        // last_value which in a GROUP BY context is read-order anyLast.
        // Also matches the rollup tier's argMaxMerge(Last) semantics.
        `argMax(ValueMax, TimeUnix)`;

    // Gauges need no temporality, but the fast path still requires the
    // cross-type collision check (shared float points table).
    const gaugeFast = isWholeMetric && floatTableCollisionSafe;
    return {
      ...restChartConfig,
      with: [
        ...(gaugeFast ? [] : [seriesCte]),
        ...(rollupTable
          ? gaugeRollupCtesV2({
              fast: gaugeFast,
              needs: seriesNeeds,
              rollupFrom: pointsFrom,
              rollupWhere: pointsWhere,
              timeExpr,
              timeBucketCol,
            })
          : gaugeCtesV2({
              fast: gaugeFast,
              needs: seriesNeeds,
              pointsFrom,
              pointsWhere,
              timeExpr,
              timeBucketCol,
              bucketValueExpr,
              // Prometheus staleness for the last-value pick: a series whose
              // newest point in a bucket is a marker is gone, not holding its
              // last value. The isDelta expression consumes every deduped row,
              // so it relies on the plain Rule-6 marker filter instead.
              dropStaleBuckets: !_select.isDelta,
            })),
      ],
      select: [
        {
          ..._select,
          valueExpression: 'LastValue',
          aggCondition: '', // applied at the Series CTE
          isNumericValueExpression: true, // LastValue is Float64
        },
      ],
      from: {
        databaseName: '',
        tableName: 'Metrics',
      },
      where: '', // applied at the Series CTE
      timestampValueExpression: `\`${timeBucketCol}\``,
      timestampPrebucketed: true, // Bucketed already applied the granularity
      settings: v2Settings,
    };
  } else if (metricType === MetricsDataType.Sum) {
    const timeBucketCol = '__hdx_time_bucket2';
    const timeExpr = timeBucketExpr({
      // resolvedInterval carries the scrape-interval snap for 'auto'
      interval: resolvedInterval ?? 'auto',
      timestampValueExpression: pointsTimestampExpr,
      bucketTimestampValueExpression:
        chartConfig.bucketTimestampValueExpression,
      dateRange: chartConfig.dateRange,
      alias: timeBucketCol,
      // template mode must late-bind the bucket to $__timeInterval — baking
      // the sentinel-range 'auto' resolution pins every dashboard window to
      // a conversion-time constant
      isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
    });

    // Sums branch on Temporality (and IsMonotonic when cumulative), so the
    // fast path needs both resolved from the profile; otherwise fall back.
    const sumFast =
      isWholeMetric &&
      floatTableCollisionSafe &&
      seriesProfile?.temporality != null &&
      (seriesProfile.temporality === 'delta' ||
        seriesProfile.isMonotonic !== undefined)
        ? {
            temporality: seriesProfile.temporality,
            isMonotonic: seriesProfile.isMonotonic,
          }
        : undefined;
    // Rate is normalized to per-SECOND by the DISPLAY bucket width — a
    // window-scoped "increase per bucket" reads 2GB at 15m and 4GB at 1h for
    // the same traffic, and tier routing would step-change it. The divisor
    // is late-bound in template mode ($__interval_s tracks the dashboard
    // interval).
    const rateDivisor = chartConfig.isRenderingRawSqlTemplate
      ? '$__interval_s'
      : String(Math.max(1, intervalSeconds));
    const sumWith: NonNullable<BuilderChartConfigWithOptDateRangeEx['with']> = [
      ...(sumFast ? [] : [seriesCte]),
      ...(rollupTable
        ? sumRollupCtesV2({
            fast: sumFast,
            resolved: resolvedProfile,
            needs: seriesNeeds,
            rollupFrom: pointsFrom,
            rollupWhere: pointsWhere,
            timeExpr,
            timeBucketCol,
            rateDivisor,
          })
        : sumCtesV2({
            fast: sumFast,
            resolved: resolvedProfile,
            needs: seriesNeeds,
            pointsFrom,
            pointsWhere,
            timeExpr,
            timeBucketCol,
            rateDivisor,
          })),
    ];

    // For aggFn='increase' + groupBy, restrict the outer query to the top N
    // groups (v1 parity — see translateMetricChartConfig).
    const shouldApplyIncreaseGroupLimit =
      _select.aggFn === 'increase' && isUsingGroupBy(chartConfig);

    let outerWhere: string = '';

    if (shouldApplyIncreaseGroupLimit) {
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

      const groupByEmptyFilter = concatChSql(
        ' AND ',
        (Array.isArray(groupByForRank) ? groupByForRank : [groupByForRank]).map(
          g => chSql`(${g} IS NOT NULL AND toString(${g}) != '')`,
        ),
      );

      sumWith.push({
        name: 'TopGroups',
        sql: chSql`
            SELECT \`group\`
            FROM (
              SELECT
                tuple(${groupBySql}) AS \`group\`,
                ${'' /* increase panels rank groups by per-bucket increase */}
                sum(Increase) AS \`bucket_value\`
              FROM Bucketed
              WHERE ${groupByEmptyFilter}
              GROUP BY \`group\`, \`${timeBucketCol}\`
            )
            GROUP BY \`group\`
            ORDER BY max(\`bucket_value\`) DESC, \`group\`
            LIMIT ${{ Int32: INCREASE_MAX_NUM_GROUPS }}
          `,
      });

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
        _select.aggFn === 'increase'
          ? {
              // explicit per-interval intent ("requests this minute") — the
              // only sum aggregate that stays window-scoped
              alias: 'Value',
              ..._select,
              aggFn: 'sum',
              valueExpression: 'Increase',
              aggCondition: '',
              isNumericValueExpression: true, // Increase is Float64
            }
          : _select.aggFn
            ? {
                // Monotonic counters: every other aggregate reads the
                // per-SECOND Rate, so sum = total throughput and
                // avg/max/min/pXX operate across per-series rates — all
                // window-invariant. UpDownCounters (IsMonotonic = false) are
                // LEVELS that arrive typed as Sum (memory usage, open
                // connections): differencing a level produces
                // plausible-looking noise, so gauge-style aggregates read
                // the per-bucket level instead (Bucketed.Sum = the newest
                // sample per series). Unresolved profiles keep counter
                // treatment — the picker labels it "(assumes counter)".
                alias: 'Value',
                ..._select,
                valueExpression:
                  resolvedProfile?.temporality === 'cumulative' &&
                  resolvedProfile.isMonotonic === false
                    ? 'Sum'
                    : 'Rate',
                aggCondition: '',
                isNumericValueExpression: true,
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
      where: outerWhere,
      whereLanguage: shouldApplyIncreaseGroupLimit
        ? 'sql'
        : restChartConfig.whereLanguage,
      timestampValueExpression: `\`${timeBucketCol}\``,
      timestampPrebucketed: true, // Bucketed already applied the granularity
      ...(parallelReplicas
        ? { settings: chSql`enable_parallel_replicas = 1` }
        : {}),
    };
  } else if (
    metricType === MetricsDataType.Histogram ||
    metricType === MetricsDataType.ExponentialHistogram ||
    metricType === MetricsDataType.Summary
  ) {
    const { alias } = _select;
    const valueAlias = alias || 'Value';

    // Exp-hist: temporality resolved from the series profile (fetched above
    // for every non-gauge panel, type-scoped so another type under the same
    // NAME can't leak its temporality in) — the generator emits a single
    // branch instead of computing both variants per point.
    const expTemporality =
      metricType === MetricsDataType.ExponentialHistogram
        ? seriesProfile?.temporality
        : undefined;

    // Fast path for the histogram family: scalar (count/avg) panels and
    // BRANCHED exp quantiles go joinless with the resolved temporality;
    // explicit-histogram and summary quantiles always keep resolution
    // (ExplicitBounds/Quantiles are series identity).
    const familyFast =
      isWholeMetric && seriesProfile?.temporality != null
        ? { temporality: seriesProfile.temporality }
        : undefined;
    const quantileNeedsSeries =
      _select.aggFn === 'quantile' &&
      (metricType === MetricsDataType.Histogram ||
        metricType === MetricsDataType.Summary);
    const familyFastActive =
      familyFast != null &&
      !quantileNeedsSeries &&
      // exp quantile is joinless only when single-branch
      !(
        metricType === MetricsDataType.ExponentialHistogram &&
        _select.aggFn === 'quantile' &&
        expTemporality == null
      );

    const histCteConfig = {
      ...chartConfig,
      from: { databaseName: from.databaseName, tableName: pointsTable },
      timestampValueExpression: pointsTimestampExpr,
      includedDataInterval,
    } satisfies BuilderChartConfigWithOptDateRangeEx;

    const timeBucketSelect = isUsingGranularity(histCteConfig)
      ? timeBucketExpr({
          // resolvedInterval carries the scrape-interval snap for 'auto'
          interval: resolvedInterval ?? histCteConfig.granularity,
          timestampValueExpression: histCteConfig.timestampValueExpression,
          dateRange: histCteConfig.dateRange,
          // template mode must late-bind the bucket to $__timeInterval (see
          // the gauge/sum sites)
          isRenderingRawSqlTemplate: chartConfig.isRenderingRawSqlTemplate,
        })
      : chSql``;

    // groupBy is folded into the CTEs (referencing the joined series labels);
    // the outer query selects the materialized `group` column.
    let groupBy: ChSql | undefined;
    if (isUsingGroupBy(chartConfig)) {
      groupBy = concatChSql(
        ',',
        await renderSelectList(chartConfig.groupBy, chartConfig, metadata),
      );
    }

    const translateArgs = {
      select: _select,
      timeBucketSelect: timeBucketSelect.sql
        ? chSql`${timeBucketSelect}`
        : 'TimeUnix AS `__hdx_time_bucket`',
      groupBy,
      pointsFrom,
      pointsWhere,
      valueAlias,
    };
    const familyFastArg = familyFastActive ? familyFast : undefined;
    const familyResolved =
      resolvedProfile != null
        ? { temporality: resolvedProfile.temporality }
        : undefined;
    const typeCtes =
      metricType === MetricsDataType.Histogram
        ? rollupTable
          ? translateHistogramRollupV2({
              ...translateArgs,
              fast: familyFastArg,
              resolved: familyResolved,
            })
          : translateHistogramV2({
              ...translateArgs,
              fast: familyFastArg,
              resolved: familyResolved,
            })
        : metricType === MetricsDataType.ExponentialHistogram
          ? rollupTable
            ? translateExpHistogramRollupV2({
                ...translateArgs,
                temporality: expTemporality,
                fast: familyFastArg,
              })
            : translateExpHistogramV2({
                ...translateArgs,
                temporality: expTemporality,
                fast: familyFastArg,
              })
          : translateSummaryV2({
              ...translateArgs,
              fast: familyFastArg,
              resolved: familyResolved,
            });

    return {
      ...restChartConfig,
      with: [...(familyFastArg ? [] : [seriesCte]), ...typeCtes],
      select: `\`__hdx_time_bucket\`${groupBy ? ', group' : ''}, "${valueAlias}"`,
      from: {
        databaseName: '',
        tableName: 'metrics',
      },
      where: '', // applied at the Series CTE
      groupBy: undefined,
      granularity: undefined, // time bucketing applied at the source CTE
      timestampValueExpression: '`__hdx_time_bucket`',
      settings: v2Settings,
    };
  }

  throw new Error(`no v2 query support for metric type=${metricType}`);
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

// EditForm -> translateToQueriedChartConfig -> QueriedChartConfig
// renderFn(QueriedChartConfig) -> sql
// query(sql) -> data
// formatter(data) -> displayspecificDs
// displaySettings(QueriedChartConfig) -> displaySepcificDs
// chartComponent(displayspecificDs) -> React.Node
