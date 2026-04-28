// Shared string-coercion helpers used by the subject formatters and the
// trace context builder. Each of these was previously duplicated with
// slight variations — keeping them here keeps the LLM-prompt output
// consistent across subjects.

/**
 * Turn any attribute value into a short string suitable for the LLM prompt.
 * Objects are JSON-stringified (with a try/catch for circular refs).
 * Truncates at `maxLen` with an ellipsis.
 */
export function attrToString(v: unknown, maxLen = 100): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}
