import {
  type ASTNode,
  type Expression,
  formatNode,
  type FunctionNode,
  isExpressionList,
  isFunction,
  isIdentifier,
  isQueryParameter,
  isTableIdentifier,
  isWithElement,
  type OrderByElementNode,
  parse,
  ParseError,
  type SelectQueryNode,
  type Statement,
} from '@clickhouse/parser';

import {
  FILTERS_MACRO_NAME,
  INTERVAL_MACROS,
  TIME_RANGE_MACROS,
} from '@/macros';
import { RawSqlQueryParam } from '@/rawSqlParams';
import {
  type AggregateFunction,
  AggregateFunctionSchema,
  DerivedColumn,
  DISPLAY_TYPE_LABELS,
  DisplayType,
  type Limit,
  type SQLInterval,
} from '@/types';

import { NAMED_BUCKET_FUNCTIONS } from './materializedViews';
import { isNumericAggFn } from './renderChartConfig';
import { splitAndTrimWithBracket } from './utils';

export class SqlToBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlToBuilderError';
  }
}

/** Prefix a macro is rewritten to so the SQL parses. */
const MACRO_SENTINEL_PREFIX = 'hdx_macro_';

/** Macro name that resolves to the builder's configured source table. */
const SOURCE_TABLE_MACRO_NAME = 'sourceTable';

type BuilderSource = {
  databaseName: string;
  tableName: string;
};

/** Macro base names that expand to a time-range predicate on the WHERE clause. */
const TIME_RANGE_MACRO_NAMES: Set<string> = new Set(TIME_RANGE_MACROS);

const START_TIME_MACROS: Set<string> = new Set(['fromTime', 'fromTime_ms']);
const END_TIME_MACROS: Set<string> = new Set(['toTime', 'toTime_ms']);

type TimeBoundKind = 'start' | 'end';

/** Macro base names that expand to a time-bucketing expression. */
const INTERVAL_MACRO_NAMES: Set<string> = new Set(INTERVAL_MACROS);

/**
 * Query-parameter names the time-range macros expand to. Users can bind a query
 * to the dashboard time range either through a macro (`$__timeFilter(col)`) or
 * by referencing these parameters directly (the form the macros expand to,
 * e.g. `col >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})`), so
 * both are recognized identically.
 */
const TIME_RANGE_QUERY_PARAMS: Set<string> = new Set([
  RawSqlQueryParam.startDateMilliseconds,
  RawSqlQueryParam.endDateMilliseconds,
]);

/**
 * Query-parameter names the interval macros expand to. A time bucket can be
 * written as a macro (`$__timeInterval(col)`) or as its expansion referencing
 * these parameters directly (`toStartOfInterval(col, INTERVAL
 * {intervalSeconds:Int64} second)`).
 */
const INTERVAL_QUERY_PARAMS: Set<string> = new Set([
  RawSqlQueryParam.intervalSeconds,
  RawSqlQueryParam.intervalMilliseconds,
]);

/**
 * ClickHouse named time-bucket functions (`toStartOfMinute`, `toStartOfHour`, etc)
 * keyed by lower-cased name, mapped to the fixed granularity they represent.
 */
const NAMED_BUCKET_FNS_BY_LOWER: Map<string, SQLInterval> = new Map(
  Object.entries(NAMED_BUCKET_FUNCTIONS).map(([fn, granularity]) => [
    fn.toLowerCase(),
    granularity,
  ]),
);

/**
 * `INTERVAL <n> <unit>` parses to a `toInterval<Unit>(n)` function node; maps the
 * lower-cased function name to the `SQLInterval` unit the builder understands.
 * Units outside the builder's supported set (week/month/…) are intentionally
 * absent, so those intervals aren't recognized as a builder granularity.
 */
const INTERVAL_FN_UNITS: Map<string, string> = new Map([
  ['tointervalsecond', 'second'],
  ['tointervalminute', 'minute'],
  ['tointervalhour', 'hour'],
  ['tointervalday', 'day'],
]);

/** Builder-supported, single-arg functions (`fn[If](expr)`) */
const SIMPLE_AGG_FNS: Set<string> = new Set(
  AggregateFunctionSchema.options.filter(
    fn =>
      !['count', 'count_distinct', 'quantile', 'none', 'increase'].includes(fn),
  ),
);

/** Narrows a raw SQL function name to a simple builder aggFn. */
function isSimpleAggFn(fn: string): fn is AggregateFunction {
  return SIMPLE_AGG_FNS.has(fn);
}

function isSupportedQuantileLevel(level: number): boolean {
  return [0.5, 0.9, 0.95, 0.99].some(l => Math.abs(l - level) < 1e-9);
}

/**
 * The `count(DISTINCT …)` family, keyed by (lower-cased) function name. Approximate
 * `uniq` is intentionally absent (it falls through to a raw `none` column).
 */
const COUNT_DISTINCT_FORMS: Map<string, { conditional: boolean }> = new Map([
  ['countdistinct', { conditional: false }],
  ['countifdistinct', { conditional: true }],
  ['uniqexact', { conditional: false }],
  ['uniqexactif', { conditional: true }],
]);

type AggSpec = {
  aggFn: AggregateFunction;
  /** Fixed quantile level (e.g. `median` → 0.5). */
  level?: number;
  /** Read the level from the call's parametric args (`quantile(0.95)(x)`). */
  levelFromParameters?: boolean;
};

/** Aggregate functions that map to quantile, keyed by their lower-cased base name. */
const AGG_SPECS: Map<string, AggSpec> = new Map([
  ['median', { aggFn: 'quantile', level: 0.5 }],
  ['quantile', { aggFn: 'quantile', levelFromParameters: true }],
]);

const macroName = (nodeName: string): string | undefined =>
  nodeName.startsWith(MACRO_SENTINEL_PREFIX)
    ? nodeName.slice(MACRO_SENTINEL_PREFIX.length)
    : undefined;

/** Rewrites `$__macro`/`$__macro(args)` tokens to `hdx_macro_macro`(args) */
export function replaceMacrosWithSentinels(sql: string): string {
  return sql.replace(/\$__(\w+)/g, `${MACRO_SENTINEL_PREFIX}$1`);
}

/**
 * Collects the macro tokens (`$__name`) left in emitted builder SQL fields.
 * Recognized macros are consumed during conversion (time bucket → granularity,
 * time filter / `$__filters` dropped, `$__sourceTable` → FROM); anything that
 * remains references a macro the builder has no field for. The parse step
 * rewrote `$__name` to a `hdx_macro_name` sentinel, so that is what survives in
 * the emitted strings — this reports it back in its original `$__name` form.
 */
