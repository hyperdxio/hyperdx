import { compileLenient } from '@/core/handlebarsEnv';

export interface SeriesNameInput {
  /** Full Prometheus label set for the series, including __name__. */
  labels: Record<string, string>;
  /** Unique, default name used when the template errors, renders blank, or collides. */
  fallback: string;
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
 * Render legend names for a whole result set. Series whose rendered names
 * collide are disambiguated by appending their (unique) fallback name, since
 * downstream chart formatting keys rows by series name and would silently
 * merge same-named series.
 */
export function renderSeriesNames(
  template: string,
  series: SeriesNameInput[],
): string[] {
  const rendered = series.map(s =>
    renderSeriesNameTemplate(template, s.labels, s.fallback),
  );
  const counts = new Map<string, number>();
  for (const name of rendered) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return rendered.map((name, i) =>
    (counts.get(name) ?? 0) > 1 ? `${name} (${series.at(i)?.fallback})` : name,
  );
}
