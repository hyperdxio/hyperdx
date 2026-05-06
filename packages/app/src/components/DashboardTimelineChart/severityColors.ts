/**
 * Shared severity → color mapping used by both the timeline renderer
 * (to color individual event markers based on the `severity` column) and
 * the builder editor (to preview lane colors before the query runs).
 *
 * Severity strings are folded to upper-case before lookup, matching the
 * conventions used by HyperDX log/trace ingest pipelines.
 */
export const SEVERITY_COLORS: Record<string, string> = {
  FATAL: '#e53e3e',
  ERROR: '#e53e3e',
  WARN: '#dd6b20',
  WARNING: '#dd6b20',
  INFO: '#3182ce',
  DEBUG: '#718096',
  TRACE: '#a0aec0',
};

/**
 * Resolve a severity string to a color, returning undefined when the value
 * does not match a known severity (so callers can fall back to a lane color).
 */
export function resolveSeverityColor(
  severity: string | undefined | null,
): string | undefined {
  if (!severity) return undefined;
  return SEVERITY_COLORS[severity.toUpperCase()];
}
