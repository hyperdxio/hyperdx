import {
  formatAddress,
  getClientAddress,
  getLocalAddress,
  getNetworkPeerAddress,
} from '@/utils/spanAttributeReaders';

describe('formatAddress', () => {
  it.each([
    [{ address: '10.0.0.1' }, '10.0.0.1'],
    [{ address: '10.0.0.1', port: '443' }, '10.0.0.1:443'],
    [{ address: '2001:db8::1', port: '443' }, '[2001:db8::1]:443'],
    [{ address: '[2001:db8::1]', port: '443' }, '[2001:db8::1]:443'],
    [{ address: '/var/run/app.sock', port: '0' }, '/var/run/app.sock'],
  ])('formats %o as %s', (address, expected) => {
    expect(formatAddress(address)).toBe(expected);
  });
});

describe('getNetworkPeerAddress', () => {
  it.each([
    ['network.peer.address', 'network.peer.port'],
    ['net.sock.peer.addr', 'net.sock.peer.port'],
    ['net.peer.ip', 'net.peer.port'],
  ])('reads %s with %s', (address, port) => {
    expect(getNetworkPeerAddress({ [address]: '10.0.0.1', [port]: 80 })).toBe(
      '10.0.0.1:80',
    );
  });

  it('prefers the newest pair and never takes a port from another pair', () => {
    expect(
      getNetworkPeerAddress({
        'network.peer.address': '10.0.0.1',
        'net.sock.peer.addr': '10.0.0.2',
        'net.sock.peer.port': '51514',
      }),
    ).toBe('10.0.0.1');
  });
});

describe('getLocalAddress', () => {
  it.each([
    ['network.local.address', 'network.local.port', '10.0.0.1:80'],
    ['net.sock.host.addr', 'net.sock.host.port', '10.0.0.1:80'],
    ['net.host.ip', 'net.host.port', '10.0.0.1'],
  ])('reads %s with %s', (address, port, expected) => {
    expect(getLocalAddress({ [address]: '10.0.0.1', [port]: 80 })).toBe(
      expected,
    );
  });
});

describe('getClientAddress', () => {
  it.each([
    [
      'client.address with its port',
      {
        'client.address': '203.0.113.9',
        'client.port': '65123',
        'http.client_ip': '198.51.100.1',
      },
      '203.0.113.9:65123',
    ],
    ['http.client_ip', { 'http.client_ip': '198.51.100.1' }, '198.51.100.1'],
    [
      'the client behind a proxy',
      { 'client.address': '203.0.113.9', 'network.peer.address': '10.0.0.5' },
      '203.0.113.9',
    ],
    [
      'nothing when the client is the peer, ignoring ports',
      {
        'client.address': '::1',
        'network.peer.address': '::1',
        'network.peer.port': '49347',
      },
      undefined,
    ],
  ])('returns %s', (_case, attributes, expected) => {
    expect(getClientAddress(attributes)).toBe(expected);
  });
});
