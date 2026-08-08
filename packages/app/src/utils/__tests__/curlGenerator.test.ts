import { CurlGenerator } from '@/utils/curlGenerator';

describe('CurlGenerator', () => {
  it('quotes the url so a query string stays part of the command', () => {
    expect(
      CurlGenerator({
        method: 'GET',
        headers: [['accept', 'application/json']],
        url: 'https://api.example.com/v1/search?q=checkout&page=2',
      }),
    ).toBe(
      "curl 'https://api.example.com/v1/search?q=checkout&page=2' \\\n" +
        ' -X GET \\\n' +
        '-H "accept: application/json"',
    );
  });

  it.each([
    ['https://api.example.com/a b'],
    ['https://api.example.com/?q=$(id)'],
    ['https://api.example.com/?q=a;id'],
  ])('quotes the shell metacharacters in %p', url => {
    expect(CurlGenerator({ method: 'GET', url })).toBe(
      `curl '${url}' \\\n -X GET`,
    );
  });

  it('uses ansi-c quoting for a url containing a single quote', () => {
    expect(
      CurlGenerator({ method: 'GET', url: "https://api.example.com/?q='x'" }),
    ).toBe("curl $'https://api.example.com/?q=\\'x\\'' \\\n -X GET");
  });
});
