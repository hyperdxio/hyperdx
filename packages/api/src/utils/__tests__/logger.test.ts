import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'stream';

import {
  REDACTED_PATHS,
  scrubbedRequestSerializer,
  scrubUrlTokens,
} from '@/utils/logger';

/**
 * A wrong redact path fails silently — pino censors nothing and throws
 * nothing — so the config needs its own guard. This asserts against a real
 * pino instance using the exported paths, shaped like pino-http's default
 * request serializer output.
 */
describe('logger redaction', () => {
  function logAndCapture(obj: Record<string, unknown>): string {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    logger.info(obj, 'test');
    return out;
  }

  it('censors the Authorization header', () => {
    const out = logAndCapture({
      req: { headers: { authorization: 'Bearer super-secret-key' } },
    });

    expect(out).not.toContain('super-secret-key');
    expect(out).toContain('[REDACTED]');
  });

  it('censors request cookies and response set-cookie', () => {
    const out = logAndCapture({
      req: { headers: { cookie: 'connect.sid=secret-session' } },
      res: { headers: { 'set-cookie': 'connect.sid=another-secret' } },
    });

    expect(out).not.toContain('secret-session');
    expect(out).not.toContain('another-secret');
  });

  it('censors a redirect Location header', () => {
    const out = logAndCapture({
      res: { headers: { location: '/ext/silence-alert/secret-token' } },
    });

    expect(out).not.toContain('secret-token');
  });

  it('leaves non-credential headers intact', () => {
    const out = logAndCapture({
      req: { headers: { 'user-agent': 'jest', authorization: 'Bearer x' } },
    });

    expect(out).toContain('jest');
  });
});

/**
 * `redact` addresses object paths, so a token living inside a URL string is
 * out of its reach. These two routes take a standalone bearer credential as a
 * path segment.
 */
describe('scrubUrlTokens', () => {
  it.each([
    ['/ext/silence-alert/abc123', '/ext/silence-alert/[REDACTED]'],
    ['/team/setup/tok-xyz', '/team/setup/[REDACTED]'],
    ['/api/ext/silence-alert/abc123', '/api/ext/silence-alert/[REDACTED]'],
    // Query strings and fragments must not be swallowed into the token.
    ['/ext/silence-alert/abc123?x=1', '/ext/silence-alert/[REDACTED]?x=1'],
  ])('scrubs %s', (input, expected) => {
    expect(scrubUrlTokens(input)).toBe(expected);
  });

  it('leaves unrelated URLs untouched', () => {
    expect(scrubUrlTokens('/api/v2/dashboards/655b1b7d9143aa1b1b73f4f4')).toBe(
      '/api/v2/dashboards/655b1b7d9143aa1b1b73f4f4',
    );
  });
});

/**
 * pino-http wraps this serializer, so it is handed an already-serialized
 * object rather than the raw IncomingMessage. Feeding it the wrapper's actual
 * input pins that contract: re-running `pino.stdSerializers.req` inside would
 * resolve `remoteAddress`/`remotePort` from a `socket` that is no longer there
 * and silently drop the client IP from every production request log.
 */
describe('scrubbedRequestSerializer', () => {
  // A real IncomingMessage over a real Socket rather than a cast object
  // literal: the point of this test is that the std serializer resolves the
  // client address off the socket, so a hand-shaped stand-in could satisfy the
  // assertions while diverging from what pino actually receives.
  // remoteAddress/remotePort are prototype getters on Socket, hence
  // defineProperty rather than assignment.
  const rawRequest = () => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.7' });
    Object.defineProperty(socket, 'remotePort', { value: 51234 });

    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/api/ext/silence-alert/super-secret-token?ack=1';
    req.headers = { authorization: 'Bearer x' };
    return req;
  };

  it('scrubs the URL without dropping the client address', () => {
    const out = scrubbedRequestSerializer(
      pino.stdSerializers.req(rawRequest()),
    );

    expect(out.url).toBe('/api/ext/silence-alert/[REDACTED]?ack=1');
    expect(out.remoteAddress).toBe('203.0.113.7');
    expect(out.remotePort).toBe(51234);
    expect(out.method).toBe('GET');
    expect(out.headers).toEqual({ authorization: 'Bearer x' });
  });
});

/**
 * The three pieces above are each tested in isolation, but the thing that
 * actually ships is their composition: pino's `redact` paths, pino-http's
 * `wrapRequestSerializer`, and `scrubbedRequestSerializer`. That combination is
 * never exercised elsewhere — the production serializer branch is selected only
 * when `!IS_DEV && !IS_CI`, and `IS_CI` is true under Jest — so a change to any
 * one of them could drop a credential into stdout with every other test still
 * green. Build the real thing and read the bytes.
 */
describe('production log line', () => {
  function captureRequestLog(req: IncomingMessage): string {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    // Mirrors the production wiring in logger.ts: same redact config, same
    // serializer, and pino-http's default wrapSerializers behaviour.
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    const middleware = pinoHttp({
      logger,
      serializers: { req: scrubbedRequestSerializer },
    });

    const res = new ServerResponse(req);
    middleware(req, res);
    res.setHeader('set-cookie', 'connect.sid=rotated-session');
    res.statusCode = 200;
    res.emit('finish');

    return out;
  }

  it('emits no plaintext credential and no URL token', () => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.7' });
    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/api/ext/silence-alert/super-secret-token';
    req.headers = {
      authorization: 'Bearer super-secret-key',
      cookie: 'connect.sid=secret-session',
      'user-agent': 'jest',
    };

    const out = captureRequestLog(req);

    expect(out).not.toContain('super-secret-key');
    expect(out).not.toContain('secret-session');
    expect(out).not.toContain('rotated-session');
    expect(out).not.toContain('super-secret-token');
    expect(out).toContain('[REDACTED]');
    // Still a useful log line: the non-credential parts survive.
    expect(out).toContain('jest');
    expect(out).toContain('203.0.113.7');
  });
});
