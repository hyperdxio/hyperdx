import { CurlGenerator } from '@/utils/curlGenerator';

const url = 'https://example.com';

it.each([
  ['propfind', '-X PROPFIND'],
  ['GET;rm', "-X 'GET;RM'"],
])('CurlGenerator sends the method %p as %s', (method, expected) => {
  expect(CurlGenerator({ url, method })).toContain(expected);
});

it('CurlGenerator omits -X without a method', () => {
  expect(CurlGenerator({ url })).not.toContain('-X');
});

it('CurlGenerator keeps repeated header names', () => {
  const curl = CurlGenerator({
    url,
    headers: [
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ],
  });
  expect(curl).toContain('-H "set-cookie: a=1"');
  expect(curl).toContain('-H "set-cookie: b=2"');
});
