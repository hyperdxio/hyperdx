import { CurlGenerator } from '@/utils/curlGenerator';

const url = 'https://example.com';

describe('CurlGenerator', () => {
  it.each([
    ['post', '-X POST'],
    ['PROPFIND', '-X PROPFIND'],
    ['GET;rm', "-X 'GET;RM'"],
  ])('emits the method %s as %s', (method, expected) => {
    expect(CurlGenerator({ url, method })).toContain(expected);
  });

  it('omits -X without a method', () => {
    expect(CurlGenerator({ url })).not.toContain('-X');
  });

  it('emits one -H per header, including repeated names', () => {
    const curl = CurlGenerator({
      url,
      headers: [
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b="2"'],
      ],
    });
    expect(curl).toContain('-H "set-cookie: a=1"');
    expect(curl).toContain('-H "set-cookie: b=\\"2\\""');
  });

  it('sends string bodies raw and object bodies as JSON', () => {
    expect(CurlGenerator({ url, body: 'a=1&b=2' })).toContain(
      "--data-raw 'a=1&b=2'",
    );
    expect(CurlGenerator({ url, body: { a: 1 } })).toContain(
      '-d "{\\"a\\":1}"',
    );
  });
});
