// Readers shared by the HTTP and RPC span attribute getters. Map columns
// store every value as a string, so the readers treat '' as missing and parse
// numbers out of strings.
// https://opentelemetry.io/docs/specs/semconv/general/attributes/

export type Attributes = Record<string, unknown>;

type NetworkAddress = { address: string; port?: string };

/** An address attribute and, optionally, the port attribute paired with it. */
export type AddressKeys = readonly [address: string, port?: string];

const PEER_ADDRESS_KEYS: AddressKeys[] = [
  ['network.peer.address', 'network.peer.port'],
  ['net.sock.peer.addr', 'net.sock.peer.port'],
  ['net.peer.ip', 'net.peer.port'],
];

const CLIENT_ADDRESS_KEYS: AddressKeys[] = [
  ['client.address', 'client.port'],
  ['http.client_ip'],
];

const LOCAL_ADDRESS_KEYS: AddressKeys[] = [
  ['network.local.address', 'network.local.port'],
  ['net.sock.host.addr', 'net.sock.host.port'],
  ['net.host.ip'],
];

export function isSet(value: unknown): boolean {
  return value != null && value !== '';
}

export function firstSetString(
  attributes: Attributes,
  keys: string[],
): string | undefined {
  const key = keys.find(key => isSet(attributes[key]));
  return key != null ? String(attributes[key]) : undefined;
}

export function toFiniteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return isSet(value) && Number.isFinite(number) ? number : undefined;
}

export function firstSetNumber(
  attributes: Attributes,
  keys: string[],
): number | undefined {
  return toFiniteNumber(firstSetString(attributes, keys));
}

/**
 * The first address that is set, with the port from the same pair. Pairs are
 * read together so a port from one semconv version is never attached to an
 * address from another.
 */
export function firstAddress(
  attributes: Attributes,
  pairs: readonly AddressKeys[],
): NetworkAddress | undefined {
  for (const [addressKey, portKey] of pairs) {
    const address = firstSetString(attributes, [addressKey]);
    if (address != null) {
      const port =
        portKey != null ? firstSetString(attributes, [portKey]) : undefined;
      return { address, port };
    }
  }
  return undefined;
}

// Brackets follow RFC 3986, the same way browsers show a remote IPv6 address.
export function formatAddress({ address, port }: NetworkAddress): string {
  // Unix domain sockets report a file path and have no port.
  if (port == null || address.startsWith('/')) {
    return address;
  }
  const host =
    address.includes(':') && !address.startsWith('[')
      ? `[${address}]`
      : address;
  return `${host}:${port}`;
}

export function formatFirstAddress(
  attributes: Attributes,
  pairs: readonly AddressKeys[],
): string | undefined {
  const address = firstAddress(attributes, pairs);
  return address != null ? formatAddress(address) : undefined;
}

/** The socket peer: a proxy or load balancer when there is one. */
export function getNetworkPeerAddress(
  attributes: Attributes,
): string | undefined {
  return formatFirstAddress(attributes, PEER_ADDRESS_KEYS);
}

/**
 * The original client, which server spans resolve through proxy headers.
 * Undefined when it is the socket peer, i.e. there is no proxy. The
 * comparison ignores ports: servers usually report the peer port but not the
 * client port.
 */
export function getClientAddress(attributes: Attributes): string | undefined {
  const client = firstAddress(attributes, CLIENT_ADDRESS_KEYS);
  const peer = firstAddress(attributes, PEER_ADDRESS_KEYS);
  return client != null && client.address !== peer?.address
    ? formatAddress(client)
    : undefined;
}

export function getLocalAddress(attributes: Attributes): string | undefined {
  return formatFirstAddress(attributes, LOCAL_ADDRESS_KEYS);
}
