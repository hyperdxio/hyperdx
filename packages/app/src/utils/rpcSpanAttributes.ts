// Reads RPC span attributes across semconv versions, plus the `grpc.method`
// and `grpc.status_code` tags grpc-dotnet sets on ASP.NET Core's HTTP server
// span and Grpc.Net.Client's call span. Only gRPC status codes are named;
// other systems' statuses are shown as emitted.
// https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/

import uniqBy from 'lodash/uniqBy';

import { HttpHeader, parseHttpHeaders } from './httpHeaders';
import { isHttpSpan } from './httpSpanAttributes';
import {
  AddressKeys,
  Attributes,
  firstSetString,
  formatFirstAddress,
  isSet,
} from './spanAttributeReaders';

const RPC_SYSTEM_KEYS = ['rpc.system.name', 'rpc.system'];

const GRPC_KEYS = ['grpc.method', 'grpc.status_code', 'rpc.grpc.status_code'];

// Dubbo, Connect and JSON-RPC set these too, so on their own they only mark a
// generic RPC call.
const GENERIC_RPC_KEYS = ['rpc.method', 'rpc.service'];

// Newest name first: semconv main (unreleased) renames
// `rpc.response.status_code` to `rpc.status_code`, and v1.39 replaced
// `rpc.grpc.status_code`. grpc-dotnet sets `grpc.status_code` and may also set
// `grpc.status`.
const RPC_STATUS_KEYS = [
  'rpc.status_code',
  'rpc.response.status_code',
  'rpc.grpc.status_code',
  'grpc.status_code',
  'grpc.status',
];

// Index is the numeric code.
// https://github.com/grpc/grpc/blob/master/doc/statuscodes.md
const GRPC_STATUS_NAMES: readonly string[] = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
];

const SERVER_KEYS: AddressKeys[] = [['server.address', 'server.port']];

// Before v1.21 client spans named the server in net.peer.*. On server spans
// those keys name the caller.
const CLIENT_SPAN_SERVER_KEYS: AddressKeys[] = [
  ...SERVER_KEYS,
  ['net.peer.name', 'net.peer.port'],
];

// Semconv main (unreleased) renames the v1.39 `metadata` keys to `header`
// and splits response metadata into headers and trailers.
const METADATA_PREFIXES = {
  request: [
    'rpc.request.header.',
    'rpc.request.metadata.',
    'rpc.grpc.request.metadata.',
  ],
  response: [
    'rpc.response.header.',
    'rpc.response.metadata.',
    'rpc.grpc.response.metadata.',
    'rpc.response.trailer.',
  ],
};

export type RpcStatus = {
  /** gRPC only. */
  code?: number;
  /** The gRPC status name, or the value as emitted. */
  name: string;
  /** Badge text, e.g. "5 NOT_FOUND". */
  label: string;
  isOk: boolean;
};

function isGrpcSpan(attributes: Attributes): boolean {
  return (
    firstSetString(attributes, RPC_SYSTEM_KEYS) === 'grpc' ||
    GRPC_KEYS.some(key => isSet(attributes[key]))
  );
}

export function isRpcSpan(attributes: Attributes): boolean {
  return [...RPC_SYSTEM_KEYS, ...GRPC_KEYS, ...GENERIC_RPC_KEYS].some(key =>
    isSet(attributes[key]),
  );
}

/** Title of the overview's request panel; undefined when there is no panel. */
export function getRequestPanelTitle(
  attributes: Attributes,
): string | undefined {
  if (isGrpcSpan(attributes)) {
    return 'gRPC Call';
  }
  if (isRpcSpan(attributes)) {
    return 'RPC Call';
  }
  return isHttpSpan(attributes) ? 'HTTP Request' : undefined;
}

export function getRpcSystemLabel(attributes: Attributes): string {
  if (isGrpcSpan(attributes)) {
    return 'gRPC';
  }
  return firstSetString(attributes, RPC_SYSTEM_KEYS) ?? 'RPC';
}

const stripLeadingSlash = (value: string) => value.replace(/^\//, '');

/** Fully qualified method, e.g. `oteldemo.CartService/EmptyCart`. */
export function getRpcMethod(attributes: Attributes): string | undefined {
  const method = firstSetString(attributes, ['rpc.method']);
  if (method === '_OTHER') {
    return firstSetString(attributes, ['rpc.method_original']) ?? method;
  }
  if (method != null) {
    // Before v1.39 `rpc.method` held only the short name and `rpc.service`
    // the service.
    const service = firstSetString(attributes, ['rpc.service']);
    return stripLeadingSlash(
      service != null && !method.includes('/')
        ? `${service}/${method}`
        : method,
    );
  }
  // A gRPC request's path is `/{service}/{method}`. It beats .NET's `other`,
  // which stands for a method the server doesn't know.
  const grpcMethod = firstSetString(attributes, ['grpc.method']);
  const path = isGrpcSpan(attributes)
    ? firstSetString(attributes, ['url.path'])
    : undefined;
  const fallback =
    grpcMethod === 'other' ? (path ?? grpcMethod) : (grpcMethod ?? path);
  return fallback != null ? stripLeadingSlash(fallback) : undefined;
}

export function getRpcStatus(attributes: Attributes): RpcStatus | undefined {
  const value = firstSetString(attributes, RPC_STATUS_KEYS)?.trim();
  if (value == null) {
    return undefined;
  }
  // Every system has its own codes: a JSON-RPC 5 is not gRPC NOT_FOUND.
  if (isGrpcSpan(attributes)) {
    const code = /^\d+$/.test(value)
      ? Number(value)
      : GRPC_STATUS_NAMES.indexOf(value.toUpperCase());
    const name = GRPC_STATUS_NAMES[code];
    if (name != null) {
      return { code, name, label: `${code} ${name}`, isOk: code === 0 };
    }
  }
  return { name: value, label: value, isOk: /^(ok|0)$/i.test(value) };
}

/**
 * The server the client called, e.g. `quote:8080`. `spanKind` is the
 * SpanKind column, which the ClickHouse exporter writes as `Server` and older
 * versions as `SPAN_KIND_SERVER`.
 */
export function getRpcServerAddress(
  attributes: Attributes,
  spanKind?: string,
): string | undefined {
  const isServerSpan = spanKind === 'Server' || spanKind === 'SPAN_KIND_SERVER';
  return formatFirstAddress(
    attributes,
    isServerSpan ? SERVER_KEYS : CLIENT_SPAN_SERVER_KEYS,
  );
}

/** RPC metadata as header rows, response trailers included. */
export function getRpcMetadata(
  attributes: Attributes,
  direction: keyof typeof METADATA_PREFIXES,
): HttpHeader[] {
  const entries = METADATA_PREFIXES[direction].flatMap(prefix =>
    parseHttpHeaders(attributes, prefix),
  );
  // An emitter migrating between versions may send the same entry under more
  // than one prefix.
  return uniqBy(entries, ({ name, value }) => JSON.stringify([name, value]));
}
