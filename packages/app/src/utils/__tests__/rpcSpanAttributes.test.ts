import {
  getRequestPanelTitle,
  getRpcMetadata,
  getRpcMethod,
  getRpcServerAddress,
  getRpcStatus,
  getRpcSystemLabel,
} from '@/utils/rpcSpanAttributes';

it.each([
  [getRequestPanelTitle, { 'rpc.system': 'grpc' }, 'gRPC Call'],
  [getRequestPanelTitle, { 'grpc.method': 'x', 'url.full': 'x' }, 'gRPC Call'],
  [getRequestPanelTitle, { 'rpc.method': 'x', 'url.full': 'x' }, 'RPC Call'],
  [getRequestPanelTitle, { 'url.full': 'x' }, 'HTTP Request'],
  [getRequestPanelTitle, { 'db.system': 'x' }, undefined],
  [getRpcSystemLabel, { 'grpc.method': 'x' }, 'gRPC'],
  [getRpcSystemLabel, { 'rpc.system': 'aws-api' }, 'aws-api'],
  [getRpcSystemLabel, { 'rpc.method': 'x' }, 'RPC'],
  [getRpcMethod, { 'rpc.service': 'a.B', 'rpc.method': 'C' }, 'a.B/C'],
  [getRpcMethod, { 'rpc.method': '_OTHER', 'rpc.method_original': 'c' }, 'c'],
  [getRpcMethod, { 'grpc.method': '/a.B/C' }, 'a.B/C'],
  // grpc-dotnet reports a method the server doesn't know as `other`.
  [getRpcMethod, { 'grpc.method': 'other', 'url.path': '/a.B/C' }, 'a.B/C'],
])('%p(%o) is %p', (getter, attributes, expected) => {
  expect(getter(attributes)).toBe(expected);
});

it.each([
  ['grpc', 0, '0 OK', true],
  ['grpc', '14', '14 UNAVAILABLE', false],
  ['grpc', 'not_found', '5 NOT_FOUND', false],
  ['grpc', '99', '99', false],
  ['jsonrpc', '5', '5', false],
])('getRpcStatus reads a %s status %p as %p', (system, value, label, isOk) => {
  expect(
    getRpcStatus({ 'rpc.system': system, 'rpc.status_code': value }),
  ).toMatchObject({ label, isOk });
});

it('getRpcServerAddress reads net.peer.* only on client spans', () => {
  const attributes = { 'net.peer.name': 'a', 'net.peer.port': 1 };
  expect(getRpcServerAddress(attributes, 'Client')).toBe('a:1');
  expect(getRpcServerAddress(attributes, 'Server')).toBeUndefined();
  expect(getRpcServerAddress(attributes, 'SPAN_KIND_SERVER')).toBeUndefined();
});

it('getRpcMetadata merges prefixes without repeats and includes trailers', () => {
  const attributes = {
    'rpc.request.header.x-id': '["a"]',
    'rpc.request.metadata.x_id': 'a',
    'rpc.grpc.request.metadata.x-tenant': 'b',
    'rpc.response.metadata.server': 'c',
    'rpc.response.trailer.grpc-status': '0',
  };
  const names = (direction: 'request' | 'response') =>
    getRpcMetadata(attributes, direction).map(header => header.name);
  expect(names('request')).toEqual(['x-id', 'x-tenant']);
  expect(names('response')).toEqual(['server', 'grpc-status']);
});
