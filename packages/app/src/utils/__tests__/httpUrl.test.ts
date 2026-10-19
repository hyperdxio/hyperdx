import { getHttpUrl } from '@/utils/httpUrl';

describe('getHttpUrl', () => {
  const stable = {
    'url.scheme': 'https',
    'server.address': 'new-example.clickhouse.com',
    'url.path': '/a',
  };

  it.each([
    [
      'url.full over everything else',
      { ...stable, 'url.full': 'https://full-example.clickhouse.com/a' },
      'https://full-example.clickhouse.com/a',
    ],
    [
      'an absolute stable rebuild over http.url',
      {
        ...stable,
        'url.query': '?b=1',
        'http.url': 'https://old-example.clickhouse.com',
      },
      'https://new-example.clickhouse.com/a?b=1',
    ],
    [
      'http.url over a relative stable rebuild',
      { 'url.scheme': 'http', 'url.path': '/a', 'http.url': 'http://e.com/a' },
      'http://e.com/a',
    ],
    [
      'http.url when the other values are empty',
      { 'url.full': '', 'url.path': '', 'http.url': 'http://e.com/a' },
      'http://e.com/a',
    ],
    [
      'the path and query without a host',
      { 'url.path': '/users', 'url.query': 'id=1' },
      '/users?id=1',
    ],
    ['nothing without a URL attribute', { 'http.method': 'GET' }, undefined],
  ])('returns %s', (_case, attributes, expected) => {
    expect(getHttpUrl(attributes)).toBe(expected);
  });

  it.each([
    [
      'HTTPS',
      'api-example.clickhouse.com',
      443,
      'HTTPS://api-example.clickhouse.com/a',
    ],
    ['http', 'localhost', 8080, 'http://localhost:8080/a'],
    ['http', '::1', 8080, 'http://[::1]:8080/a'],
    ['http', '[::1]', undefined, 'http://[::1]/a'],
    ['http', 'localhost:5000', 5000, 'http://localhost:5000/a'],
    ['http', '[::1]:8000', 8000, 'http://[::1]:8000/a'],
  ])('joins %s, %s and port %p', (scheme, address, port, expected) => {
    expect(
      getHttpUrl({
        'url.scheme': scheme,
        'server.address': address,
        'server.port': port,
        'url.path': '/a',
      }),
    ).toBe(expected);
  });

  describe('pre-1.21 spans', () => {
    it.each([
      [{ 'http.host': 'h.io:81', 'net.host.name': 'x' }, 'http://h.io:81/a'],
      [{ 'net.host.name': 'h.io', 'net.host.port': 81 }, 'http://h.io:81/a'],
      [{ 'http.server_name': 'h.io', 'net.host.port': '80' }, 'http://h.io/a'],
      [{ 'net.peer.name': 'h.io', 'net.peer.port': 81 }, 'http://h.io:81/a'],
      [{ 'http.host': 'h.io', 'net.peer.name': 'client' }, 'http://h.io/a'],
      [{ 'server.address': 'h.io', 'http.host': 'old.io' }, 'http://h.io/a'],
    ])('rebuilds from http.target and %o', (host, expected) => {
      expect(
        getHttpUrl({ 'http.scheme': 'http', 'http.target': '/a', ...host }),
      ).toBe(expected);
    });

    it.each([
      [
        'http.url over the parts of an OTel JS client span without a scheme',
        {
          'http.url': 'https://api-example.clickhouse.com/v1/users?x=1',
          'http.target': '/v1/users?x=1',
          'http.host': 'api-example.clickhouse.com:443',
        },
        'https://api-example.clickhouse.com/v1/users?x=1',
      ],
      [
        'http.url over an ASGI http.target without the query',
        {
          'http.scheme': 'http',
          'http.host': 'localhost:8000',
          'http.target': '/items',
          'http.url': 'http://localhost:8000/items?q=shoes',
        },
        'http://localhost:8000/items?q=shoes',
      ],
      [
        'url.path and url.query over http.target',
        { 'url.path': '/new', 'url.query': 'a=1', 'http.target': '/old?b=2' },
        '/new?a=1',
      ],
      [
        'an absolute-form http.target as is',
        {
          'http.host': 'proxy:3128',
          'http.target': 'http://up-example.clickhouse.com/a',
        },
        'http://up-example.clickhouse.com/a',
      ],
      ['http.target alone without a host', { 'http.target': '/a' }, '/a'],
    ])('returns %s', (_case, attributes, expected) => {
      expect(getHttpUrl(attributes)).toBe(expected);
    });
  });
});
