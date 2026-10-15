import { writeProxyBody } from '@/utils/proxyBody';

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

describe('parsed proxy request bodies', () => {
  it.each([undefined, false])(
    'leaves unconsumed multipart streams alone (_body=%s)',
    parsed => {
      const proxy = makeProxyRequest();
      writeProxyBody(proxy, {
        headers: { 'content-type': 'multipart/form-data; boundary=test' },
        body: {},
        _body: parsed,
      });
      expect(proxy.write).not.toHaveBeenCalled();
      expect(proxy.setHeader).not.toHaveBeenCalled();
      expect(proxy.destroy).not.toHaveBeenCalled();
    },
  );

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON; Charset=UTF-8',
  ])('serializes parsed %s and frames UTF-8 bytes', contentType => {
    const proxy = makeProxyRequest();
    writeProxyBody(proxy, {
      headers: { 'content-type': contentType },
      body: { query: "SELECT 'café'" },
      _body: true,
    });
    const expected = '{"query":"SELECT \'café\'"}';
    expect(proxy.write).toHaveBeenCalledWith(expected);
    expect(proxy.setHeader).toHaveBeenCalledWith(
      'content-length',
      Buffer.byteLength(expected),
    );
    expect(proxy.destroy).not.toHaveBeenCalled();
  });

  it('preserves repeated form fields and empty values', () => {
    const proxy = makeProxyRequest();
    writeProxyBody(proxy, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: { query: 'SELECT 1', param: ['a+b', 'c d'], empty: '' },
      _body: true,
    });
    expect(proxy.write).toHaveBeenCalledWith(
      'query=SELECT+1&param=a%2Bb&param=c+d&empty=',
    );
  });

  it.each(['', 'SELECT 1', Buffer.from([0, 255, 10])])(
    'preserves parsed text and buffer payloads (%s)',
    body => {
      const proxy = makeProxyRequest();
      writeProxyBody(proxy, { headers: {}, body, _body: true });
      expect(proxy.write).toHaveBeenCalledWith(body);
      expect(proxy.setHeader).toHaveBeenCalledWith(
        'content-length',
        Buffer.byteLength(body),
      );
    },
  );

  it('keeps chunked framing without a conflicting content length', () => {
    const proxy = makeProxyRequest();
    proxy.getHeader.mockReturnValue('chunked');
    writeProxyBody(proxy, {
      headers: { 'content-type': 'application/json' },
      body: { query: 'SELECT 1' },
      _body: true,
    });
    expect(proxy.removeHeader).toHaveBeenCalledWith('content-length');
    expect(proxy.setHeader).not.toHaveBeenCalled();
    expect(proxy.write).toHaveBeenCalledWith('{"query":"SELECT 1"}');
  });

  it('destroys the upstream request when a body write fails', () => {
    const proxy = makeProxyRequest();
    const error = new Error('write failed');
    proxy.write.mockImplementation(() => {
      throw error;
    });
    writeProxyBody(proxy, { headers: {}, body: 'SELECT 1', _body: true });
    expect(proxy.destroy).toHaveBeenCalledWith(error);
  });

  it('updates encoding metadata after the parser decoded the payload', () => {
    const proxy = makeProxyRequest();
    writeProxyBody(proxy, {
      headers: {
        'content-type': 'application/json; charset="utf-16le"',
        'content-encoding': 'gzip',
      },
      body: { query: 'SELECT 1' },
      _body: true,
    });
    expect(proxy.removeHeader).toHaveBeenCalledWith('content-encoding');
    expect(proxy.setHeader).toHaveBeenCalledWith(
      'content-type',
      'application/json; charset=utf-8',
    );
    expect(proxy.write).toHaveBeenCalledWith('{"query":"SELECT 1"}');
  });

  it('destroys the upstream request when JSON serialization fails', () => {
    const proxy = makeProxyRequest();
    const body: { self?: unknown } = {};
    body.self = body;
    writeProxyBody(proxy, {
      headers: { 'content-type': 'application/json' },
      body,
      _body: true,
    });
    expect(proxy.destroy).toHaveBeenCalledWith(expect.any(TypeError));
    expect(proxy.write).not.toHaveBeenCalled();
  });
});
