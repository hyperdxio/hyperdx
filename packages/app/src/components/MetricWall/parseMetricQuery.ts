import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { METRIC_QUANTITIES, MetricQuantity } from './classifyMetric';

export type MetricQueryToken =
  | { type: 'unit'; value: string }
  | { type: 'has'; key: string }
  | { type: 'attr'; key: string; value: string }
  | { type: 'quantity'; value: MetricQuantity }
  | { type: 'kind'; value: MetricsDataType };

export type ParsedMetricQuery = {
  /** Free text, matched against the metric name and description. */
  text: string;
  tokens: MetricQueryToken[];
};

function isMetricKind(value: string): value is MetricsDataType {
  return (Object.values(MetricsDataType) as string[]).includes(value);
}

function isMetricQuantity(value: string): value is MetricQuantity {
  return (METRIC_QUANTITIES as readonly string[]).includes(value);
}

// Words, `key="quoted value"`, or `"quoted text"`.
const WORD = /(?:[^\s"]+="[^"]*"|"[^"]*"|\S+)/g;

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function parseWord(word: string): MetricQueryToken | undefined {
  const prefixed = /^(unit|has|quantity|kind):(.+)$/.exec(word);
  if (prefixed) {
    const [, prefix, raw] = prefixed;
    const value = unquote(raw);
    if (prefix === 'unit') return { type: 'unit', value };
    if (prefix === 'has') return { type: 'has', key: value };
    if (prefix === 'quantity' && isMetricQuantity(value)) {
      return { type: 'quantity', value };
    }
    if (prefix === 'kind' && isMetricKind(value)) {
      return { type: 'kind', value };
    }
    return undefined;
  }
  const eq = word.indexOf('=');
  if (eq > 0 && eq < word.length - 1) {
    return {
      type: 'attr',
      key: word.slice(0, eq),
      value: unquote(word.slice(eq + 1)),
    };
  }
  return undefined;
}

/**
 * One box, two jobs: free text finds metrics by name and description, while
 * `unit:ms`, `has:http.route`, `service.name=api`, `quantity:latency` and
 * `kind:gauge` narrow the wall semantically.
 */
export function parseMetricQuery(query: string): ParsedMetricQuery {
  const text: string[] = [];
  const tokens: MetricQueryToken[] = [];
  for (const word of query.match(WORD) ?? []) {
    const token = parseWord(word);
    if (token) tokens.push(token);
    else text.push(unquote(word));
  }
  return { text: text.join(' '), tokens };
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function formatMetricQueryToken(token: MetricQueryToken): string {
  switch (token.type) {
    case 'unit':
      return `unit:${quoteIfNeeded(token.value)}`;
    case 'has':
      return `has:${quoteIfNeeded(token.key)}`;
    case 'attr':
      return `${token.key}=${quoteIfNeeded(token.value)}`;
    case 'quantity':
      return `quantity:${token.value}`;
    case 'kind':
      return `kind:${token.value}`;
  }
}

export function formatMetricQuery({ text, tokens }: ParsedMetricQuery) {
  return [...tokens.map(formatMetricQueryToken), text.trim()]
    .filter(Boolean)
    .join(' ');
}

function sameToken(a: MetricQueryToken, b: MetricQueryToken): boolean {
  return formatMetricQueryToken(a) === formatMetricQueryToken(b);
}

export function hasMetricQueryToken(
  query: string,
  token: MetricQueryToken,
): boolean {
  return parseMetricQuery(query).tokens.some(t => sameToken(t, token));
}

/** Add the token, or take it away if it is already there. */
export function toggleMetricQueryToken(
  query: string,
  token: MetricQueryToken,
): string {
  const parsed = parseMetricQuery(query);
  const without = parsed.tokens.filter(t => !sameToken(t, token));
  return formatMetricQuery({
    text: parsed.text,
    tokens:
      without.length === parsed.tokens.length
        ? [...parsed.tokens, token]
        : without,
  });
}

export type MatchableMetric = {
  name: string;
  type: MetricsDataType;
  unit?: string;
  description?: string;
  quantity: MetricQuantity;
  hasKey: (key: string) => boolean;
};

/**
 * Whether a metric belongs on the narrowed wall. An attribute value can only
 * be checked by querying, so `key=value` narrows to metrics carrying the key
 * and the tiles apply the value.
 */
export function matchesMetricQuery(
  metric: MatchableMetric,
  { text, tokens }: ParsedMetricQuery,
): boolean {
  const needle = text.trim().toLowerCase();
  if (
    needle &&
    !metric.name.toLowerCase().includes(needle) &&
    !metric.description?.toLowerCase().includes(needle)
  ) {
    return false;
  }
  return tokens.every(token => {
    switch (token.type) {
      case 'unit':
        return metric.unit === token.value;
      case 'has':
        return metric.hasKey(token.key);
      case 'attr':
        return metric.hasKey(token.key);
      case 'quantity':
        return metric.quantity === token.value;
      case 'kind':
        return metric.type === token.value;
    }
  });
}
