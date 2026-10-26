export const serviceKey = (name: string) => `service:${name}`;

// A bare name becomes a service key; a string with a known kind prefix is used as is.
export const toNodeKey = (input: string) =>
  /^(service|datastore|incident):/.test(input) ? input : serviceKey(input);

const nonEmpty = (v: string | undefined) => (v ? v : undefined);

export function datastoreKey(attrs: Record<string, string>): string | null {
  const system = nonEmpty(attrs['db.system']);
  if (!system) return null;
  const address =
    nonEmpty(attrs['server.address']) ??
    nonEmpty(attrs['net.peer.name']) ??
    nonEmpty(attrs['db.name']) ??
    'unknown';
  return `datastore:${system}:${address}`;
}

export function parseNodeKey(key: string): {
  kind: 'service' | 'datastore' | 'incident';
  label: string;
} {
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (kind === 'service' || kind === 'incident') return { kind, label: rest };
  if (kind === 'datastore') return { kind, label: rest };
  throw new Error(`Unknown node key: ${key}`);
}
