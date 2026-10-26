import {
  datastoreKey,
  parseNodeKey,
  serviceKey,
  toNodeKey,
} from '@/knowledge/topology/nodeKey';

describe('nodeKey', () => {
  it('builds datastore keys with address fallbacks', () => {
    expect(
      datastoreKey({ 'db.system': 'postgresql', 'server.address': 'cart-db' }),
    ).toBe('datastore:postgresql:cart-db');
    expect(
      datastoreKey({ 'db.system': 'redis', 'net.peer.name': 'cache-1' }),
    ).toBe('datastore:redis:cache-1');
    expect(datastoreKey({ 'db.system': 'redis' })).toBe(
      'datastore:redis:unknown',
    );
  });

  it('returns null without db.system', () => {
    expect(datastoreKey({ 'server.address': 'x' })).toBeNull();
  });

  it('keeps quotes in service labels', () => {
    expect(parseNodeKey(serviceKey("o'reilly-svc")).label).toBe("o'reilly-svc");
    expect(parseNodeKey('datastore:postgresql:a:b')).toEqual({
      kind: 'datastore',
      label: 'postgresql:a:b',
    });
  });

  it('prefixes bare names once and keeps known node keys', () => {
    expect(toNodeKey('checkout')).toBe('service:checkout');
    expect(toNodeKey('service:checkout')).toBe('service:checkout');
    expect(toNodeKey('datastore:redis:c')).toBe('datastore:redis:c');
  });
});
