import { getHttpUrl, isAbsoluteHttpUrl } from '@/utils/httpUrl';

const server = (address: string, port?: number) => ({
  'url.scheme': 'http',
  'server.address': address,
  'server.port': port,
  'url.path': '/a',
});
const target = { 'http.scheme': 'http', 'http.target': '/a' };

it.each([
  [{ ...server('h.io'), 'url.full': 'https://f.io' }, 'https://f.io'],
  [
    { ...server('h.io', 80), 'url.query': '?b=1', 'http.url': 'http://u.io' },
    'http://h.io/a?b=1',
  ],
  [{ 'url.path': '/a', 'http.url': 'http://u.io/a' }, 'http://u.io/a'],
  [server('localhost:5000', 5000), 'http://localhost:5000/a'],
  [server('[::1]:8000', 8000), 'http://[::1]:8000/a'],
  [server('::1', 8080), 'http://[::1]:8080/a'],
  [{ ...target, 'http.host': 'h.io', 'net.peer.name': 'c' }, 'http://h.io/a'],
  [
    { ...target, 'net.peer.name': 'h.io', 'net.peer.port': 81 },
    'http://h.io:81/a',
  ],
  [
    { ...target, 'http.target': 'http://u.io/a', 'http.host': 'p' },
    'http://u.io/a',
  ],
  // OTel JS's Node http client sends no http.scheme.
  [
    {
      'http.url': 'https://h.io/a',
      'http.target': '/a',
      'http.host': 'h.io:443',
    },
    'https://h.io/a',
  ],
  // ASGI's http.target drops the query.
  [
    { ...target, 'http.host': 'h.io', 'http.url': 'http://h.io/a?q=1' },
    'http://h.io/a?q=1',
  ],
])('getHttpUrl(%o) is %p', (attributes, expected) => {
  expect(getHttpUrl(attributes)).toBe(expected);
});

it('isAbsoluteHttpUrl needs an http(s) scheme', () => {
  expect(isAbsoluteHttpUrl('HTTPS://h.io')).toBe(true);
  expect(isAbsoluteHttpUrl('h.io:443/a')).toBe(false);
});
