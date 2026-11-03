import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

import logger from '@/utils/logger';
import { captureProxyBody, writeProxyBody } from '@/utils/proxyBody';

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

const makeProxyRequest = () => ({
  getHeader: jest.fn(),
  setHeader: jest.fn(),
  removeHeader: jest.fn(),
  write: jest.fn().mockReturnValue(true),
  destroy: jest.fn().mockReturnThis(),
});

describe('ClickHouse proxy body capture', () => {
  const makeRequest = (
    path?: string,
    url?: string,
  ): Parameters<typeof captureProxyBody>[0] =>
    Object.assign(new IncomingMessage(new Socket()), { path, url });
  const response = new ServerResponse(new IncomingMessage(new Socket()));

  it.each([
    { path: '/clickhouse-proxy', url: '/clickhouse-proxy' },
    { path: '/CLICKHOUSE-PROXY', url: '/CLICKHOUSE-PROXY' },
    { path: '/clickhouse-proxy/', url: '/clickhouse-proxy/' },
    {
      path: '/clickhouse-proxy',
      url: '/clickhouse-proxy?query=SELECT%201',
    },
    {
      path: '/clickhouse-proxy/database',
      url: '/clickhouse-proxy/database?query=SELECT%201',
    },
    {
      path: '/clickhouse-proxy',
      url: 'http://localhost/clickhouse-proxy?query=SELECT%201',
    },
  ])('retains the inflated bytes for $url', ({ path, url }) => {
    const req = makeRequest(path, url);
    const body = Buffer.from('{ "value": 9007199254740993, "scale": 1.000 }');

    captureProxyBody(req, response, body);

    expect(req._hdxProxyBody).toBe(body);
  });

  it.each([
    undefined,
    '',
    '/clickhouse-proxy-other',
    '/login',
    '/api/clickhouse-proxy',
  ])('does not retain bodies for unrelated path %s', path => {
    const req = makeRequest(path);

    captureProxyBody(req, response, Buffer.from('private body'));

    expect(req._hdxProxyBody).toBeUndefined();
  });
});

