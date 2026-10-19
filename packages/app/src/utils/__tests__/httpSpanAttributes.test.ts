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

describe('isHttpSpan', () => {
  it.each([
    [{ 'http.response.status_code': 0 }, true],
    [{ 'http.target': '/a?b=1' }, true],
    [{ 'url.full': '', 'http.request.method': null }, false],
    [{ 'db.system': 'clickhouse' }, false],
  ])('detects %o: %p', (attributes, expected) => {
    expect(isHttpSpan(attributes)).toBe(expected);
  });
});

describe('getHttpMethod', () => {
  it.each([
    [{ 'http.request.method': 'POST', 'http.method': 'GET' }, 'POST'],
    [{ 'http.request.method': '', 'http.method': 'GET' }, 'GET'],
    [
      {
        'http.request.method': '_OTHER',
        'http.request.method_original': 'PROPFIND',
      },
      'PROPFIND',
    ],
    [{ 'http.request.method': '_OTHER' }, '_OTHER'],
    [{}, undefined],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getHttpMethod(attributes)).toBe(expected);
  });
});

describe('getHttpStatusCode', () => {
  it.each([
    [{ 'http.response.status_code': 404, 'http.status_code': 200 }, 404],
    [{ 'http.response.status_code': '', 'http.status_code': '500' }, 500],
    [{ 'http.status_code': '0' }, 0],
    [{ 'http.response.status_code': 'abc' }, undefined],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getHttpStatusCode(attributes)).toBe(expected);
  });

  it.each([
    [{ 'http.status_text': 'Nope' }, 404, 'Nope'],
    [{}, 404, 'Not Found'],
    [{}, 418, undefined],
    [{}, undefined, undefined],
  ])('reads the status text of %o and %p', (attributes, code, expected) => {
    expect(getHttpStatusText(attributes, code)).toBe(expected);
  });
});

describe('getHttpRoute', () => {
  it('prefers http.route over url.template', () => {
    expect(getHttpRoute({ 'http.route': '/u/:id', 'url.template': 'x' })).toBe(
      '/u/:id',
    );
    expect(getHttpRoute({ 'url.template': '/u/{id}' })).toBe('/u/{id}');
  });
});

describe('getHttpProtocol', () => {
  it.each([
    [{ 'network.protocol.version': '2', 'http.flavor': '1.0' }, 'HTTP/2'],
    [{ 'net.protocol.name': 'spdy', 'net.protocol.version': '3' }, 'SPDY/3'],
    [{ 'http.flavor': '3.0' }, 'HTTP/3'],
    [{ 'http.flavor': 'QUIC' }, 'QUIC'],
    [{ 'network.protocol.name': 'http' }, undefined],
  ])('formats %o as %p', (attributes, expected) => {
    expect(getHttpProtocol(attributes)).toBe(expected);
  });
});

describe('getUserAgent', () => {
  it.each([
    [{ 'user_agent.original': 'a', 'rpc.user_agent': 'b' }, 'a'],
    [{ 'rpc.user_agent': 'b', 'http.user_agent': 'c' }, 'b'],
    [{ 'http.user_agent': 'c', 'http.request.header.user-agent': 'd' }, 'c'],
    [{ 'http.request.header.user_agent': '["d"]' }, 'd'],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getUserAgent(attributes)).toBe(expected);
  });
});

describe('getHttpMessageSize', () => {
  it('reads the body size chain in order', () => {
    const chain = [
      ['http.response.body.size', '10'],
      ['http.response_content_length', '20'],
      ['http.response.header.content-length', '30'],
      ['http.response_content_length_uncompressed', '40'],
    ];
    const attributes = Object.fromEntries(chain);
    for (const [key, size] of chain) {
      expect(getHttpMessageSize(attributes, 'response')).toBe(`${size} B body`);
      delete attributes[key];
    }
    expect(getHttpMessageSize(attributes, 'response')).toBeUndefined();
  });

  it('shows the body and total sizes', () => {
    expect(
      getHttpMessageSize(
        { 'http.request.body.size': '1536', 'http.request.size': '1946' },
        'request',
      ),
    ).toBe('1.5 KB body · 1.9 KB total');
    expect(getHttpMessageSize({ 'http.request.size': 0 }, 'request')).toBe(
      '0 B total',
    );
  });
});

describe('getHttpResendCount', () => {
  it.each([
    [{ 'http.request.resend_count': '2', 'http.resend_count': '3' }, 2],
    [{ 'http.resend_count': '3', 'http.retry_count': '4' }, 3],
    [{ 'http.retry_count': 4 }, 4],
  ])('reads %o as %p', (attributes, expected) => {
    expect(getHttpResendCount(attributes)).toBe(expected);
  });
});

describe('getHttpBody', () => {
  it.each([
    [{ 'http.request.body.content': 'new', 'http.request.body': 'old' }, 'new'],
    [{ 'http.request.body': 'old' }, 'old'],
    [{ 'http.request.body.content': '', 'http.request.body': 'old' }, ''],
    [{ 'http.response.body': 'old' }, undefined],
  ])('reads the request body of %o as %p', (attributes, expected) => {
    expect(getHttpBody(attributes, 'request')).toBe(expected);
  });

  it.each([
    ['a cut body', '23817', 'a'.repeat(8192), '8.0 KB of 23.3 KB'],
    ['UTF-8 bytes, not characters', '4', 'éé', undefined],
    ['a non-string body', '30', { a: 1 }, undefined],
    ['no reported size', undefined, 'abc', undefined],
  ])('reports truncation for %s', (_case, size, body, expected) => {
    expect(
      getHttpBodyTruncation(
        { 'http.response.body.size': size, 'http.response.body.content': body },
        'response',
      ),
    ).toBe(expected);
  });
});
