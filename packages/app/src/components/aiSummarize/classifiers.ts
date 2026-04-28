// Shared classifiers for AI summarize context building.
//
// Severity fields are user-provided and often noisy:
// - Some logs are marked `error` but are harmless (noise).
// - Some real errors have missing or lower severity (ingest misconfiguration).
// We classify based on multiple signals and fall back to the body as last resort.
//
// These classifiers are used only to DECIDE what to include in the trace context
// we send to the LLM (which spans to flag as errors, how to prioritize). The raw
// severity and body always go to the model in the prompt content — so the model
// can reach its own conclusion when our classification is wrong.

export interface ClassifierSignals {
  severity?: string;
  statusCode?: string | number;
  httpStatus?: string | number;
  exceptionType?: string;
  exceptionMessage?: string;
  body?: string;
}

const ERROR_SEVERITIES = new Set([
  'error',
  'err',
  'fatal',
  'critical',
  'crit',
  'emerg',
  'emergency',
  'alert',
]);

const WARN_SEVERITIES = new Set(['warn', 'warning']);

// OTel encodes StatusCode as enum name, numeric value, or mixed case across SDKs.
const ERROR_STATUS_CODES = new Set([
  'Error',
  'STATUS_CODE_ERROR',
  'error',
  '2',
]);

// Conservative body regex — matches standalone error vocabulary only, not
// words like "errorless" or "failed-over". Avoids grepping attribute values.
const ERROR_BODY_RE =
  /\b(error|exception|panic|fatal|traceback|stack ?trace|failed with|failure:|uncaught|unhandled)\b/i;

function asNumber(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function isErrorEvent(s: ClassifierSignals): boolean {
  // High-confidence signals first
  if (s.exceptionType || s.exceptionMessage) return true;

  if (typeof s.statusCode === 'string' && ERROR_STATUS_CODES.has(s.statusCode))
    return true;
  if (s.statusCode === 2) return true;

  const http = asNumber(s.httpStatus);
  if (http != null && http >= 500) return true;

  const sev = s.severity?.toLowerCase().trim();
  if (sev && ERROR_SEVERITIES.has(sev)) return true;

  // Fallback: body regex for logs with missing/wrong severity
  if (s.body && ERROR_BODY_RE.test(s.body)) return true;

  return false;
}

export function isWarnEvent(s: ClassifierSignals): boolean {
  if (isErrorEvent(s)) return false;

  const sev = s.severity?.toLowerCase().trim();
  if (sev && WARN_SEVERITIES.has(sev)) return true;

  const http = asNumber(s.httpStatus);
  if (http != null && http >= 400 && http < 500) return true;

  return false;
}

// Normalize severity across sources — returns a stable token for LLM prompts
export function normalizeSeverity(s: ClassifierSignals): string | undefined {
  if (isErrorEvent(s)) return 'error';
  if (isWarnEvent(s)) return 'warn';
  const sev = s.severity?.toLowerCase().trim();
  if (sev === 'info' || sev === 'notice' || sev === 'information')
    return 'info';
  if (sev === 'debug' || sev === 'trace') return 'debug';
  return sev;
}
