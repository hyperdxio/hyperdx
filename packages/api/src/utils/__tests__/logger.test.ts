import pino from 'pino';
import { Writable } from 'stream';

import { REDACTED_PATHS, scrubUrlTokens } from '@/utils/logger';

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
