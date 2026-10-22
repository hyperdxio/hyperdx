/**
 * OpenTelemetry log severity classes (uppercase, as in the spec), from the
 * SeverityNumber with a severity text fallback. The class SQL is built from
 * the same tables, and its comparisons are mirrored here.
 * https://github.com/open-telemetry/opentelemetry-specification/blob/v1.61.0/specification/logs/data-model.md#field-severitynumber
 */

export const SEVERITY_CLASSES = [
  'FATAL',
  'ERROR',
  'WARN',
  'INFO',
  'DEBUG',
  'TRACE',
  'OTHER',
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

// Matched against the start of the text, case-insensitively, in this order.
// No prefix starts another prefix of a different class, so the order never
// changes the result.
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
  { prefix: 'inf', severityClass: 'INFO' },
  { prefix: 'notice', severityClass: 'INFO' },
  { prefix: 'debug', severityClass: 'DEBUG' },
  { prefix: 'dbg', severityClass: 'DEBUG' },
  { prefix: 'trace', severityClass: 'TRACE' },
  { prefix: 'trc', severityClass: 'TRACE' },
  { prefix: 'verbose', severityClass: 'TRACE' },
  { prefix: 'vrb', severityClass: 'TRACE' },
];

// Highest first, so the first range whose min a number reaches is its class.
// FATAL has no upper bound, to keep the class SQL to plain comparisons.
const NUMBER_RANGES_DESC = [...NUMBER_RANGES].reverse();

// ClickHouse quotes 64-bit integers in JSON, so digit strings count too.
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\+?\d+$/.test(value)) return Number(value);
  return undefined;
}

/** The SeverityNumber as an integer in 1-24, or undefined. */
export function parseSeverityNumber(value: unknown): number | undefined {
  const number = toNumber(value);

  return number != null &&
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 24
    ? number
    : undefined;
}

// The prefixes and short names are ASCII, so only ASCII needs folding.
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]/g, c => c.toLowerCase());
}

/**
 * The severity class of a log row. A SeverityNumber of 1 or more decides
 * (21 and up is FATAL); anything else (0 means unspecified) falls back to a
 * case-insensitive prefix match on the text.
 */
export function getSeverityClass({
  severityNumber,
  severityText,
}: {
  severityNumber?: unknown;
  severityText?: string | null;
}): SeverityClass {
  const number = toNumber(severityNumber);
  const range =
    number == null ? undefined : NUMBER_RANGES_DESC.find(r => number >= r.min);
  if (range != null) return range.severityClass;

  const text = lowerAscii(severityText ?? '');

  return (
    TEXT_PREFIX_RULES.find(r => text.startsWith(r.prefix))?.severityClass ??
    'OTHER'
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

/** The Severity facet's values, in severity order. */
export const SEVERITY_CLASS_FACET_VALUES: readonly SeverityClass[] = [
  ...NUMBER_RANGES.map(r => r.severityClass),
  'OTHER',
];

const numberBranch = (
  numberExpr: string,
  { min, severityClass }: { min: number; severityClass: SeverityClass },
) => `${numberExpr} >= ${min}, '${severityClass}', `;

const numberBranches = (numberExpr: string) =>
  NUMBER_RANGES_DESC.map(r => numberBranch(numberExpr, r)).join('');

// ILIKE folds a few non-ASCII letters to ASCII (the Kelvin sign to k), but
// none in these prefixes, so here it matches lowerAscii.
const textBranches = (textExpr: string) =>
  TEXT_PREFIX_RULES.map(
    r => `${textExpr} ILIKE '${r.prefix}%', '${r.severityClass}', `,
  ).join('');

const V1_START = 'multiIf(';
const V1_END = "'OTHER')";

/**
 * A ClickHouse String expression that classifies rows like getSeverityClass,
 * used as the key of stored Severity filters (`<key> IN ('ERROR')`). Without a
 * text expression the text branches are left out.
 *
 * V1 is a stored contract: saved searches, alerts and URLs hold the exact
 * string. Change the rules or template only in a V2 builder, keep V1 on a
 * frozen copy of these tables, and keep recognizing V1 keys.
 *
 * The number expression must be numeric: ClickHouse rejects comparing a String
 * column with a number. A Bool (or a JSON/Dynamic value holding true) counts as
 * 1, TRACE, while getSeverityClass ignores booleans and falls back to the text.
 */
export function buildSeverityClassExpressionV1({
  numberExpr,
  textExpr,
}: {
  numberExpr: string;
  textExpr?: string;
}): string {
  return `${V1_START}${numberBranches(numberExpr)}${
    textExpr ? textBranches(textExpr) : ''
  }${V1_END}`;
}

/** Whether a filter key is a V1 severity class expression, for any source. */
export function isSeverityClassKeyV1(key: string): boolean {
  if (!key.startsWith(V1_START) || !key.endsWith(V1_END)) return false;

  // The number expression ends at one of these; try each, and size the text
  // expression from what's left, since every branch repeats it.
  const numberEnd = numberBranch('', NUMBER_RANGES_DESC[0]);
  const textTemplateLength = textBranches('').length;
  for (
    let end = key.indexOf(numberEnd, V1_START.length + 1);
    end !== -1;
    end = key.indexOf(numberEnd, end + 1)
  ) {
    const numberExpr = key.slice(V1_START.length, end);
    const rest = key.slice(
      V1_START.length + numberBranches(numberExpr).length,
      -V1_END.length,
    );
    const textExpr = rest.slice(
      0,
      (rest.length - textTemplateLength) / TEXT_PREFIX_RULES.length,
    );
    if (buildSeverityClassExpressionV1({ numberExpr, textExpr }) === key) {
      return true;
    }
  }
  return false;
}
