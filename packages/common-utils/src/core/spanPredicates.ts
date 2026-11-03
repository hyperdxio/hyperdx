/**
 * The single definition of an errored span, as a SQL predicate over a span
 * status-code expression. Matches both the short OTel status ('Error'/'ERROR')
 * and the legacy collector form ('STATUS_CODE_ERROR'), which some collectors
 * write instead.
 *
 * Span status only. Log severity text is a different vocabulary (its error
 * values are 'fatal', 'crit' and friends, never 'status_code_error'), so log
 * callers keep their own predicate rather than reusing this one.
 */
export function errorStatusPredicateSql(statusCodeExpression: string): string {
  return `lower(${statusCodeExpression}) IN ('error', 'status_code_error')`;
}

/** Server (request entry-point) spans, in both short and legacy enum forms. */
export function serverSpanKindPredicateSql(spanKindExpression: string): string {
  return `${spanKindExpression} IN ('Server', 'SPAN_KIND_SERVER')`;
}
