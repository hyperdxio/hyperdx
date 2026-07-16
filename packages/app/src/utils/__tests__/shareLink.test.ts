import {
  buildShareUrl,
  decodeShareToken,
  encodeShareToken,
  freezeTimeRange,
  SHARE_PARAM,
} from '@/utils/shareLink';

describe('shareLink', () => {
  // Mimic a real nuqs-serialized search URL: repeated keys + double
  // percent-encoding (parseAsStringEncoded / parseAsJsonEncoded). That double
  // encoding + JSON redundancy is what makes real links huge, and what
  // compression crushes.
  const doubleEncode = (s: string) => encodeURIComponent(encodeURIComponent(s));
  const FILTERS = JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({
      type: 'sql',
      condition: `ResourceAttributes['service.name'] = 'checkout-service-${i}'`,
    })),
  );
  const SAMPLE_SEARCH = [
    'source=6a1e2b5502d0c8cdc7aa88ea',
    'whereLanguage=lucene',
    `where=${doubleEncode('ServiceName:"granola-app" SeverityText:"error" Body:"cache-sequence-mismatch"')}`,
    `filters=${doubleEncode(FILTERS)}`,
    'from=1784109836561',
    'to=1784111636565',
    'isLive=false',
  ].join('&');

  describe('encode/decode round-trip', () => {
    it('returns the original query string', async () => {
      const token = await encodeShareToken(SAMPLE_SEARCH);
      expect(await decodeShareToken(token)).toBe(SAMPLE_SEARCH);
    });

    it('produces a URL-safe token (base64url alphabet only)', async () => {
      const token = await encodeShareToken(SAMPLE_SEARCH);
      // No '+', '/', '=' or space, so it survives the URL bar untouched.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('decodeShareToken', () => {
    it('returns null for an empty token', async () => {
      expect(await decodeShareToken('')).toBeNull();
    });

    it('returns null (never throws) on a malformed token', async () => {
      await expect(decodeShareToken('#not-a-valid-token#')).resolves.toBeNull();
      const truncated = (await encodeShareToken('x')).slice(0, 2);
      await expect(decodeShareToken(truncated)).resolves.toBeNull();
    });
  });

  describe('encodeShareToken', () => {
    it('produces a token shorter than the raw query string', async () => {
      // The whole point of the feature: a compressed token is meaningfully
      // shorter than the (double percent-encoded) raw query string.
      const token = await encodeShareToken(SAMPLE_SEARCH);
      expect(token.length).toBeLessThan(SAMPLE_SEARCH.length);
    });
  });

  describe('buildShareUrl', () => {
    it('compresses a large query string into a share token that decodes back', async () => {
      const url = await buildShareUrl(SAMPLE_SEARCH);
      const parsed = new URL(url);
      expect(parsed.origin).toBe(window.location.origin);
      expect(parsed.pathname).toBe(window.location.pathname);

      const token = parsed.searchParams.get(SHARE_PARAM);
      expect(token).not.toBeNull();
      expect(await decodeShareToken(token ?? '')).toBe(SAMPLE_SEARCH);
    });

    it('returns a plain URL (no compression) when the query string is small', async () => {
      // Path-identified pages (e.g. /dashboards/<id>) have tiny transient
      // state, so compression would make the link longer — keep it plain.
      const url = await buildShareUrl(
        'from=1784109836561&to=1784111636565&isLive=false',
      );
      expect(url).not.toContain(`${SHARE_PARAM}=`);
      const parsed = new URL(url);
      expect(parsed.searchParams.get('from')).toBe('1784109836561');
      expect(parsed.searchParams.get('isLive')).toBe('false');
    });

    it('strips a leading "?" so it accepts window.location.search directly', async () => {
      const url = await buildShareUrl('?from=1&to=2');
      expect(url).not.toContain('??');
      expect(new URL(url).searchParams.get('from')).toBe('1');
    });

    it('drops empty and duplicate params without touching survivors', async () => {
      const url = await buildShareUrl(
        'source=abc&where=&select=&filters=%255B%255D&source=xyz&from=1',
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('where')).toBeNull();
      expect(parsed.searchParams.get('select')).toBeNull();
      expect(parsed.searchParams.get('filters')).toBeNull();
      // Duplicate key keeps the first occurrence (matches nuqs `.get()`).
      expect(parsed.searchParams.getAll('source')).toEqual(['abc']);
      expect(parsed.searchParams.get('from')).toBe('1');
    });
  });

  describe('freezeTimeRange', () => {
    it('pins absolute from/to, drops tq, disables live, and keeps other params', () => {
      const from = new Date(1784109836561);
      const to = new Date(1784111636565);
      const out = freezeTimeRange('tq=Past+1h&source=abc&isLive=true', [
        from,
        to,
      ]);
      const params = new URLSearchParams(out);

      expect(params.get('tq')).toBeNull();
      expect(params.get('from')).toBe(String(from.getTime()));
      expect(params.get('to')).toBe(String(to.getTime()));
      expect(params.get('isLive')).toBe('false');
      expect(params.get('source')).toBe('abc');
    });
  });
});
