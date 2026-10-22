/**
 * OpenTelemetry log severity classes (uppercase, as in the spec), from the
 * SeverityNumber with a severity text fallback. Parsing mirrors ClickHouse
 * `accurateCastOrNull(n, 'UInt8')` and `lower()` so SQL built from these
 * tables classifies rows the same way.
 * https://github.com/open-telemetry/opentelemetry-specification/blob/v1.61.0/specification/logs/data-model.md#field-severitynumber
 */

export const SEVERITY_CLASSES = [
  'FATAL',
  'ERROR',
  'WARN',
  'INFO',
  'DEBUG',
  'TRACE',
  'UNKNOWN',
] as const;

export type SeverityClass = (typeof SEVERITY_CLASSES)[number];

export const SEVERITY_CLASS_ERROR_VALUES: readonly SeverityClass[] = [
  'FATAL',
  'ERROR',
];

// Must stay contiguous and four wide: getNumberRange indexes by (n - 1) / 4.
export const NUMBER_RANGES: readonly {
  min: number;
  max: number;
  severityClass: SeverityClass;
}[] = [
  { min: 1, max: 4, severityClass: 'TRACE' },
  { min: 5, max: 8, severityClass: 'DEBUG' },
  { min: 9, max: 12, severityClass: 'INFO' },
  { min: 13, max: 16, severityClass: 'WARN' },
  { min: 17, max: 20, severityClass: 'ERROR' },
  { min: 21, max: 24, severityClass: 'FATAL' },
];

// Takes a number already parsed to 1-24.
function getNumberRange(number: number) {
  return NUMBER_RANGES[Math.floor((number - 1) / 4)];
}

/**
 * The spec's short name of a SeverityNumber in 1-24: the first number of each
 * range takes the class name and the rest add their position (9 INFO, 10 INFO2).
 */
export function getSeverityShortName(
  severityNumber: unknown,
): string | undefined {
  const number = parseSeverityNumber(severityNumber);
  if (number == null) return undefined;

  const range = getNumberRange(number);
  const position = number - range.min + 1;

  return position === 1
    ? range.severityClass
    : `${range.severityClass}${position}`;
}

// Matched against the start of the lowercased text. No prefix starts another
// prefix of a different class, so rule order never changes the result.
export const TEXT_PREFIX_RULES: readonly {
  prefix: string;
  severityClass: SeverityClass;
}[] = [
  { prefix: 'fatal', severityClass: 'FATAL' },
  { prefix: 'emerg', severityClass: 'FATAL' },
  { prefix: 'panic', severityClass: 'FATAL' },
  { prefix: 'dpanic', severityClass: 'FATAL' },
  { prefix: 'ftl', severityClass: 'FATAL' },
  { prefix: 'err', severityClass: 'ERROR' },
  { prefix: 'crit', severityClass: 'ERROR' },
  { prefix: 'alert', severityClass: 'ERROR' },
  { prefix: 'severe', severityClass: 'ERROR' },
  { prefix: 'warn', severityClass: 'WARN' },
  { prefix: 'wrn', severityClass: 'WARN' },
  { prefix: 'info', severityClass: 'INFO' },
  { prefix: 'inf', severityClass: 'INFO' },
  { prefix: 'notice', severityClass: 'INFO' },
  { prefix: 'ok', severityClass: 'INFO' },
  { prefix: 'unset', severityClass: 'INFO' },
  { prefix: 'debug', severityClass: 'DEBUG' },
  { prefix: 'dbg', severityClass: 'DEBUG' },
  { prefix: 'trace', severityClass: 'TRACE' },
  { prefix: 'trc', severityClass: 'TRACE' },
  { prefix: 'verbose', severityClass: 'TRACE' },
];

/**
 * The SeverityNumber as an integer in 1-24, or undefined. ClickHouse quotes
 * 64-bit integers in JSON, so digit strings count too; they are not trimmed
 * because accurateCastOrNull rejects surrounding spaces.
 */
export function parseSeverityNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\+?\d+$/.test(value)
        ? Number(value)
        : undefined;

  return number != null &&
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 24
    ? number
    : undefined;
}

// ClickHouse lower() only folds ASCII.
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]/g, c => c.toLowerCase());
}

/**
 * The severity class of a log row. A SeverityNumber in 1-24 wins because the
 * SDK normalizes it; anything else (0 means unspecified) falls back to a
 * case-insensitive prefix match on the text.
 */
export function getSeverityClass({
  severityNumber,
  severityText,
}: {
  severityNumber?: unknown;
  severityText?: string | null;
}): SeverityClass {
  const number = parseSeverityNumber(severityNumber);
  if (number != null) return getNumberRange(number).severityClass;

  const text = lowerAscii(severityText ?? '');

  return (
    TEXT_PREFIX_RULES.find(r => text.startsWith(r.prefix))?.severityClass ??
    'UNKNOWN'
  );
}

/**
 * The level label of a log row. A valid SeverityNumber shows its short name,
 * followed by the stored text when that says something else, e.g.
 * "INFO (Informational)". Without one the stored text shows as is, so rows from
 * SDKs that leave the number at 0 look as they always have.
 */
export function getSeverityLabel({
  severityNumber,
  severityText,
}: {
  severityNumber?: unknown;
  severityText?: string | null;
}): string | undefined {
  const shortName = getSeverityShortName(severityNumber);
  if (shortName == null) return severityText || undefined;

  return severityText && lowerAscii(severityText) !== lowerAscii(shortName)
    ? `${shortName} (${severityText})`
    : shortName;
}

/** The error or warn level of a class, or undefined when it is neither. */
export function collapseSeverityClass(
  severityClass: SeverityClass,
): 'error' | 'warn' | undefined {
  if (SEVERITY_CLASS_ERROR_VALUES.includes(severityClass)) return 'error';

  return severityClass === 'WARN' ? 'warn' : undefined;
}
