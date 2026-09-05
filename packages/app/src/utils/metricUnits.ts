/** Shown in the unit column when a metric declares no meaningful unit. */
export const NO_UNIT = '—';

/**
 * Compact unit label for a narrow column.
 *
 * Keeps the UCUM code itself (`By`, `ms`, `%`) rather than expanding it, since
 * the column is a few characters wide; the metric's detail pane spells the unit
 * out in full via `formatUnitDisplay`. Two adjustments make UCUM readable:
 * annotation braces are stripped (`{request}` → `request`), and the
 * dimensionless unit `1` is rendered as "no unit" because "1" reads as a value.
 */
export function metricUnitShort(unit: string | undefined): string {
  const trimmed = unit?.trim();
  if (!trimmed || trimmed === '1') return NO_UNIT;

  // A pure annotation carries the meaning; braces are UCUM syntax, not content.
  const annotationOnly = /^\{(.+)\}$/.exec(trimmed);
  if (annotationOnly) return annotationOnly[1];

  // Compound units keep their operator: `{request}/s` → `request/s`.
  return trimmed.replace(/\{([^}]*)\}/g, '$1');
}
