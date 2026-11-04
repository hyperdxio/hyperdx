/**
 * Span status values that mean the span errored, lowercased.
 * Short OTel status ('Error'/'ERROR') and the legacy collector form
 * ('STATUS_CODE_ERROR'). Log severity text is a different vocabulary
 * ('fatal', 'crit', and friends, never 'status_code_error'), so log callers
 * keep their own predicate rather than reusing this list.
 */
const ERROR_STATUS_CODES = ['error', 'status_code_error'] as const;

/**
 * The single definition of an errored span, as a SQL predicate over a span
 * status-code expression.
 */
export function errorStatusPredicateSql(statusCodeExpression: string): string {
  const quoted = ERROR_STATUS_CODES.map(code => `'${code}'`).join(', ');
  return `lower(${statusCodeExpression}) IN (${quoted})`;
}

/** Same match as {@link errorStatusPredicateSql}, for rows already fetched. */
export function isErrorStatusCode(
  statusCode: string | null | undefined,
): boolean {
  if (!statusCode) {
    return false;
  }
  const normalized = statusCode.toLowerCase();
  return ERROR_STATUS_CODES.some(code => code === normalized);
}

/** Server (request entry-point) spans, in both short and legacy enum forms. */
export function serverSpanKindPredicateSql(spanKindExpression: string): string {
  return `${spanKindExpression} IN ('Server', 'SPAN_KIND_SERVER')`;
}
