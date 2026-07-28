import pino from 'pino';
import { Writable } from 'stream';

import { REDACTED_PATHS } from '@/utils/logger';

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

  it('leaves non-credential headers intact', () => {
    const out = logAndCapture({
      req: { headers: { 'user-agent': 'jest', authorization: 'Bearer x' } },
    });

    expect(out).toContain('jest');
  });
});
