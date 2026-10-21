import {
  firstHttpHeaderValue,
  getReplayableHeaders,
  HTTP_REQUEST_HEADER_PREFIX,
  parseHttpHeaders,
  toHeaderDisplayCase,
} from '@/utils/httpHeaders';

it('parseHttpHeaders reads one prefix, one entry per array value', () => {
  const headers = parseHttpHeaders(
    {
      'http.request.header.x_id': '["a","b"]',
      'http.request.header.etag': '"c"',
      'http.request.header.age': '0123',
      'http.response.header.server': 'd',
    },
    HTTP_REQUEST_HEADER_PREFIX,
  );
  expect(headers.map(({ name, value }) => `${name}: ${value}`)).toEqual([
    'x-id: a',
    'x-id: b',
    'etag: "c"',
    'age: 0123',
  ]);
  expect(headers[0].attributeKey).toBe('http.request.header.x_id');
});

it('firstHttpHeaderValue ignores case and empty values', () => {
  expect(
    firstHttpHeaderValue(
      {
        'http.request.header.user-agent': '',
        'http.request.header.User_Agent': '["a","b"]',
      },
      HTTP_REQUEST_HEADER_PREFIX,
      'user-agent',
    ),
  ).toBe('a');
});

it('toHeaderDisplayCase capitalizes each word of the name', () => {
  const header = { name: 'x-forwarded-for', value: 'a', attributeKey: 'k' };
  expect(toHeaderDisplayCase(header)).toEqual({
    ...header,
    name: 'X-Forwarded-For',
  });
});

it('getReplayableHeaders drops trace context, Host and Content-Length', () => {
  const headers = ['traceparent', 'Host', 'content-length', 'baggage'].map(
    name => ({ name, value: 'a', attributeKey: name }),
  );
  expect(getReplayableHeaders(headers).map(({ name }) => name)).toEqual([
    'baggage',
  ]);
});
