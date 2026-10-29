// Rebuilds the URL of an HTTP span across semantic convention versions:
// client spans send it whole, server spans in parts.
// https://opentelemetry.io/docs/specs/semconv/http/http-spans/

import {
  AddressKeys,
  Attributes,
  firstAddress,
  firstSetString,
} from './spanAttributeReaders';

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };

// `http.host` is the Host header, so it carries its own port when the port
// isn't the default one.
const URL_HOST_KEYS: AddressKeys[] = [
  ['server.address', 'server.port'],
  ['http.host'],
  ['net.host.name', 'net.host.port'],
  ['http.server_name', 'net.host.port'],
];

// Pre-1.21 client spans could name the host in net.peer.* instead of
// http.host. It goes last because on server spans net.peer.name is the
// client, and a compliant server span always has one of the keys above.
const DEPRECATED_URL_HOST_KEYS: AddressKeys[] = [
  ...URL_HOST_KEYS,
  ['net.peer.name', 'net.peer.port'],
];

// OTel Python can put the port in server.address (WSGI copies the Host
// header, ASGI writes the socket's host:port), so only a bare host gets
// server.port added.
function formatHost(
  address: string,
  port: string | undefined,
  scheme: string | undefined,
): string {
  const colons = address.split(':').length - 1;
  const hasPort =
    /^\[.*\]:\d+$/.test(address) || (colons === 1 && /:\d+$/.test(address));
  if (hasPort) {
    return address;
  }

  const host =
    colons >= 2 && !address.startsWith('[') ? `[${address}]` : address;
  const showPort =
    port != null && port !== DEFAULT_PORTS[scheme?.toLowerCase() ?? ''];
  return `${host}${showPort ? `:${port}` : ''}`;
}

export function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function absoluteOrUndefined(url: string | undefined) {
  return url != null && isAbsoluteHttpUrl(url) ? url : undefined;
}

function joinUrl(
  attributes: Attributes,
  target: string,
  hostKeys: AddressKeys[],
): string {
  const scheme = firstSetString(attributes, ['url.scheme', 'http.scheme']);
  const host = firstAddress(attributes, hostKeys);
  let origin = '';
  if (host != null) {
    origin = `${scheme != null ? `${scheme}://` : ''}${formatHost(host.address, host.port, scheme)}`;
  }

  const separator = origin && !target.startsWith('/') ? '/' : '';
  return `${origin}${separator}${target}`;
}

// Server spans carry the URL in parts instead of `url.full`.
function urlFromStableParts(attributes: Attributes): string | undefined {
  const path = firstSetString(attributes, ['url.path']);
  if (path == null) {
    return undefined;
  }
  const query = firstSetString(attributes, ['url.query'])?.replace(/^\?/, '');
  return joinUrl(
    attributes,
    `${path}${query ? `?${query}` : ''}`,
    URL_HOST_KEYS,
  );
}

// Before v1.21 the path and query arrived together in `http.target`.
function urlFromDeprecatedParts(attributes: Attributes): string | undefined {
  const target = firstSetString(attributes, ['http.target']);
  if (target == null) {
    return undefined;
  }
  // Requests sent to a forward proxy put the absolute URL in the target.
  if (isAbsoluteHttpUrl(target)) {
    return target;
  }
  return joinUrl(attributes, target, DEPRECATED_URL_HOST_KEYS);
}

/**
 * `url.full`, else a URL rebuilt from the stable parts, else `http.url`, else
 * one rebuilt from `http.target`.
 *
 * `http.url` beats the deprecated parts: the instrumentation built it from the
 * same request, while the parts can be incomplete (OTel JS's Node http client
 * spans send no `http.scheme`, and ASGI's `http.target` drops the query). Any
 * rebuild missing a scheme or host loses to `http.url` too.
 */
export function getHttpUrl(attributes: Attributes): string | undefined {
  const stable = urlFromStableParts(attributes);
  const deprecated = urlFromDeprecatedParts(attributes);
  return (
    firstSetString(attributes, ['url.full']) ??
    absoluteOrUndefined(stable) ??
    firstSetString(attributes, ['http.url']) ??
    absoluteOrUndefined(deprecated) ??
    stable ??
    deprecated
  );
}
