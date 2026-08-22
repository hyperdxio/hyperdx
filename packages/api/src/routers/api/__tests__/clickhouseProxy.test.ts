import { planProxyBody } from '@/routers/api/clickhouseProxy';

/**
 * `bodyWasParsed` mirrors body-parser's `req._body`: true only when a parser
 * actually drained the stream. See planProxyBody's docblock for why the shape
 * of `req.body` cannot stand in for it.
 */
describe('planProxyBody', () => {
  describe('when no parser consumed the stream', () => {
    it('skips a multipart body-parser placeholder', () => {
      // body-parser sets `req.body = {}` before its content-type check, so an
      // untouched multipart request arrives looking like a parsed empty object.
      expect(
        planProxyBody('multipart/form-data; boundary=abc', {}, false),
      ).toEqual({ action: 'skip' });
    });

    it('skips when there is no content-type at all', () => {
      expect(planProxyBody(undefined, {}, false)).toEqual({ action: 'skip' });
    });

    it('skips even when the content-type looks parseable', () => {
      // `express.json()` bails out before reading when there is no body.
      expect(planProxyBody('application/json', {}, false)).toEqual({
        action: 'skip',
      });
    });
  });

  describe('string and buffer bodies', () => {
    it('writes a text/plain SQL body verbatim', () => {
      const sql = 'SELECT count() FROM system.tables FORMAT JSON';
      expect(planProxyBody('text/plain', sql, true)).toEqual({
        action: 'write',
        payload: sql,
      });
    });

    it('preserves an empty string body rather than skipping it', () => {
      expect(planProxyBody('text/plain', '', true)).toEqual({
        action: 'write',
        payload: '',
      });
    });

    it('writes a buffer body unchanged', () => {
      const buf = Buffer.from('SELECT 1');
      expect(planProxyBody('application/octet-stream', buf, true)).toEqual({
        action: 'write',
        payload: buf,
      });
    });

    it('skips a null body', () => {
      expect(planProxyBody('application/json', null, true)).toEqual({
        action: 'skip',
      });
    });
  });

  describe('json bodies', () => {
    const payload = { query: 'SELECT 1 FORMAT JSON' };

    it('serializes a bare application/json body', () => {
      expect(planProxyBody('application/json', payload, true)).toEqual({
        action: 'write',
        payload: JSON.stringify(payload),
      });
    });

    it.each([
      'application/json; charset=utf-8',
      'application/json;charset=UTF-8',
      'APPLICATION/JSON; charset=utf-8',
      'application/json ; charset=utf-8',
    ])('serializes charset-suffixed %s', contentType => {
      // The strict `=== 'application/json'` comparison this replaces missed
      // every one of these, leaving an object for `proxyReq.write` to throw on.
      expect(planProxyBody(contentType, payload, true)).toEqual({
        action: 'write',
        payload: JSON.stringify(payload),
      });
    });

    it('serializes an empty parsed object', () => {
      expect(planProxyBody('application/json', {}, true)).toEqual({
        action: 'write',
        payload: '{}',
      });
    });

    it('serializes an array body', () => {
      expect(planProxyBody('application/json', [1, 2], true)).toEqual({
        action: 'write',
        payload: '[1,2]',
      });
    });
  });

  describe('urlencoded bodies', () => {
    it('re-serializes a parsed form body', () => {
      const plan = planProxyBody(
        'application/x-www-form-urlencoded',
        { query: 'SELECT 1 FORMAT JSON', param_p0: 'a b&c' },
        true,
      );
      if (plan.action !== 'write') {
        throw new Error(`expected a write plan, got ${plan.action}`);
      }

      const forwarded = new URLSearchParams(String(plan.payload));
      expect(forwarded.get('query')).toBe('SELECT 1 FORMAT JSON');
      // Re-encoding has to survive a round trip, not just look plausible.
      expect(forwarded.get('param_p0')).toBe('a b&c');
    });

    it('honours a charset suffix on the form content-type', () => {
      expect(
        planProxyBody(
          'application/x-www-form-urlencoded; charset=utf-8',
          { a: '1' },
          true,
        ),
      ).toEqual({ action: 'write', payload: 'a=1' });
    });

    it('keeps repeated keys repeated instead of joining them', () => {
      // `new URLSearchParams({a: ['1','2']})` would emit `a=1%2C2`.
      expect(
        planProxyBody(
          'application/x-www-form-urlencoded',
          { a: ['1', '2'] },
          true,
        ),
      ).toEqual({ action: 'write', payload: 'a=1&a=2' });
    });

    it('drops undefined values', () => {
      expect(
        planProxyBody(
          'application/x-www-form-urlencoded',
          { a: '1', b: undefined },
          true,
        ),
      ).toEqual({ action: 'write', payload: 'a=1' });
    });
  });
});
