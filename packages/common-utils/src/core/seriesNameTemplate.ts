import { compileLenient } from '@/core/handlebarsEnv';

/** Separator between the parts of a series key or legend name. */
export const SERIES_KEY_JOINER = ' · ';

/** One series of a Prometheus matrix result: its label set is its identity. */
export type LabelledSeries = { metric: Record<string, string> };

/** One expression of a PromQL chart, with the series it returned. */
export type PromqlExpressionResult = {
  /** The expression queried, the last resort for naming its series. */
  expression: string;
  /** The name the user gave the expression, if any. */
  alias?: string;
  result: LabelledSeries[];
};

interface SeriesNameInput {
  /** Full Prometheus label set for the series, including __name__. */
  labels: Record<string, string>;
  /** Default name used when the template errors or renders blank. */
  fallback: string;
  /** Alias of the expression the series came from, if it has one. */
  prefix?: string;
}

/**
 * Render a series' name from a Handlebars template and its Prometheus label
 * set, or '' when the template resolves to nothing. Never throws.
 */
function renderTemplate(
  template: string,
  labels: Record<string, string>,
): string {
  try {
    return compileLenient(template)(labels).trim();
  } catch {
    return '';
  }
}

const join = (prefix: string, name: string) =>
  prefix && name ? `${prefix}${SERIES_KEY_JOINER}${name}` : prefix || name;

/**
 * Rename every item whose `name` occurs more than once, calling `rename` on
 * the duplicates in order.
 */
function dedupe<T extends { name: string }>(
  items: T[],
  rename: (item: T) => string,
): T[] {
  const counts = new Map<string, number>();
  for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
  return items.map(item =>
    (counts.get(item.name) ?? 0) > 1 ? { ...item, name: rename(item) } : item,
  );
}

/**
 * Render legend names for a whole result set, spanning every expression a
 * chart plots so names are unique chart-wide. An alias that identifies a
 * single series stands alone; the rest are named after their labels behind
 * their alias. Series whose rendered names collide are disambiguated by
 * appending their default name, then by a counter for the names that are
 * still duplicated — downstream chart formatting keys rows by series name and
 * would silently merge same-named series.
 */
function renderSeriesNames(
  series: SeriesNameInput[],
  template?: string,
): string[] {
  const candidates = series.map(({ labels, fallback, prefix = '' }) => {
    const templated = template ? renderTemplate(template, labels) : '';
    const qualified = join(prefix, fallback);
    const full = templated ? join(prefix, templated) : qualified;
    return {
      // An alias names one series as well as its label set does, so it stands
      // alone. A template that rendered something is an explicit request for a
      // name and is always shown; one that resolved to nothing leaves the
      // alias as the only name asked for.
      name: prefix && !templated ? prefix : full,
      full,
      qualified,
    };
  });

  // Only an alias covering several series needs the label set behind it.
  const aliased = dedupe(candidates, c => c.full);

  // A name that already *is* the series' qualified default gains nothing from
  // the suffix, so it keeps the shorter form and the numbering pass below
  // separates it if that still leaves a duplicate.
  const disambiguated = dedupe(aliased, c =>
    c.name === c.qualified ? c.name : `${c.name} (${c.qualified})`,
  );

  // Two copies of the same expression under the same alias render identical
  // names that the qualifier above cannot separate, so number them.
  const seen = new Map<string, number>();
  return dedupe(disambiguated, ({ name }) => {
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    return nth === 1 ? name : `${name} (${nth})`;
  }).map(c => c.name);
}

/** The labels whose values differ across the series given */
function getDistinguishingLabels(series: LabelledSeries[]): Set<string> {
  const labelValues = new Map<string, Set<string>>();
  for (const { metric } of series) {
    for (const [key, value] of Object.entries(metric)) {
      if (key === '__name__') continue;
      if (!labelValues.has(key)) labelValues.set(key, new Set());
      labelValues.get(key)!.add(value);
    }
  }
  return new Set(
    [...labelValues]
      .filter(([, values]) => values.size > 1)
      .map(([key]) => key),
  );
}

/** Default names for one expression's series. */
function promqlSeriesNameInputs(
  result: LabelledSeries[],
  expression: string,
  distinguishing: Set<string>,
): Pick<SeriesNameInput, 'labels' | 'fallback'>[] {
  return result.map(series => {
    const metricName = series.metric.__name__ ?? '';
    const labels = Object.entries(series.metric)
      .filter(([key]) => distinguishing.has(key))
      .map(([key, value]) => `${key}="${value}"`)
      .join(', ');
    return {
      labels: series.metric,
      // Prometheus drops __name__ from every aggregation or arithmetic result,
      // so a single-series `sum(rate(x[5m]))` has neither a name nor a
      // distinguishing label to be named after — fall back to expression.
      fallback: labels ? `${metricName}{${labels}}` : metricName || expression,
    };
  });
}

/**
 * Legend names for every series a PromQL chart plots, grouped by expression
 * so each name stays paired with the series it belongs to. Named in one pass
 * across all the expressions, so names are unique chart-wide.
 */
export function renderPromqlSeriesNames(
  expressions: PromqlExpressionResult[],
  template?: string,
): string[][] {
  const distinguishing = getDistinguishingLabels(
    expressions.flatMap(({ result }) => result),
  );
  const names = renderSeriesNames(
    expressions.flatMap(({ result, expression, alias }) =>
      promqlSeriesNameInputs(result, expression, distinguishing).map(input => ({
        ...input,
        prefix: alias?.trim() || undefined,
      })),
    ),
    template,
  );

  const remaining = [...names];
  return expressions.map(({ result }) => remaining.splice(0, result.length));
}
