import {
  firstHttpHeaderValue,
  getReplayableHeaders,
  HTTP_REQUEST_HEADER_PREFIX,
  parseHttpHeaders,
  toHeaderDisplayCase,
} from '@/utils/httpHeaders';

const parseRequestHeaders = (attributes: Record<string, unknown>) =>
  parseHttpHeaders(attributes, HTTP_REQUEST_HEADER_PREFIX);

describe('parseHttpHeaders', () => {
  it('reads one prefix and shows Python underscore names with dashes', () => {
    expect(
      parseRequestHeaders({
        'http.request.header.x_forwarded_for': '1.2.3.4',
        'http.response.header.content-type': 'text/html',
        'http.url': 'https://clickhouse.com',
      }),
    ).toEqual([
      {
        name: 'x-forwarded-for',
        value: '1.2.3.4',
        attributeKey: 'http.request.header.x_forwarded_for',
      },
    ]);
  });

  it.each([['a=1', 'b=2'], '["a=1","b=2"]'])(
    'expands the array value %p into one entry each',
    value => {
      expect(
        parseRequestHeaders({ 'http.request.header.cookie': value }).map(
          header => header.value,
        ),
      ).toEqual(['a=1', 'b=2']);
    },
  );

  it('keeps values that are not JSON arrays verbatim', () => {
    expect(
      parseRequestHeaders({
        'http.request.header.content-length': '0123',
        'http.request.header.if-none-match': '"abc"',
        'http.request.header.x-broken': '[not json',
        'http.request.header.x-count': 3,
        'http.request.header.x-object': { a: 1 },
      }).map(header => header.value),
    ).toEqual(['0123', '"abc"', '[not json', '3', '{"a":1}']);
  });
});

describe('firstHttpHeaderValue', () => {
  const userAgent = (attributes: Record<string, unknown>) =>
    firstHttpHeaderValue(attributes, HTTP_REQUEST_HEADER_PREFIX, 'user-agent');

  it('matches the name case-insensitively and takes the first value', () => {
    expect(userAgent({ 'http.request.header.User_Agent': '["a","b"]' })).toBe(
      'a',
    );
  });

  it('skips empty values and other prefixes', () => {
    expect(
      userAgent({
        'http.request.header.user-agent': '',
        'http.response.header.user-agent': 'a',
      }),
    ).toBeUndefined();
  });
});

describe('getReplayableHeaders', () => {
  it('drops trace context, Host, Content-Length and connection headers', () => {
    const headers = parseRequestHeaders({
      'http.request.header.traceparent': '["00-0d98-cef1-01"]',
      'http.request.header.Host': 'localhost:3001',
      'http.request.header.content-length': '["90"]',
      'http.request.header.content-type': '["application/json"]',
      'http.request.header.baggage': 'tenant=acme',
    });
    expect(getReplayableHeaders(headers).map(header => header.name)).toEqual([
      'content-type',
      'baggage',
    ]);
  });
});

describe('toHeaderDisplayCase', () => {
  it('capitalizes each dash-separated word and keeps the attribute key', () => {
    expect(
      toHeaderDisplayCase({
        name: 'x-forwarded-for',
        value: '1.2.3.4',
        attributeKey: 'http.request.header.x_forwarded_for',
      }),
    ).toEqual({
      name: 'X-Forwarded-For',
      value: '1.2.3.4',
      attributeKey: 'http.request.header.x_forwarded_for',
    });
  });
});
