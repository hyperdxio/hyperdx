import type { Attributes } from './spanAttributeReaders';

export type HttpHeader = {
  /** Display name. Never use it to query the attribute; use `attributeKey`. */
  name: string;
  value: string;
  attributeKey: string;
};

export const HTTP_REQUEST_HEADER_PREFIX = 'http.request.header.';
export const HTTP_RESPONSE_HEADER_PREFIX = 'http.response.header.';

// Trace context headers would attach a replayed request to the trace it was
// captured from. curl derives Host and Content-Length from the URL and body,
// and a captured Content-Length can be stale when the body was truncated or
// redacted. Connection-level headers don't apply to a new connection.
const HEADERS_NOT_REPLAYED =
  /^(traceparent|tracestate|b3|x-b3-.*|uber-trace-id|x-amzn-trace-id|x-cloud-trace-context|sentry-trace|x-datadog-.*|host|content-length|connection|keep-alive|transfer-encoding)$/i;

// Map columns store the semconv `string[]` header value as a JSON string.
// Only arrays are parsed so numeric or quoted header values stay verbatim.
function headerValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trimStart().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not JSON, keep the raw string
    }
  }
  return [value];
}

/**
 * Header attributes keyed by `prefix` (e.g. `http.request.header.`), one entry
 * per value. Array values (the stable semconv shape) become one entry each.
 *
 * Names swap every `_` for `-` for display: OTel Python sends
 * `http.request.header.x_forwarded_for`. The attribute key is untouched in
 * `attributeKey`, which is what any query or filter must use.
 */
export function parseHttpHeaders(
  attributes: Attributes,
  prefix: string,
): HttpHeader[] {
  return Object.entries(attributes)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([attributeKey, value]) => {
      const name = attributeKey.slice(prefix.length).replace(/_/g, '-');
      return headerValues(value).map(v => ({
        name,
        value: v !== null && typeof v === 'object' ? JSON.stringify(v) : `${v}`,
        attributeKey,
      }));
    });
}

/**
 * `content-type` -> `Content-Type`, the casing HTTP/1.1 tools show. Header
 * names are case-insensitive, and semconv stores them lowercase, so this only
 * changes how names are shown (header tables and cURL). Not for gRPC
 * metadata, whose keys are lowercase by protocol.
 */
export function toHeaderDisplayCase(header: HttpHeader): HttpHeader {
  return {
    ...header,
    name: header.name.replace(
      /(^|-)([a-z])/g,
      (_, separator: string, letter: string) =>
        `${separator}${letter.toUpperCase()}`,
    ),
  };
}

/** First non-empty value of a header. `name` must be lowercase. */
export function firstHttpHeaderValue(
  attributes: Attributes,
  prefix: string,
  name: string,
): string | undefined {
  return parseHttpHeaders(attributes, prefix).find(
    header => header.name.toLowerCase() === name && header.value !== '',
  )?.value;
}

/** Request headers worth sending again when the request is replayed. */
export function getReplayableHeaders(headers: HttpHeader[]): HttpHeader[] {
  return headers.filter(header => !HEADERS_NOT_REPLAYED.test(header.name));
}
