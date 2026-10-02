import {
  dashboardETag,
  parseIfMatch,
  parseVersionToken,
  versionFilter,
  versionToken,
} from '@/utils/dashboardVersion';

const V = 7;

describe('versionToken', () => {
  it('serializes version as a decimal string', () => {
    expect(versionToken({ version: V })).toBe('7');
  });
});

describe('parseVersionToken', () => {
  it('round-trips a token emitted by versionToken', () => {
    expect(parseVersionToken(versionToken({ version: V }))).toBe(V);
  });

  it('accepts 0', () => {
    expect(parseVersionToken('0')).toBe(0);
  });

  // A loose parse (e.g. accepting whitespace, a decimal, or a sign) turns a
  // client's malformed token into a bogus "someone else edited this"
  // instead of the client error it is.
  it.each(['', 'abc', '1.5', '-1', '01', ' 1', '1 '])('rejects %p', raw => {
    expect(parseVersionToken(raw)).toBeNull();
  });

  it('rejects a value beyond Number.MAX_SAFE_INTEGER', () => {
    expect(parseVersionToken(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });

  it('accepts Number.MAX_SAFE_INTEGER', () => {
    expect(parseVersionToken(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe('versionFilter', () => {
  // Token "0" has to match both a pre-migration document (no `version`
  // field at all) and a backfilled one (`version: 0`) — only `null` matches
  // a missing field in Mongo, so both are listed explicitly.
  it('matches 0 or a missing field for token 0', () => {
    expect(versionFilter(0)).toEqual({ version: { $in: [0, null] } });
  });

  it('matches exactly for a non-zero token', () => {
    expect(versionFilter(V)).toEqual({ version: V });
  });
});

describe('dashboardETag', () => {
  it('emits a strong quoted etag', () => {
    expect(dashboardETag({ version: V })).toBe('"7"');
  });
});

describe('parseIfMatch', () => {
  it('accepts a quoted strong etag', () => {
    expect(parseIfMatch('"7"')).toBe(7);
  });

  it('accepts a weak etag prefix', () => {
    expect(parseIfMatch('W/"7"')).toBe(7);
  });

  it('accepts an unquoted token', () => {
    expect(parseIfMatch('7')).toBe(7);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseIfMatch('  "7" ')).toBe(7);
  });

  it('treats * as match-any', () => {
    expect(parseIfMatch('*')).toBe('*');
  });

  it('rejects a comma-separated list', () => {
    expect(parseIfMatch('"7", "*"')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseIfMatch('not-an-etag')).toBeNull();
  });
});
