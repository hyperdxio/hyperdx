import {
  getHttpBody,
  getHttpBodyTruncation,
  getHttpMessageSize,
  getHttpMethod,
  getHttpProtocol,
  getHttpResendCount,
  getHttpRoute,
  getHttpStatusCode,
  getHttpStatusText,
  getUserAgent,
  isHttpSpan,
} from '@/utils/httpSpanAttributes';

it.each([
  [isHttpSpan, { 'http.response.status_code': 0 }, true],
  [isHttpSpan, { 'http.target': '/a' }, true],
  [isHttpSpan, { 'url.full': '' }, false],
  [getHttpMethod, { 'http.request.method': '', 'http.method': 'GET' }, 'GET'],
  [
    getHttpMethod,
    { 'http.request.method': '_OTHER', 'http.request.method_original': 'X' },
    'X',
  ],
  [getHttpStatusCode, { 'http.status_code': '500' }, 500],
  [getHttpRoute, { 'url.template': '/u/{id}' }, '/u/{id}'],
  [getHttpProtocol, { 'http.flavor': '2.0' }, 'HTTP/2'],
  [getHttpProtocol, { 'http.flavor': '1.0' }, 'HTTP/1.0'],
  [
    getHttpProtocol,
    { 'network.protocol.name': 'spdy', 'network.protocol.version': '3' },
    'SPDY/3',
  ],
  [getHttpProtocol, { 'http.flavor': 'SPDY' }, 'SPDY'],
  [getUserAgent, { 'user_agent.original': 'a', 'rpc.user_agent': 'b' }, 'a'],
  [getUserAgent, { 'rpc.user_agent': 'b', 'http.user_agent': 'c' }, 'b'],
  [
    getUserAgent,
    { 'http.user_agent': 'c', 'http.request.header.user-agent': 'd' },
    'c',
  ],
  [getUserAgent, { 'http.request.header.user_agent': '["d"]' }, 'd'],
  [
    getHttpResendCount,
    { 'http.request.resend_count': 2, 'http.resend_count': 3 },
    2,
  ],
  [getHttpResendCount, { 'http.resend_count': 3, 'http.retry_count': 4 }, 3],
  [getHttpResendCount, { 'http.retry_count': '4' }, 4],
])('%p(%o) is %p', (getter, attributes, expected) => {
  expect(getter(attributes)).toBe(expected);
});

it.each([
  [{ 'http.status_text': 'Nope' }, 404, 'Nope'],
  [{}, 404, 'Not Found'],
  [{}, 418, undefined],
])('getHttpStatusText(%o, %p) is %p', (attributes, code, expected) => {
  expect(getHttpStatusText(attributes, code)).toBe(expected);
});

it.each([
  [
    getHttpMessageSize,
    { 'http.request.body.size': 1536, 'http.request.size': 1946 },
    '1.5 KB body · 1.9 KB total',
  ],
  [
    getHttpMessageSize,
    { 'http.request.header.content-length': '["30"]' },
    '30 B body',
  ],
  [
    getHttpBody,
    { 'http.request.body.content': '', 'http.request.body': 'a' },
    '',
  ],
  [getHttpBody, { 'http.request.body': 'a' }, 'a'],
  [
    getHttpBodyTruncation,
    { 'http.request.body.content': 'abc', 'http.request.body.size': 10 },
    '3 B of 10 B',
  ],
  // Bytes, not characters.
  [
    getHttpBodyTruncation,
    { 'http.request.body.content': 'éé', 'http.request.body.size': 4 },
    undefined,
  ],
])('%p(%o, "request") is %p', (getter, attributes, expected) => {
  expect(getter(attributes, 'request')).toBe(expected);
});
