import {
  getRequestPanelTitle,
  getRpcMetadata,
  getRpcMethod,
  getRpcServerAddress,
  getRpcStatus,
  getRpcSystemLabel,
} from '@/utils/rpcSpanAttributes';

describe('getRequestPanelTitle', () => {
  it.each([
    [{ 'rpc.system': 'grpc', 'http.request.method': 'POST' }, 'gRPC Call'],
    [{ 'rpc.grpc.status_code': 0 }, 'gRPC Call'],
    [{ 'rpc.system.name': 'connect_rpc' }, 'RPC Call'],
    [{ 'rpc.service': 'pkg.Service' }, 'RPC Call'],
    [{ 'grpc.method': '', 'http.request.method': 'GET' }, 'HTTP Request'],
    [{ 'db.system': 'clickhouse' }, undefined],
  ])('titles %o as %p', (attributes, expected) => {
    expect(getRequestPanelTitle(attributes)).toBe(expected);
  });

  it.each([
    [{ 'grpc.method': '/a.B/C' }, 'gRPC'],
    [{ 'rpc.system': 'aws-api' }, 'aws-api'],
    [{ 'rpc.method': 'a.B/C' }, 'RPC'],
  ])('labels the system of %o as %p', (attributes, expected) => {
    expect(getRpcSystemLabel(attributes)).toBe(expected);
  });
});

describe('getRpcMethod', () => {
  it.each([
    [{ 'rpc.method': 'a.B/C', 'grpc.method': '/x.Y/Z' }, 'a.B/C'],
    [{ 'rpc.service': 'a.B', 'rpc.method': 'C' }, 'a.B/C'],
    [{ 'rpc.method': '_OTHER', 'rpc.method_original': 'refund' }, 'refund'],
    [{ 'rpc.method': '_OTHER' }, '_OTHER'],
    [{ 'grpc.method': '/a.B/C' }, 'a.B/C'],
    [{ 'rpc.system': 'grpc', 'url.path': '/a.B/C' }, 'a.B/C'],
    [{ 'rpc.system': 'connect_rpc', 'url.path': '/a.B/C' }, undefined],
    [{ 'grpc.method': 'other', 'url.path': '/a.B/C' }, 'a.B/C'],
    [{ 'grpc.method': 'other' }, 'other'],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getRpcMethod(attributes)).toBe(expected);
  });
});

describe('getRpcStatus', () => {
  it.each([
    [{ 'rpc.status_code': '4', 'rpc.response.status_code': '0' }],
    [{ 'rpc.response.status_code': '4', 'rpc.grpc.status_code': 0 }],
    [{ 'rpc.grpc.status_code': 4, 'grpc.status_code': '0' }],
    [{ 'grpc.status_code': '4', 'grpc.status': '0' }],
    [{ 'grpc.status': '4' }],
  ])('reads the newest status in %o', attributes => {
    expect(getRpcStatus({ ...attributes, 'rpc.system': 'grpc' })?.label).toBe(
      '4 DEADLINE_EXCEEDED',
    );
  });

  it.each([
    ['grpc', 0, '0 OK', true],
    ['grpc', '14', '14 UNAVAILABLE', false],
    ['grpc', 'not_found', '5 NOT_FOUND', false],
    ['grpc', '99', '99', false],
    ['jsonrpc', '5', '5', false],
    ['onc_rpc', 'ok', 'ok', true],
  ])('normalizes a %s status %p to %p', (system, value, label, isOk) => {
    expect(
      getRpcStatus({ 'rpc.system': system, 'rpc.status_code': value }),
    ).toMatchObject({ label, isOk });
  });

  it('returns undefined without a status', () => {
    expect(getRpcStatus({ 'grpc.status_code': '' })).toBeUndefined();
  });
});

describe('getRpcServerAddress', () => {
  it.each([
    [{ 'server.address': 'quote', 'server.port': '8080' }, 'quote:8080'],
    [{ 'net.peer.name': 'checkout', 'net.peer.port': 8080 }, 'checkout:8080'],
    [{ 'server.address': 'fe80::1', 'server.port': 50051 }, '[fe80::1]:50051'],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getRpcServerAddress(attributes)).toBe(expected);
  });

  it('ignores net.peer.* on a server span, where it names the caller', () => {
    const attributes = { 'net.peer.name': 'localhost', 'net.peer.port': 41622 };
    expect(getRpcServerAddress(attributes, 'Server')).toBeUndefined();
    expect(getRpcServerAddress(attributes, 'SPAN_KIND_SERVER')).toBeUndefined();
  });
});

describe('getRpcMetadata', () => {
  it('merges request metadata across prefixes and drops repeats', () => {
    expect(
      getRpcMetadata(
        {
          'rpc.request.header.x-request-id': '["abc"]',
          'rpc.request.metadata.x_request_id': '["abc"]',
          'rpc.grpc.request.metadata.x-tenant': 'acme',
          'http.request.header.x-other': 'ignored',
        },
        'request',
      ).map(({ name, value }) => `${name}: ${value}`),
    ).toEqual(['x-request-id: abc', 'x-tenant: acme']);
  });

  it('includes trailers in the response metadata', () => {
    expect(
      getRpcMetadata(
        {
          'rpc.response.metadata.server': 'envoy',
          'rpc.response.trailer.grpc-status': '["0"]',
        },
        'response',
      ).map(({ name, value }) => `${name}: ${value}`),
    ).toEqual(['server: envoy', 'grpc-status: 0']);
  });
});