function collectLeakedMacros(fields: string[]): string[] {
  // Literal form of `${MACRO_SENTINEL_PREFIX}(<name>)` — kept literal so it isn't
  // flagged as a dynamic RegExp.
  const sentinelRe = /hdx_macro_(\w+)/g;
  const macros = new Set<string>();
  for (const field of fields) {
    for (const match of field.matchAll(sentinelRe)) {
      macros.add(`$__${match[1]}`);
    }
  }
  return [...macros].sort();
}

/** Depth-first walk over every nested AST node reachable from `node`. */
function walk(node: unknown, visit: (n: ASTNode) => void) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }
    return;
  }

  if (typeof node === 'object') {
    if ('type' in node && typeof node.type === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a string `type` marks a parser AST node
      visit(node as ASTNode);
    }

    // Recurse into every child node
    for (const value of Object.values(node)) {
      walk(value, visit);
    }
  }
}

/** True when any node in the subtree rooted at `node` satisfies `predicate`. */
function subtreeSome(
  node: ASTNode,
  predicate: (n: ASTNode) => boolean,
): boolean {
  let found = false;
  walk(node, n => {
    if (!found && predicate(n)) {
      found = true;
    }
  });
  return found;
}

/** True when any node in `node`'s subtree is a `hdx_macro_<name>` reference for
 *  a macro base name accepted by `predicate`. */
function subtreeReferencesMacro(
  node: Expression,
  predicate: (name: string) => boolean,
): boolean {
  // Macros are rewritten to sentinel identifiers (`$__fromTime`) or functions
  // (`$__timeInterval(col)`), so only those two node kinds carry a macro name.
  return subtreeSome(node, n => {
    if (!isIdentifier(n) && !isFunction(n)) return false;
    const base = macroName(n.name);
    return base != null && predicate(base);
  });
}

/** True when any `{name:Type}` query parameter in `node`'s subtree has a name
 *  accepted by `predicate`. */
function subtreeReferencesQueryParam(
  node: ASTNode,
  predicate: (name: string) => boolean,
): boolean {
  return subtreeSome(node, n => isQueryParameter(n) && predicate(n.name));
}

/** True when a subtree contains a dashboard time-range macro or query param. */
function subtreeReferencesTimeRange(node: ASTNode): boolean {
  return (
    subtreeSome(node, n => {
      if (!isIdentifier(n) && !isFunction(n)) return false;
      const base = macroName(n.name);
      return base != null && TIME_RANGE_MACRO_NAMES.has(base);
    }) ||
    subtreeReferencesQueryParam(node, name => TIME_RANGE_QUERY_PARAMS.has(name))
  );
}

/** True when any identifier/table in `node`'s subtree has the given name. */
function subtreeReferencesName(node: Expression, name: string): boolean {
  return subtreeSome(
    node,
    n =>
      (isIdentifier(n) || isFunction(n) || isTableIdentifier(n)) &&
      n.name === name,
  );
}

