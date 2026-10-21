// Reads HTTP span attributes across OpenTelemetry semantic convention
// versions. Each getter prefers the current name and falls back to deprecated
// and SDK-specific ones, so spans from older instrumentation still render.
// https://opentelemetry.io/docs/specs/semconv/http/http-spans/

import { formatNumber } from '@/utils';

import {
  firstHttpHeaderValue,
  HTTP_REQUEST_HEADER_PREFIX,
} from './httpHeaders';
import {
  Attributes,
  firstSetNumber,
  firstSetString,
  isSet,
  toFiniteNumber,
} from './spanAttributeReaders';

type HttpDirection = 'request' | 'response';

const HTTP_SPAN_KEYS = [
  'url.full',
  'url.path',
  'http.request.method',
  'http.response.status_code',
  'http.url',
  // Pre-1.21 server spans often carry no http.url, so the old method, status
  // and target keys mark them too.
  'http.method',
  'http.status_code',
  'http.target',
];

// Common codes only; the badge shows any other code without a phrase.
const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function isHttpSpan(attributes: Attributes): boolean {
  return HTTP_SPAN_KEYS.some(key => isSet(attributes[key]));
}

export function getHttpMethod(attributes: Attributes): string | undefined {
  const method = firstSetString(attributes, [
    'http.request.method',
    'http.method',
  ]);
  // Instrumentations report methods they don't recognize as `_OTHER` and keep
  // the real one in `http.request.method_original`.
  if (method === '_OTHER') {
    return (
      firstSetString(attributes, ['http.request.method_original']) ?? method
    );
  }
  return method;
}

export function getHttpStatusCode(attributes: Attributes): number | undefined {
  return firstSetNumber(attributes, [
    'http.response.status_code',
    'http.status_code',
  ]);
}

/**
 * `http.status_text` from older OTel JS instrumentations (the legacy HyperDX
 * SDKs), else a common reason phrase.
 */
export function getHttpStatusText(
  attributes: Attributes,
  statusCode: number | undefined,
): string | undefined {
  return (
    firstSetString(attributes, ['http.status_text']) ??
    (statusCode != null ? REASON_PHRASES[statusCode] : undefined)
  );
}

export function getHttpRoute(attributes: Attributes): string | undefined {
  return firstSetString(attributes, ['http.route', 'url.template']);
}

export function getHttpProtocol(attributes: Attributes): string | undefined {
  const version = firstSetString(attributes, [
    'network.protocol.version',
    'net.protocol.version',
    'http.flavor',
  ]);
  if (version == null) {
    return undefined;
  }
  // `http.flavor` also allowed bare names such as "QUIC" and "SPDY".
  if (!/^\d/.test(version)) {
    return version;
  }
  const name =
    firstSetString(attributes, [
      'network.protocol.name',
      'net.protocol.name',
    ]) ?? 'http';
  // `http.flavor` wrote "2.0" and "3.0"; current semconv writes "2" and "3".
  return `${name.toUpperCase()}/${version.replace(/^([23])\.0$/, '$1')}`;
}

// OTel Python's gRPC server instrumentation reports `rpc.user_agent`.
export function getUserAgent(attributes: Attributes): string | undefined {
  return (
    firstSetString(attributes, [
      'user_agent.original',
      'rpc.user_agent',
      'http.user_agent',
    ]) ??
    firstHttpHeaderValue(attributes, HTTP_REQUEST_HEADER_PREFIX, 'user-agent')
  );
}

// One decimal above 1 KB, so a body and total of 1536 and 1900 bytes don't
// both round to "2 KB".
function formatBytes(bytes: number): string {
  return formatNumber(bytes, {
    output: 'byte',
    mantissa: Math.abs(bytes) >= 1024 ? 1 : 0,
  });
}

// `*_content_length_uncompressed` comes last: it is the decoded size, while
// `body.size` is the size on the wire.
function getBodySize(
  attributes: Attributes,
  direction: HttpDirection,
): number | undefined {
  return (
    firstSetNumber(attributes, [
      `http.${direction}.body.size`,
      `http.${direction}_content_length`,
    ]) ??
    toFiniteNumber(
      firstHttpHeaderValue(
        attributes,
        `http.${direction}.header.`,
        'content-length',
      ),
    ) ??
    firstSetNumber(attributes, [
      `http.${direction}_content_length_uncompressed`,
    ])
  );
}

/**
 * Body bytes and total bytes (start line, headers and body), e.g.
 * "1.5 KB body · 1.9 KB total".
 */
export function getHttpMessageSize(
  attributes: Attributes,
  direction: HttpDirection,
): string | undefined {
  const body = getBodySize(attributes, direction);
  const total = firstSetNumber(attributes, [`http.${direction}.size`]);
  const parts = [
    body != null ? `${formatBytes(body)} body` : undefined,
    total != null ? `${formatBytes(total)} total` : undefined,
  ];
  return parts.filter(part => part != null).join(' · ') || undefined;
}

export function getHttpResendCount(attributes: Attributes): number | undefined {
  return firstSetNumber(attributes, [
    'http.request.resend_count',
    'http.resend_count',
    'http.retry_count',
  ]);
}

// Bodies keep '' so the panel can tell an empty body from one that wasn't
// collected.
export function getHttpBody(
  attributes: Attributes,
  direction: HttpDirection,
): unknown {
  return (
    attributes[`http.${direction}.body.content`] ??
    attributes[`http.${direction}.body`]
  );
}

/**
 * E.g. "8.0 KB of 23.3 KB" for a body shorter than its reported size. The
 * ClickStack Node and Python SDKs cut captured bodies at 8192 bytes
 * (configurable in Python) without flagging it, but report the full size in
 * `http.*.body.size`. A redacted body can also come out shorter than that
 * size.
 */
export function getHttpBodyTruncation(
  attributes: Attributes,
  direction: HttpDirection,
): string | undefined {
  const body = getHttpBody(attributes, direction);
  const total = firstSetNumber(attributes, [`http.${direction}.body.size`]);
  if (typeof body !== 'string' || total == null) {
    return undefined;
  }
  const shown = new TextEncoder().encode(body).length;
  return total > shown
    ? `${formatBytes(shown)} of ${formatBytes(total)}`
    : undefined;
}
