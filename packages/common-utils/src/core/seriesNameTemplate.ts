import { compileLenient } from '@/core/handlebarsEnv';

export interface SeriesNameInput {
  /** Full Prometheus label set for the series, including __name__. */
  labels: Record<string, string>;
  /** Default name used when the template errors or renders blank. */
  fallback: string;
  /** Handlebars template for this series' name, if it has one. */
  template?: string;
  /**
   * Prepended verbatim to the name, separator included. Carries the alias of
   * the expression the series came from, so series from different expressions
   * stay distinguishable.
   */
  prefix?: string;
}

/**
 * Render one series' legend name from a Handlebars template and its
 * Prometheus label set. Never throws: compile/runtime errors and
 * blank output fall back to `fallback`.
 */
export function renderSeriesNameTemplate(
  template: string,
  labels: Record<string, string>,
  fallback: string,
): string {
  try {
    const rendered = compileLenient(template)(labels).trim();
    return rendered || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Render legend names for a whole result set, spanning every expression a
 * chart plots so names are unique chart-wide. Series whose rendered names
 * collide are disambiguated by appending their default name, then by a
 * counter for the names that are still duplicated — downstream chart
 * formatting keys rows by series name and would silently merge same-named
 * series.
 */
export function renderSeriesNames(series: SeriesNameInput[]): string[] {
  const rendered = series.map(s => {
    const prefix = s.prefix ?? '';
    const name = s.template
      ? renderSeriesNameTemplate(s.template, s.labels, s.fallback)
      : s.fallback;
    return { name: `${prefix}${name}`, qualified: `${prefix}${s.fallback}` };
  });

  const count = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  };

  const collisions = count(rendered.map(r => r.name));
  // A name that already *is* the series' qualified default gains nothing from
  // the suffix, so it keeps the shorter form and the numbering pass below
  // separates it if that still leaves a duplicate.
  const qualified = rendered.map(({ name, qualified }) =>
    (collisions.get(name) ?? 0) > 1 && name !== qualified
      ? `${name} (${qualified})`
      : name,
  );

  // Two copies of the same expression under the same alias render identical
  // names that the qualifier above cannot separate, so number them.
  const remaining = count(qualified);
  const seen = new Map<string, number>();
  return qualified.map(name => {
    if ((remaining.get(name) ?? 0) < 2) return name;
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    return nth === 1 ? name : `${name} (${nth})`;
  });
}