describe('captured proxy request bodies', () => {
  it('leaves an unconsumed stream alone', () => {
    const proxy = makeProxyRequest();

    writeProxyBody(proxy, { headers: {} });

    expect(proxy.write).not.toHaveBeenCalled();
    expect(proxy.getHeader).not.toHaveBeenCalled();
    expect(proxy.setHeader).not.toHaveBeenCalled();
    expect(proxy.removeHeader).not.toHaveBeenCalled();
    expect(proxy.destroy).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    'does not reconstruct a body without captured bytes (_body=%s)',
    parsed => {
      const proxy = makeProxyRequest();
      const req = {
        headers: {},
        _hdxProxyBody: undefined,
        body: { query: 'SELECT 1' },
        _body: parsed,
      };

      writeProxyBody(proxy, req);

      expect(proxy.write).not.toHaveBeenCalled();
      expect(proxy.setHeader).not.toHaveBeenCalled();
      expect(proxy.removeHeader).not.toHaveBeenCalled();
      expect(proxy.destroy).not.toHaveBeenCalled();
    },
  );

  it('destroys the upstream request when a parsed body was not captured', () => {
    const proxy = makeProxyRequest();
    const req = {
      headers: {},
      _hdxProxyBody: undefined,
      body: { query: 'SELECT 1' },
      _body: true,
    };

    writeProxyBody(proxy, req);

    expect(proxy.write).not.toHaveBeenCalled();
    expect(proxy.setHeader).not.toHaveBeenCalled();
    expect(proxy.destroy).toHaveBeenCalledTimes(1);
    const [[error]] = proxy.destroy.mock.calls;
    expect(error).toBeInstanceOf(Error);
    expect(logger.error).toHaveBeenCalledWith(
      { err: error },
      expect.any(String),
    );
  });

  it.each<[string, Buffer]>([
    [
      'JSON number spelling and whitespace',
      Buffer.from('{ "value": 9007199254740993, "scale": 1.000 }'),
    ],
    [
      'form field spelling and repeated values',
      Buffer.from('query=SELECT%201&param=a%2bb&param=c+d&empty='),
    ],
    ['binary bytes', Buffer.from([0, 255, 10])],
  ])('preserves %s', (_description, body) => {
    const proxy = makeProxyRequest();

    writeProxyBody(proxy, { headers: {}, _hdxProxyBody: body });

    expect(proxy.write).toHaveBeenCalledTimes(1);
    expect(proxy.write).toHaveBeenCalledWith(body);
    expect(proxy.setHeader).toHaveBeenCalledWith('content-length', body.length);
    expect(proxy.destroy).not.toHaveBeenCalled();
  });

  it('forwards an empty captured body with a zero content length', () => {
    const proxy = makeProxyRequest();
    const body = Buffer.alloc(0);

    writeProxyBody(proxy, { headers: {}, _hdxProxyBody: body });

    expect(proxy.write).toHaveBeenCalledWith(body);
    expect(proxy.setHeader).toHaveBeenCalledWith('content-length', 0);
    expect(proxy.destroy).not.toHaveBeenCalled();
  });

  it('uses the captured bytes instead of the parsed body', () => {
    const proxy = makeProxyRequest();
    const body = Buffer.from('{ "value": 9007199254740993 }');
    const req = {
      headers: {},
      _hdxProxyBody: body,
      body: { value: 9007199254740992 },
      _body: true,
    };

    writeProxyBody(proxy, req);

    expect(proxy.write).toHaveBeenCalledWith(body);
  });

  it('frames the byte length of a multibyte payload', () => {
    const proxy = makeProxyRequest();
    const text = "SELECT 'café'";
    const body = Buffer.from(text);

    writeProxyBody(proxy, { headers: {}, _hdxProxyBody: body });

    expect(body.length).toBeGreaterThan(text.length);
    expect(proxy.setHeader).toHaveBeenCalledWith('content-length', body.length);
    expect(proxy.write).toHaveBeenCalledWith(body);
  });

  it('removes compression metadata and preserves the original charset', () => {
    const proxy = makeProxyRequest();
    const body = Buffer.from("SELECT 'café'", 'utf16le');
    const req = {
      _hdxProxyBody: body,
      headers: {
        'content-type': 'text/plain; charset="utf-16le"',
        'content-encoding': 'gzip',
      },
    };

    writeProxyBody(proxy, req);

    expect(proxy.removeHeader).toHaveBeenCalledWith('content-encoding');
    expect(proxy.removeHeader).not.toHaveBeenCalledWith('content-type');
    expect(proxy.setHeader).toHaveBeenCalledTimes(1);
    expect(proxy.setHeader).toHaveBeenCalledWith('content-length', body.length);
    expect(proxy.write).toHaveBeenCalledWith(body);
  });

  it('keeps transfer encoding without a conflicting content length', () => {
    const proxy = makeProxyRequest();
    const body = Buffer.from('SELECT 1');
    proxy.getHeader.mockReturnValue('chunked');

    writeProxyBody(proxy, { headers: {}, _hdxProxyBody: body });

    expect(proxy.getHeader).toHaveBeenCalledWith('transfer-encoding');
    expect(proxy.removeHeader).toHaveBeenCalledWith('content-length');
    expect(proxy.removeHeader).toHaveBeenCalledWith('content-encoding');
    expect(proxy.setHeader).not.toHaveBeenCalled();
    expect(proxy.write).toHaveBeenCalledWith(body);
  });

  it('destroys the upstream request when a body write fails', () => {
    const proxy = makeProxyRequest();
    const error = new Error('write failed');
    proxy.write.mockImplementation(() => {
      throw error;
    });

    writeProxyBody(proxy, {
      headers: {},
      _hdxProxyBody: Buffer.from('SELECT 1'),
    });

    expect(proxy.destroy).toHaveBeenCalledWith(error);
  });
});
