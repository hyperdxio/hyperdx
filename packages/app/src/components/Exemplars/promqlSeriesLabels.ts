/**
 * Working out which labels distinguish the *plotted* lines of a PromQL query.
 *
 * Prometheus resolves `/query_exemplars` against the raw selector, so it returns
 * one entry per underlying series while the chart draws the aggregated result.
 * The canonical latency query
 * `histogram_quantile(0.95, sum(rate(x_bucket[5m])) by (le))` draws a single line
 * but comes back split across every scrape target *and* every `le` bucket. An
 * exemplar overlay that decides "is this one series?" from the raw label
 * cardinality therefore sees N series and drops itself on any metric scraped from
 * more than one pod — i.e. on essentially every real deployment.
 *
 * Extracted from useExemplars so this rule has its own tests: the failure it
 * guards against is silent (an empty overlay, or worse, markers attributed to the
 * wrong line), so its edge cases need to be pinned rather than eyeballed.
 *
 * This is a regex approximation, not a PromQL parse. That is a deliberate
 * trade-off, and the direction of the approximation is what matters: when the
 * expression is anything this cannot read confidently, it reports `all` — every
 * label distinguishes a line — which OVER-counts series and so drops the overlay.
 * Dropping a legitimate overlay is a visible absence; rendering markers against
 * the wrong line is a silent lie. Always fail towards `all`.
 */

/**
 * How to decide whether two raw series belong to the same plotted line.
 *
 * - `all`   — no usable aggregation info; every label counts (conservative).
 * - `keep`  — only `labels` count (from a `by (...)` clause).
 * - `drop`  — every label except `labels` counts (from a `without (...)` clause).
 */
export type SeriesLabelRule =
  | { mode: 'all' }
  | { mode: 'keep'; labels: Set<string> }
  | { mode: 'drop'; labels: Set<string> };

const ALL: SeriesLabelRule = { mode: 'all' };

// `by (a, b)` / `by(a,b)` and the `without` equivalent. PromQL allows the clause
// either before or after the argument list (`sum by (le) (x)` and
// `sum(x) by (le)`), and both spellings match here since we only need the label
// list, not the position.
const BY_CLAUSE = /\bby\s*\(([^)]*)\)/g;
const WITHOUT_CLAUSE = /\bwithout\s*\(([^)]*)\)/g;

// A top-level arithmetic or comparison operator means the plotted value is a
// derived quantity, and the aggregation clauses we can see may belong to either
// operand. Bail to `all` rather than guess which side governs the result.
const BINARY_OPERATOR = /[-+*/%]|==|!=|>=|<=|>|<|\b(and|or|unless)\b/;

const parseLabelList = (clause: string) =>
  clause
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const sameLabels = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every(l => b.has(l));

/** A bare PromQL label name. Anything else in a `by`/`without` list is not one. */
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Strip string literals and comments so their contents cannot be read as syntax —
 * e.g. `{job="sum by (le)"}` or `{path="/a+b"}`. Replaced with `""` rather than
 * removed so adjacent tokens do not run together.
 *
 * Backticks are PromQL raw strings and `#` starts a comment; both were missed
 * before, which let either hide a clause or an operator from the checks below.
 */
function stripStringLiterals(expression: string): string {
  // Strings first, comments second. A `#` is only a comment OUTSIDE a string, so
  // stripping comments first truncates at a `#` inside a label value (a URL
  // fragment, say) and eats the rest of the expression — including any `by (...)`
  // clause, which silently suppresses the overlay.
  return expression
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/#[^\n]*/g, '');
}

/**
 * Derive the series-identity rule for `expression`.
 *
 * Handles the two shapes that actually occur on latency charts:
 * - one or more `by (...)` clauses -> `keep` their intersection (a label must
 *   survive every aggregation to still distinguish a line).
 * - a `without (...)` clause and no `by` -> `drop` those labels. Without this,
 *   `sum without (instance) (...)` — the same query the `by (le)` form expresses
 *   — would fall through to `all` and empty the overlay, which is exactly the bug
 *   this module exists to fix.
 *
 * Anything ambiguous reports `all`:
 * - both `by` and `without` present (they may govern different aggregations, and
 *   subtracting one from the other can shrink the identity to nothing and merge
 *   genuinely distinct lines — a fail-open we refuse).
 * - several `by` clauses with differing label sets, or several `without` clauses.
 * - a top-level binary operator.
 */
export function promqlSeriesLabelRule(
  expression: string | undefined,
): SeriesLabelRule {
  if (!expression) return ALL;
  const src = stripStringLiterals(expression);

  const byClauses = [...src.matchAll(BY_CLAUSE)].map(m => parseLabelList(m[1]));
  const withoutClauses = [...src.matchAll(WITHOUT_CLAUSE)].map(m =>
    parseLabelList(m[1]),
  );

  // Mixed forms are not reconcilable without knowing which aggregation each
  // clause belongs to.
  if (byClauses.length > 0 && withoutClauses.length > 0) return ALL;

  // Remove everything that can legitimately contain an operator character before
  // testing for a top-level operator. Label matchers matter most: `!=` and `=~`
  // are ordinary matcher syntax, so leaving `{code!="200"}` in would read as a
  // comparison and suppress the overlay on a query that does aggregate to one
  // line.
  const operatorCandidate = src
    .replace(BY_CLAUSE, '')
    .replace(WITHOUT_CLAUSE, '')
    .replace(/\{[^}]*\}/g, '') // label matchers: {code!="200"}
    .replace(/\[[^\]]*\]/g, ''); // range selectors: [5m], [1h:5m]
  if (BINARY_OPERATOR.test(operatorCandidate)) return ALL;

  // A clause entry that is not a bare label name means we misread the expression
  // (a quoted name, say, which stripStringLiterals has already rewritten to `""`).
  // Keeping it would build a key that matches no real label, collapsing every raw
  // series into one group and slipping past the multiple-series guard — the exact
  // fail-open this module promises not to have.
  const allBare = [...byClauses, ...withoutClauses]
    .flat()
    .every(l => LABEL_NAME.test(l));
  if (!allBare) return ALL;

  if (byClauses.length > 0) {
    const sets = byClauses.map(l => new Set(l));
    // Differing `by` sets mean nested aggregations we are not confident reading.
    if (!sets.every(s => sameLabels(s, sets[0]))) return ALL;
    return { mode: 'keep', labels: sets[0] };
  }

  if (withoutClauses.length === 1) {
    return { mode: 'drop', labels: new Set(withoutClauses[0]) };
  }

  return ALL;
}

/** Whether `label` distinguishes one plotted line from another under `rule`. */
export function labelDistinguishesSeries(
  rule: SeriesLabelRule,
  label: string,
): boolean {
  switch (rule.mode) {
    case 'keep':
      return rule.labels.has(label);
    case 'drop':
      return !rule.labels.has(label);
    case 'all':
      return true;
  }
}