/** Formats an AST expression back to a single-line SQL string. */
function toSql(node: Expression): string {
  return formatNode(node)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** Formats an expression, stripping a trailing `AS alias` if present. */
function toSqlWithoutAlias(node: Expression): string {
  if ('alias' in node && node.alias) {
    return toSql({ ...node, alias: undefined });
  }
  return toSql(node);
}

/** Parses and formats a standalone expression for stable AST comparisons. */
function normalizeExpressionSql(expression: string): string | undefined {
  try {
    const statements = parse(`SELECT ${expression}`);
    if (statements.length !== 1) return undefined;
    const statement = statements[0];
    if (
      statement.type !== 'SelectWithUnionQuery' ||
      statement.selects.length !== 1 ||
      statement.selects[0].type !== 'SelectQuery' ||
      statement.selects[0].select.length !== 1
    ) {
      return undefined;
    }
    return toSqlWithoutAlias(statement.selects[0].select[0]);
  } catch {
    return undefined;
  }
}

/** Timestamp expressions the current builder source will filter. */
function configuredTimestampExpressions(
  timestampValueExpression: string | undefined,
): Set<string> {
  if (!timestampValueExpression?.trim()) return new Set();
  return new Set(
    splitAndTrimWithBracket(timestampValueExpression)
      .map(normalizeExpressionSql)
      .filter((expression): expression is string => expression != null),
  );
}

/** Recognizes the renderer's unwrapped start/end bound. */
function rawTimeBoundKind(node: Expression): TimeBoundKind | undefined {
  if (isIdentifier(node)) {
    const base = macroName(node.name);
    if (base != null && START_TIME_MACROS.has(base)) return 'start';
    if (base != null && END_TIME_MACROS.has(base)) return 'end';
    return undefined;
  }
  if (!isFunction(node)) return undefined;

  const lower = node.name.toLowerCase();
  if (lower === 'fromunixtimestamp64milli' && node.arguments.length === 1) {
    const parameter = node.arguments[0];
    if (!isQueryParameter(parameter) || parameter.param_type !== 'Int64') {
      return undefined;
    }
    if (parameter.name === RawSqlQueryParam.startDateMilliseconds) {
      return 'start';
    }
    if (parameter.name === RawSqlQueryParam.endDateMilliseconds) return 'end';
  }
  return undefined;
}

/** Recognizes the renderer's exact included-data-interval expansion. */
function includedIntervalBoundKind(
  node: Expression,
): TimeBoundKind | undefined {
  if (!isFunction(node) || node.arguments.length !== 2) return undefined;
  const operation = node.name.toLowerCase();
  const intervalStart = node.arguments[0];
  if (
    (operation !== 'minus' && operation !== 'plus') ||
    !isFunction(intervalStart) ||
    intervalStart.name.toLowerCase() !== 'tostartofinterval' ||
    intervalStart.arguments.length !== 2 ||
    subtreeReferencesTimeRange(node.arguments[1]) ||
    toSql(intervalStart.arguments[1]) !== toSql(node.arguments[1])
  ) {
    return undefined;
  }

  const kind = rawTimeBoundKind(intervalStart.arguments[0]);
  if (operation === 'minus' && kind === 'start') return kind;
  if (operation === 'plus' && kind === 'end') return kind;
  return undefined;
}

function unwrappedTimeBoundKind(node: Expression): TimeBoundKind | undefined {
  return rawTimeBoundKind(node) ?? includedIntervalBoundKind(node);
}

/**
 * Recognizes the complete RHS shape emitted for `lhs`. Renderer-added wrappers
 * must match the timestamp expression instead of being accepted recursively.
 */
function rendererTimeBoundKind(
  lhs: Expression,
  rhs: Expression,
): TimeBoundKind | undefined {
  if (isFunction(lhs)) {
    const lhsName = lhs.name.toLowerCase();
    if (lhsName === 'todate') {
      return isFunction(rhs) &&
        rhs.name.toLowerCase() === lhsName &&
        rhs.arguments.length === 1
        ? unwrappedTimeBoundKind(rhs.arguments[0])
        : undefined;
    }
    if (lhsName.startsWith('tostartof')) {
      if (
        !isFunction(rhs) ||
        rhs.name.toLowerCase() !== lhsName ||
        rhs.arguments.length !== lhs.arguments.length ||
        rhs.arguments
          .slice(1)
          .some(
            (argument, index) =>
              toSql(argument) !== toSql(lhs.arguments[index + 1]),
          )
      ) {
        return undefined;
      }
      return unwrappedTimeBoundKind(rhs.arguments[0]);
    }
  }

  const direct = unwrappedTimeBoundKind(rhs);
  if (direct != null) return direct;

  // A bare Date column is only distinguishable through metadata during render,
  // so accept the renderer's single toDate wrapper for configured expressions.
  return isFunction(rhs) &&
    rhs.name.toLowerCase() === 'todate' &&
    rhs.arguments.length === 1
    ? unwrappedTimeBoundKind(rhs.arguments[0])
    : undefined;
}

type TimestampMatch = {
  baseExpression: string;
  expression: string;
};

/** Matches a configured timestamp or one renderer-added primary-key bucket. */
function matchTimestampExpression(
  node: Expression,
  configured: Set<string>,
): TimestampMatch | undefined {
  const expression = toSql(node);
  if (configured.has(expression)) {
    return { baseExpression: expression, expression };
  }
  if (!isFunction(node) || !node.name.toLowerCase().startsWith('tostartof')) {
    return undefined;
  }
  const firstArgument = node.arguments[0];
  if (firstArgument == null) return undefined;
  const baseExpression = toSql(firstArgument);
  return configured.has(baseExpression)
    ? { baseExpression, expression }
    : undefined;
}

function unsupportedTimeRangeError(): SqlToBuilderError {
  return new SqlToBuilderError(
    'This query uses dashboard time-range macros or parameters in a WHERE expression that cannot be represented by the chart builder.',
  );
}

function timestampExpressionMismatchError(
  sqlExpressions: string[],
  configuredExpressions: Set<string>,
): SqlToBuilderError {
  const quotedSqlExpressions = sqlExpressions
    .map(expression => `"${expression}"`)
    .join(', ');
  const quotedConfiguredExpressions = [...configuredExpressions]
    .map(expression => `"${expression}"`)
    .join(', ');
  const sqlExpressionLabel =
    sqlExpressions.length === 1
      ? 'timestamp expression'
      : 'timestamp expressions';
  const sourceExpressionLabel =
    configuredExpressions.size === 1 ? 'uses' : 'uses timestamp expressions';

  return new SqlToBuilderError(
    `The SQL time filter uses ${sqlExpressionLabel} ${quotedSqlExpressions}, but the selected source ${sourceExpressionLabel} ${quotedConfiguredExpressions}. Update the SQL time filter or select a matching source.`,
  );
}

type RecognizedTimePredicate = TimestampMatch & {
  bounds: readonly TimeBoundKind[];
};

/** Maps a timestamp comparison function to the dashboard bound it represents. */
function comparisonTimeBoundKind(
  comparison: string,
): TimeBoundKind | undefined {
  const lower = comparison.toLowerCase();
  if (lower === 'greater' || lower === 'greaterorequals') return 'start';
  if (lower === 'less' || lower === 'lessorequals') return 'end';
  return undefined;
}

/** Positively recognizes one complete renderer-supported time conjunct. */
function recognizeTimeConjunct(
  conjunct: Expression,
  configured: Set<string>,
): RecognizedTimePredicate[] | undefined {
  if (!isFunction(conjunct)) return undefined;

  const macro = macroName(conjunct.name);
  if (macro != null && TIME_RANGE_MACRO_NAMES.has(macro)) {
    const expressions = conjunct.arguments.map(toSql);
    const expectedCount = macro === 'dateTimeFilter' || macro === 'dt' ? 2 : 1;
    return expressions.length === expectedCount &&
      new Set(expressions).size === expectedCount &&
      expressions.every(expression => configured.has(expression))
      ? expressions.map(expression => ({
          baseExpression: expression,
          bounds: ['start', 'end'],
          expression,
        }))
      : undefined;
  }

  if (conjunct.arguments.length !== 2) return undefined;
  const expectedBound = comparisonTimeBoundKind(conjunct.name);
  if (expectedBound == null) return undefined;

  const timestamp = matchTimestampExpression(conjunct.arguments[0], configured);
  const bound = rendererTimeBoundKind(
    conjunct.arguments[0],
    conjunct.arguments[1],
  );
  return timestamp != null && bound === expectedBound
    ? [{ ...timestamp, bounds: [bound] }]
    : undefined;
}

/**
 * Returns timestamp expressions from an otherwise valid time predicate that
 * do not match the selected source. Malformed time predicates return an empty
 * array so they retain the more general unsupported-time-range error.
 */
function mismatchedTimestampExpressions(
  conjunct: Expression,
  configured: Set<string>,
): string[] {
  if (!isFunction(conjunct)) return [];

  const macro = macroName(conjunct.name);
  if (macro != null && TIME_RANGE_MACRO_NAMES.has(macro)) {
    const expressions = conjunct.arguments.map(toSql);
    const expectedCount = macro === 'dateTimeFilter' || macro === 'dt' ? 2 : 1;
    if (
      expressions.length !== expectedCount ||
      new Set(expressions).size !== expectedCount
    ) {
      return [];
    }
    return expressions.filter(expression => !configured.has(expression));
  }

  if (conjunct.arguments.length !== 2) return [];
  const expectedBound = comparisonTimeBoundKind(conjunct.name);
  if (expectedBound == null) return [];

  const [lhs, rhs] = conjunct.arguments;
  const bound = rendererTimeBoundKind(lhs, rhs);
  if (bound !== expectedBound || matchTimestampExpression(lhs, configured)) {
    return [];
  }
  return [toSql(lhs)];
}

type TimeRangePair = {
  baseExpression: string;
  bounds: Set<TimeBoundKind>;
};

/**
 * Returns the indices of canonical time-range conjuncts that the builder will
 * reproduce. Throws when any time reference is partial, targets another
 * expression, or is nested in a shape the builder cannot represent.
 */
function canonicalTimeRangeConjuncts(
  conjuncts: Expression[],
  timestampValueExpression: string | undefined,
): Set<number> {
  const configured = configuredTimestampExpressions(timestampValueExpression);
  const consumed = new Set<number>();
  const pairs = new Map<string, TimeRangePair>();

  for (const [index, conjunct] of conjuncts.entries()) {
    if (!subtreeReferencesTimeRange(conjunct)) continue;
    const recognized = recognizeTimeConjunct(conjunct, configured);
    if (recognized == null) {
      const mismatchedExpressions = mismatchedTimestampExpressions(
        conjunct,
        configured,
      );
      if (configured.size > 0 && mismatchedExpressions.length > 0) {
        throw timestampExpressionMismatchError(
          mismatchedExpressions,
          configured,
        );
      }
      throw unsupportedTimeRangeError();
    }
    consumed.add(index);

    for (const predicate of recognized) {
      const pair = pairs.get(predicate.expression) ?? {
        baseExpression: predicate.baseExpression,
        bounds: new Set<TimeBoundKind>(),
      };
      predicate.bounds.forEach(bound => pair.bounds.add(bound));
      pairs.set(predicate.expression, pair);
    }
  }

  if (pairs.size === 0) return consumed;

  for (const [expression, pair] of pairs) {
    if (pair.bounds.size !== 2) throw unsupportedTimeRangeError();
    if (
      !configured.has(expression) &&
      pairs.get(pair.baseExpression)?.bounds.size !== 2
    ) {
      throw unsupportedTimeRangeError();
    }
  }
  if (
    [...configured].some(expression => pairs.get(expression)?.bounds.size !== 2)
  ) {
    throw unsupportedTimeRangeError();
  }
  return consumed;
}

/**
 * Flattens a left/variadic `and(...)` tree into its top-level conjuncts.
 * `renderChartConfig` joins the time filter, WHERE, filters placeholder, and
 * series-limit predicate with ` AND `, so the parser yields a single (often
 * variadic) `and` node whose arguments are exactly those pieces.
 */
function flattenAnd(node: Expression): Expression[] {
  if (isFunction(node) && node.name.toLowerCase() === 'and') {
    return node.arguments.flatMap(flattenAnd);
  }
  return [node];
}

/** Flattens a variadic `or(...)` tree into its disjuncts. */
function flattenOr(node: Expression): Expression[] {
  if (isFunction(node) && node.name.toLowerCase() === 'or') {
    return node.arguments.flatMap(flattenOr);
  }
  return [node];
}

/** ANDs two SQL condition strings, parenthesizing when both are present. */
function andConditions(existing: string, addition: string): string {
  const a = existing.trim();
  const b = addition.trim();
  if (!a) return b;
  if (!b) return a;
  return `(${a}) AND (${b})`;
}

/**
 * Unwraps the `toFloat64OrDefault(toString(expr))` or partial hand-written variants.
 */
function unwrapNumericCoercion(node: Expression): Expression {
  const lower = isFunction(node) ? node.name.toLowerCase() : '';
  if (
    !isFunction(node) ||
    (lower !== 'tofloat64' && lower !== 'tofloat64ordefault') ||
    // Intentionally not unwrapping `toFloat64OrDefault(expr, <default>)`
    // because the builder doesn't represent the default value.
    node.arguments.length !== 1
  ) {
    return node;
  }

  const inner = node.arguments[0];
  if (
    isFunction(inner) &&
    inner.name.toLowerCase() === 'tostring' &&
    inner.arguments.length === 1
  ) {
    return inner.arguments[0];
  }
  return inner;
}

/**
 * Extracts the user-authored aggregation condition from an `...If(...)` filter
 * argument, dropping the trailing `AND <value> IS NOT NULL` guard the builder
 * appends for numeric aggregations.
 */
function extractAggCondition(
  condition: Expression,
  valueNode: Expression,
): string {
  if (isFunction(condition) && condition.name.toLowerCase() === 'and') {
    const conjuncts = flattenAnd(condition);
    const valueSql = toSql(valueNode);
    const kept = conjuncts.filter(conjunct => {
      if (
        isFunction(conjunct) &&
        conjunct.name.toLowerCase() === 'isnotnull' &&
        conjunct.arguments.length === 1 &&
        toSql(conjunct.arguments[0]) === valueSql
      ) {
        return false;
      }
      return true;
    });
    if (kept.length === 1) {
      return toSql(kept[0]);
    }
    if (kept.length > 1) {
      return kept.map(c => `(${toSql(c)})`).join(' AND ');
    }
    return '';
  }
  return toSql(condition);
}

/** Base fields shared by every parsed series column. */
function makeColumn(
  fields: Partial<DerivedColumn> & { valueExpression: string },
): DerivedColumn {
  return {
    aggCondition: '',
    aggConditionLanguage: 'sql',
    ...fields,
  } as DerivedColumn;
}

/**
 * Maps a single SELECT expression to a builder series column. Recognizes the
 * aggregation shapes `renderChartConfig` emits (count/countIf, count(DISTINCT),
 * quantile(level), avg/sum/min/max/any/last_value and their `...If` variants);
 * anything else becomes a raw `none` column carrying the verbatim expression.
 */
function parseSeriesColumn(node: Expression): DerivedColumn {
  const alias = 'alias' in node && node.alias ? node.alias : undefined;

  const none = () =>
    makeColumn({
      aggFn: 'none',
      valueExpression: toSqlWithoutAlias(node),
      alias,
    });

  if (!isFunction(node)) return none();

  // ClickHouse aggregate function names are case-insensitive, and the SQL
  // formatter uppercases some of them (e.g. `AVG`), so match on lower case.
  const { arguments: args } = node;
  const lower = node.name.toLowerCase();

  // count() / count(*) / countIf(cond). `count` is special: it carries no value
  // expression, and countIf's condition is its first argument. `count(*)` parses
  // to a single Asterisk argument, equivalent to the no-arg `count()`.
  if (
    lower === 'count' &&
    (args.length === 0 || (args.length === 1 && args[0].type === 'Asterisk'))
  ) {
    return makeColumn({ aggFn: 'count', valueExpression: '', alias });
  }
  if (lower === 'countif' && args.length >= 1) {
    return makeColumn({
      aggFn: 'count',
      valueExpression: '',
      aggCondition: toSql(args[0]),
      alias,
    });
  }

  // count(DISTINCT expr) / uniqExact(expr) and their conditional forms all map
  // to count_distinct, carrying the distinct expression in args[0].
  const distinctForm = COUNT_DISTINCT_FORMS.get(lower);
  if (distinctForm) {
    const expectedArgs = distinctForm.conditional ? 2 : 1;
    if (args.length === expectedArgs) {
      return makeColumn({
        aggFn: 'count_distinct',
        valueExpression: toSql(args[0]),
        aggCondition: distinctForm.conditional
          ? extractAggCondition(args[1], args[0])
          : '',
        alias,
      });
    }
  }

  // Every remaining supported aggregation carries its value in args[0] and, for
  // the `...If` variant, its condition in args[1]. A trailing `If` selects the
  // conditional form; the base name maps to a builder aggFn via AGG_SPECS or,
  // for avg/sum/min/max/any/last_value, the simple-aggFn fallback.
  const ifMatch = lower.match(/^(.+?)if$/);
  const baseFn = ifMatch ? ifMatch[1] : lower;
  const spec: AggSpec | undefined =
    AGG_SPECS.get(baseFn) ??
    (isSimpleAggFn(baseFn) ? { aggFn: baseFn } : undefined);
  if (spec && args.length >= 1) {
    const column = buildAggColumn(spec, node, ifMatch != null, alias);
    if (column) return column;
  }

  // Unrecognized expression (or unsupported quantile level) → raw passthrough.
  return none();
}

/**
 * Builds a series column for an aggregate function call. The value
 * expression is `args[0]` and, for an `...If` variant, the condition is
 * `args[1]`. Returns `undefined` when the call doesn't match its spec.
 */
function buildAggColumn(
  spec: AggSpec,
  node: FunctionNode,
  isConditional: boolean,
  alias: string | undefined,
): DerivedColumn | undefined {
  const { arguments: args, parameters } = node;

  let level = spec.level;
  if (spec.levelFromParameters) {
    if (!parameters || parameters.length !== 1) return undefined;
    const levelNode = parameters[0];
    const parsed = levelNode.type === 'Literal' ? Number(levelNode.value) : NaN;
    if (!isSupportedQuantileLevel(parsed)) return undefined;
    level = parsed;
  }

  const valueNode = isNumericAggFn(spec.aggFn)
    ? unwrapNumericCoercion(args[0])
    : args[0];

  return makeColumn({
    aggFn: spec.aggFn,
    ...(level != null ? { level } : {}),
    valueExpression: toSql(valueNode),
    aggCondition:
      isConditional && args.length >= 2
        ? extractAggCondition(args[1], args[0])
        : '',
    alias,
  } as Partial<DerivedColumn> & { valueExpression: string });
}

/**
 * A recognized time bucket and the timestamp expression needed to reproduce it
 * in the builder.
 */
type TimeBucket = {
  granularity: SQLInterval | 'auto';
  timestampValueExpression: string;
};

/** Removes the conversion wrapper added by the interval macro/renderer. */
function unwrapBucketTimestamp(node: Expression): Expression {
  if (!isFunction(node)) return node;
  const lower = node.name.toLowerCase();
  if (
    (lower === 'todatetime' || lower === 'todatetime64') &&
    node.arguments.length >= 1
  ) {
    return node.arguments[0];
  }
  return node;
}

/**
 * Recognizes a complete time-bucket expression. The alias is deliberately
 * ignored: only the expression itself proves that it is a bucket.
 */
function parseTimeBucket(node: Expression): TimeBucket | undefined {
  if (!isFunction(node)) return undefined;

  const base = macroName(node.name);
  if (
    base != null &&
    INTERVAL_MACRO_NAMES.has(base) &&
    node.arguments.length === 1
  ) {
    return {
      granularity: 'auto',
      timestampValueExpression: toSql(node.arguments[0]),
    };
  }

  const lower = node.name.toLowerCase();

  // Named fixed buckets, e.g. `toStartOfMinute(ts)` / `toStartOfHour(ts)`.
  const named = NAMED_BUCKET_FNS_BY_LOWER.get(lower);
  if (named != null && node.arguments.length >= 1) {
    return {
      granularity: named,
      timestampValueExpression: toSql(node.arguments[0]),
    };
  }

  // Hand-written queries may spell out the interval macro's expansion directly,
  // e.g. `toStartOfInterval(TimestampTime, INTERVAL {intervalSeconds:Int64} second)`.
  if (lower !== 'tostartofinterval' || node.arguments.length < 2)
    return undefined;

  const interval = node.arguments[1];
  const granularity = subtreeReferencesQueryParam(interval, name =>
    INTERVAL_QUERY_PARAMS.has(name),
  )
    ? 'auto'
    : fixedIntervalFromToStartOfInterval(node);
  if (granularity == null) return undefined;

  return {
    granularity,
    timestampValueExpression: toSql(unwrapBucketTimestamp(node.arguments[0])),
  };
}

/** Ensures the builder will reproduce the bucket against the same timestamp. */
function validateTimeBucketTimestamp(
  bucket: TimeBucket,
  configuredExpression: string | undefined,
): void {
  if (
    !configuredTimestampExpressions(configuredExpression).has(
      bucket.timestampValueExpression,
    )
  ) {
    throw new SqlToBuilderError(
      'The query time bucket must use a timestamp expression configured by the selected source.',
    );
  }
}

/**
 * Reads the fixed `SQLInterval` from a `toStartOfInterval(col, INTERVAL <n>
 * <unit>)` node. `INTERVAL <n> <unit>` parses to a `toInterval<Unit>(n)`
 * function argument; units outside the builder's set yield `undefined`.
 */
function fixedIntervalFromToStartOfInterval(
  node: Expression,
): SQLInterval | undefined {
  if (!isFunction(node) || node.arguments.length < 2) return undefined;
  const intervalArg = node.arguments[1];
  if (!isFunction(intervalArg) || intervalArg.arguments.length !== 1) {
    return undefined;
  }
  const unit = INTERVAL_FN_UNITS.get(intervalArg.name.toLowerCase());
  if (unit == null) return undefined;
  const amount = intervalArg.arguments[0];
  if (amount.type !== 'Literal') return undefined;
  const num = Number(amount.value);
  if (!Number.isInteger(num) || num <= 0) return undefined;
  return `${num} ${unit}` as SQLInterval;
}

/** True when a SELECT/GROUP BY item is a time-bucket expression. */
function isTimeBucket(node: Expression): boolean {
  return parseTimeBucket(node) !== undefined;
}

/**
 * Aliases assigned to time-bucket SELECT items (e.g. `... AS ts`), so a GROUP BY
 * or ORDER BY that references the bucket by that alias (`GROUP BY ts`) — the
 * shape hand-written queries use — is recognized as the bucket too.
 */
function timeBucketAliases(query: SelectQueryNode): Set<string> {
  return new Set(
    query.select
      .filter(isTimeBucket)
      .map(item => ('alias' in item ? item.alias : undefined))
      .filter((alias): alias is string => alias != null),
  );
}

/** True when `node` is the time bucket itself or a reference to it by alias. */
function isTimeBucketOrAlias(node: Expression, aliases: Set<string>): boolean {
  return isTimeBucket(node) || (isIdentifier(node) && aliases.has(node.name));
}

export type SqlToBuilderResult = {
  select: DerivedColumn[];
  seriesReturnType?: 'ratio' | 'column';
  where: string;
  whereLanguage: 'sql';
  groupBy: string;
  granularity?: SQLInterval | 'auto';
  having?: string;
  havingLanguage?: 'sql';
  orderBy?: string;
  limit?: Limit;
};

/**
 * Parses the (macro-substituted) SQL and validates it is a shape the builder
 * can represent, returning the single SELECT query node. Throws a
 * `SqlToBuilderError` for anything the builder has no representation for.
 */
function parseSelectQuery(
  sqlTemplate: string,
  source: BuilderSource | undefined,
): SelectQueryNode {
  if (!sqlTemplate.trim()) {
    throw new SqlToBuilderError('The SQL query is empty.');
  }

  let statements: Statement[];
  try {
    statements = parse(replaceMacrosWithSentinels(sqlTemplate));
  } catch (e) {
    const detail = e instanceof ParseError ? `: ${e.message}` : '';
    throw new SqlToBuilderError(`The SQL query could not be parsed${detail}.`);
  }

  if (statements.length !== 1) {
    throw new SqlToBuilderError(
      'Only a single SELECT statement can be converted to the builder.',
    );
  }

  const [statement] = statements;
  if (statement.type !== 'SelectWithUnionQuery') {
    throw new SqlToBuilderError(
      'Only SELECT queries can be converted to the builder.',
    );
  }
  if (statement.selects.length !== 1) {
    throw new SqlToBuilderError(
      'UNION queries cannot be converted to the builder.',
    );
  }
  const query = statement.selects[0];
  if (query.type !== 'SelectQuery') {
    throw new SqlToBuilderError(
      'This query shape cannot be converted to the builder.',
    );
  }

  // Reject constructs the builder has no representation for.
  if (query.distinct) {
    throw new SqlToBuilderError(
      'SELECT DISTINCT cannot be converted to the builder.',
    );
  }
  if (query.prewhere || query.qualify || query.window || query.limit_by) {
    throw new SqlToBuilderError(
      'PREWHERE, QUALIFY, WINDOW, and LIMIT BY clauses are not supported by the builder.',
    );
  }
  if ((query.with ?? []).length > 0) {
    throw new SqlToBuilderError('CTEs cannot be converted to the builder.');
  }

  // FROM must be a single table (the source table macro or a plain table);
  // joins / subqueries can't be expressed in the builder.
  const fromChildren = query.from?.children ?? [];
  if (fromChildren.length !== 1) {
    throw new SqlToBuilderError(
      'Only queries selecting from a single source table can be converted to the builder.',
    );
  }
  const tableExpr = fromChildren[0].table_expression;
  if (!tableExpr || !tableExpr.database_and_table_name) {
    throw new SqlToBuilderError(
      'Subqueries and table functions in FROM are not supported by the builder.',
    );
  }

  const table = tableExpr.database_and_table_name;
  if (table.alias) {
    throw new SqlToBuilderError(
      'Source table aliases cannot be converted to the builder.',
    );
  }
  if (!source?.databaseName || !source.tableName) {
    throw new SqlToBuilderError(
      'Select a builder source before converting SQL to the builder.',
    );
  }
  if (typeof table.name !== 'string') {
    throw new SqlToBuilderError(
      'Parameterized source table names cannot be converted to the builder.',
    );
  }

  const isSourceTableMacro =
    table.database == null && macroName(table.name) === SOURCE_TABLE_MACRO_NAME;
  const isMatchingLiteralTable =
    table.name === source.tableName &&
    (table.database == null || table.database === source.databaseName);
  if (!isSourceTableMacro && !isMatchingLiteralTable) {
    const parsedSource = table.database
      ? `${table.database}.${table.name}`
      : table.name;
    throw new SqlToBuilderError(
      `The SQL source (${parsedSource}) does not match the builder source (${source.databaseName}.${source.tableName}).`,
    );
  }

  return query;
}

/**
 * Resolves a GROUP BY reference to the SELECT expression it points at: a
 * positional reference (`GROUP BY 1`) to the 1-based SELECT item, and an alias
 * reference (`GROUP BY svc` for `... AS svc`) to the aliased item. Anything else
 * passes through unchanged.
 */
function resolveGroupByReference(
  item: Expression,
  query: SelectQueryNode,
): Expression {
  // Positional reference: a 1-based integer literal → that SELECT item.
  if (item.type === 'Literal') {
    const pos = Number(item.value);
    if (Number.isInteger(pos) && pos >= 1 && pos <= query.select.length) {
      return query.select[pos - 1];
    }
  }
  // Alias reference: an identifier matching a SELECT item's alias.
  if (isIdentifier(item)) {
    const aliased = query.select.find(
      s => 'alias' in s && s.alias === item.name,
    );
    if (aliased) return aliased;
  }
  return item;
}

/**
 * Splits GROUP BY into plain grouping columns and detects the builder's time
 * bucket. Positional/alias references are first resolved to their SELECT
 * expressions. Grouping sets / ROLLUP wrap columns in an ExpressionList; the
 * builder has no representation for those, so only plain group-by expressions
 * are kept.
 */
function parseGroupBy(
  query: SelectQueryNode,
  bucketAliases: Set<string>,
): {
  groupByColumns: Expression[];
  hasTimeBucket: boolean;
} {
  const groupByItems = (query.group_by ?? [])
    .filter((item): item is Expression => !isExpressionList(item))
    .map(item => resolveGroupByReference(item, query));
  const hasTimeBucket =
    query.select.some(isTimeBucket) ||
    groupByItems.some(item => isTimeBucketOrAlias(item, bucketAliases));
  const groupByColumns = groupByItems.filter(
    item => !isTimeBucketOrAlias(item, bucketAliases),
  );
  return { groupByColumns, hasTimeBucket };
}

/**
 * Finds the granularity of the query's time bucket (searching SELECT then
 * GROUP BY, resolving positional/alias GROUP BY references), defaulting to
 * `'auto'` when a bucket exists but its granularity can't be pinned down.
 * Returns `undefined` when there is no time bucket.
 */
function detectTimeBucket(query: SelectQueryNode): TimeBucket | undefined {
  for (const item of query.select) {
    const bucket = parseTimeBucket(item);
    if (bucket != null) return bucket;
  }
  for (const item of query.group_by ?? []) {
    if (isExpressionList(item)) continue;
    const bucket = parseTimeBucket(resolveGroupByReference(item, query));
    if (bucket != null) return bucket;
  }
  return undefined;
}

/**
 * Maps the SELECT list to builder series columns, dropping the time bucket and
 * any columns repeated from GROUP BY. Ratio charts render as
 * `divide(seriesA, seriesB)` and yield the two arguments as separate series.
 */
function parseSelect(
  query: SelectQueryNode,
  groupByColumns: Expression[],
): { select: DerivedColumn[]; seriesReturnType?: 'ratio' } {
  const groupByStrings = new Set(groupByColumns.map(toSqlWithoutAlias));

  const seriesNodes: Expression[] = [];
  for (const item of query.select) {
    if (isTimeBucket(item)) continue;
    if (groupByStrings.has(toSqlWithoutAlias(item))) continue;
    seriesNodes.push(item);
  }

  if (seriesNodes.length === 0) {
    throw new SqlToBuilderError(
      'No selectable columns were found in the query.',
    );
  }

  if (
    seriesNodes.length === 1 &&
    isFunction(seriesNodes[0]) &&
    seriesNodes[0].name.toLowerCase() === 'divide' &&
    seriesNodes[0].arguments.length === 2
  ) {
    const legs = seriesNodes[0].arguments.map(parseSeriesColumn);
    // Only a `divide` of two aggregations is a builder ratio; a division of raw
    // columns has no ratio representation, so fall through to a single raw
    // column carrying the whole `divide(...)` expression.
    if (legs.every(leg => leg.aggFn != null && leg.aggFn !== 'none')) {
      return { seriesReturnType: 'ratio', select: legs };
    }
  }
  return { select: seriesNodes.map(parseSeriesColumn) };
}

/**
 * Extracts the user-authored WHERE from the query's conjuncts.
 *
 * The builder emits the WHERE clause as ` AND `-joined pieces: the time filter,
 * the top-level `where`, the per-series aggCondition OR-group (only when every
 * series has one; see `renderWhere`), the `$__filters` placeholder, and the
 * series-limit predicate. This strips the macro-derived and builder-internal
 * pieces so only a genuine user WHERE remains.
 *
 * The aggregation display types this converter handles have no top-level WHERE
 * input — only per-series conditions. When every series is an aggregation the
 * surviving WHERE is broadcast into each series' `aggCondition` (mutating
 * `select`, AND-ed with any existing `...If` condition) so it stays visible and
 * editable in the builder, and `''` is returned. Otherwise — e.g. a raw
 * (`none`) column that can't carry a condition — it is returned as the
 * top-level `where` string (still applied at render, just not shown in the UI).
 */
function parseWhere(
  query: SelectQueryNode,
  select: DerivedColumn[],
  timestampValueExpression: string | undefined,
): string {
  const aggConditions = select.map(c => c.aggCondition ?? '');
  const everySeriesHasAggCondition =
    select.length > 0 && aggConditions.every(c => c.trim() !== '');
  const aggConditionSet = new Set(
    aggConditions.filter(c => c.trim() !== '').map(c => c.trim()),
  );

  const whereConjuncts = query.where ? flattenAnd(query.where) : [];
  const timeRangeConjuncts = canonicalTimeRangeConjuncts(
    whereConjuncts,
    timestampValueExpression,
  );
  const userWhere = whereConjuncts.filter((conjunct, index) => {
    if (timeRangeConjuncts.has(index)) return false;
    if (subtreeReferencesMacro(conjunct, name => name === FILTERS_MACRO_NAME)) {
      return false;
    }
    // The aggCondition OR-group (`(cond1 OR cond2 …)`) the builder adds as an
    // index hint duplicates the per-series conditions, so drop it rather than
    // surface it as an extra WHERE.
    if (everySeriesHasAggCondition) {
      const disjuncts = flattenOr(conjunct).map(toSql);
      if (
        disjuncts.length === aggConditionSet.size &&
        disjuncts.every(d => aggConditionSet.has(d))
      ) {
        return false;
      }
    }
    return true;
  });
  const additionalWhere =
    userWhere.length === 0
      ? ''
      : userWhere.length === 1
        ? toSql(userWhere[0])
        : userWhere.map(c => `(${toSql(c)})`).join(' AND ');

  const canBroadcastWhere =
    additionalWhere !== '' &&
    select.length > 0 &&
    select.every(c => c.aggFn != null && c.aggFn !== 'none');

  if (canBroadcastWhere) {
    for (const col of select) {
      col.aggCondition = andConditions(col.aggCondition ?? '', additionalWhere);
    }
    return '';
  }
  return additionalWhere;
}

/** Renders ORDER BY, dropping the implicit time-bucket ordering. */
function parseOrderBy(
  query: SelectQueryNode,
  bucketAliases: Set<string>,
): string | undefined {
  const orderByElements = (query.order_by ?? []).filter(
    (el: OrderByElementNode) =>
      !isTimeBucketOrAlias(el.expression, bucketAliases),
  );
  return orderByElements.length > 0
    ? orderByElements
        .map(el => `${toSqlWithoutAlias(el.expression)} ${el.direction}`)
        .join(', ')
    : undefined;
}

/** Reads a literal LIMIT (and optional OFFSET) into the builder's limit shape.
 *  A non-integer or negative literal is ignored rather than passed through. */
function parseLimit(query: SelectQueryNode): Limit | undefined {
  const limit = literalCount(query.limit);
  if (limit == null) return undefined;
  return { limit, offset: literalCount(query.offset) };
}

/** Reads a non-negative integer from a `Literal` node, or `undefined`. */
function literalCount(node: Expression | undefined): number | undefined {
  if (!node || node.type !== 'Literal') return undefined;
  const n = Number(node.value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Rejects clause combinations the given display type cannot represent. */
function validateDisplayType({
  displayType,
  typeLabel,
  isTimeSeries,
  hasTimeBucket,
  groupByColumns,
  having,
  orderBy,
  select,
  seriesReturnType,
}: {
  displayType: DisplayType;
  typeLabel: string;
  isTimeSeries: boolean;
  hasTimeBucket: boolean;
  groupByColumns: Expression[];
  having: string | undefined;
  orderBy: string | undefined;
  select: DerivedColumn[];
  seriesReturnType: 'ratio' | undefined;
}): void {
  const supportsGroupBy = displayType !== DisplayType.Number;
  const supportsOrderBy =
    displayType === DisplayType.Table ||
    displayType === DisplayType.Bar ||
    displayType === DisplayType.Pie;

  if (hasTimeBucket && !isTimeSeries) {
    throw new SqlToBuilderError(
      `Time bucketing is only supported for Time Series and Bar charts, not ${typeLabel} charts.`,
    );
  }
  if (groupByColumns.length > 0 && !supportsGroupBy) {
    throw new SqlToBuilderError(
      `GROUP BY is not supported for ${typeLabel} charts.`,
    );
  }
  if (having != null && displayType !== DisplayType.Table) {
    throw new SqlToBuilderError(
      `HAVING is only supported for Table charts, not ${typeLabel} charts.`,
    );
  }
  if (orderBy != null && !supportsOrderBy) {
    throw new SqlToBuilderError(
      `ORDER BY is only supported for Table, Bar, and Pie charts, not ${typeLabel} charts.`,
    );
  }
  if (
    (displayType === DisplayType.Pie || displayType === DisplayType.Bar) &&
    select.length > 1
  ) {
    throw new SqlToBuilderError(
      `${typeLabel} charts support only a single series.`,
    );
  }
  if (
    displayType === DisplayType.Number &&
    seriesReturnType !== 'ratio' &&
    select.length > 1
  ) {
    throw new SqlToBuilderError(
      'Number charts support a single series unless ratio mode is used.',
    );
  }
}

/**
 * SQL → Builder conversion.
 *
 * This does not handle every possible SQL query - many cannot be represented as
 * a builder chart config, and some (metrics!) are exceedingly complicated to
 * convert, so this is a best-effort conversion that will return a user-facing
 * error if the SQL cannot be converted.
 *
 * Macros are dynamic template tokens (`$__fromTime_ms`, `$__timeInterval(col)`, etc)
 * that are not valid ClickHouse SQL, so they are first swapped for parseable sentinels
 * (`hdx_macro_<name>`), parsed, and then recognized in the AST when building the config.
 */
export function convertRawSqlToBuilderConfig({
  sqlTemplate,
  displayType,
  from,
  timestampValueExpression,
}: {
  sqlTemplate: string;
  displayType: DisplayType;
  from?: BuilderSource;
  timestampValueExpression?: string;
}): SqlToBuilderResult {
  // eslint-disable-next-line security/detect-object-injection
  const typeLabel = DISPLAY_TYPE_LABELS[displayType] ?? 'this';

  const query = parseSelectQuery(sqlTemplate, from);

  const bucketAliases = timeBucketAliases(query);
  const { groupByColumns, hasTimeBucket } = parseGroupBy(query, bucketAliases);
  const timeBucket = detectTimeBucket(query);
  if (timeBucket != null) {
    validateTimeBucketTimestamp(timeBucket, timestampValueExpression);
  }
  const { select, seriesReturnType } = parseSelect(query, groupByColumns);
  // parseWhere may broadcast the WHERE into each series' aggCondition (mutating
  // `select`), so it must run after the series columns are built.
  const where = parseWhere(query, select, timestampValueExpression);
  const orderBy = parseOrderBy(query, bucketAliases);
  const having = query.having ? toSql(query.having) : undefined;
  const limit = parseLimit(query);
  const granularity = hasTimeBucket ? timeBucket?.granularity : undefined;

  const isTimeSeries =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;

  validateDisplayType({
    displayType,
    typeLabel,
    isTimeSeries,
    hasTimeBucket,
    groupByColumns,
    having,
    orderBy,
    select,
    seriesReturnType,
  });

  const groupBy = groupByColumns.map(toSqlWithoutAlias).join(', ');

  // The builder has no representation for macros. Recognized ones are consumed
  // during conversion; any that survived into an emitted field (a raw column,
  // WHERE, GROUP BY, ORDER BY, HAVING) can't be represented, so fail.
  const leakedMacros = collectLeakedMacros([
    ...select.flatMap(c => [c.valueExpression, c.aggCondition ?? '']),
    where,
    groupBy,
    orderBy ?? '',
    having ?? '',
  ]);
  if (leakedMacros.length > 0) {
    throw new SqlToBuilderError(
      `This query uses macros in locations that cannot be represented in the chart builder: ${leakedMacros.join(', ')}.`,
    );
  }

  // A recognized time bucket on a non-time-series chart is already rejected
  // above; this catches an interval query parameter that survived into a raw
  // column, WHERE, etc. (it only binds on time-series charts).
  if (
    !isTimeSeries &&
    subtreeReferencesQueryParam(query, name => INTERVAL_QUERY_PARAMS.has(name))
  ) {
    throw new SqlToBuilderError(
      `The interval query parameter ({intervalSeconds}/{intervalMilliseconds}) only resolves on Time Series charts, not ${typeLabel} charts.`,
    );
  }

  return {
    select,
    ...(seriesReturnType ? { seriesReturnType } : {}),
    where,
    whereLanguage: 'sql',
    groupBy,
    ...(granularity != null && isTimeSeries ? { granularity } : {}),
    ...(having != null ? { having, havingLanguage: 'sql' as const } : {}),
    ...(orderBy != null ? { orderBy } : {}),
    ...(limit != null ? { limit } : {}),
  };
}
