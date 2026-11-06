import {
  firstSetString,
  formatAddress,
  getClientAddress,
  getLocalAddress,
  getNetworkPeerAddress,
  toFiniteNumber,
} from '@/utils/spanAttributeReaders';

it('firstSetString skips empty strings', () => {
  expect(firstSetString({ a: '', b: 0 }, ['a', 'b'])).toBe('0');
});

it.each([
  ['42', 42],
  ['', undefined],
  ['Infinity', undefined],
])('toFiniteNumber(%p) is %p', (value, expected) => {
  expect(toFiniteNumber(value)).toBe(expected);
});

it.each([
  [{ address: '::1', port: '80' }, '[::1]:80'],
  [{ address: '::1' }, '::1'],
  [{ address: '/run/app.sock', port: '0' }, '/run/app.sock'],
])('formatAddress(%o) is %p', (address, expected) => {
  expect(formatAddress(address)).toBe(expected);
});

it.each([
  [getNetworkPeerAddress, 'network.peer.address', 'network.peer.port', 'a:1'],
  [getNetworkPeerAddress, 'net.sock.peer.addr', 'net.sock.peer.port', 'a:1'],
  [getNetworkPeerAddress, 'net.peer.ip', 'net.peer.port', 'a:1'],
  [getLocalAddress, 'network.local.address', 'network.local.port', 'a:1'],
  [getLocalAddress, 'net.sock.host.addr', 'net.sock.host.port', 'a:1'],
  [getLocalAddress, 'net.host.ip', 'net.host.port', 'a'],
])('%p reads %s with %s as %p', (getter, address, port, expected) => {
  expect(getter({ [address]: 'a', [port]: 1 })).toBe(expected);
});

it('getNetworkPeerAddress never takes a port from another pair', () => {
  expect(
    getNetworkPeerAddress({
      'network.peer.address': 'a',
      'net.sock.peer.addr': 'b',
      'net.sock.peer.port': 1,
    }),
  ).toBe('a');
});

it('getClientAddress hides the client when it is the peer, ignoring ports', () => {
  const peer = { 'network.peer.address': 'a', 'network.peer.port': 1 };
  expect(
    getClientAddress({ ...peer, 'client.address': 'a', 'client.port': 9 }),
  ).toBeUndefined();
  expect(
    getClientAddress({ ...peer, 'client.address': 'c', 'client.port': 9 }),
  ).toBe('c:9');
});
