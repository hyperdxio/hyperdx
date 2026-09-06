import {
  dashboardETag,
  parseIfMatch,
  parseVersionToken,
  versionToken,
} from '@/utils/dashboardVersion';

const AT = new Date('2026-09-04T01:02:03.456Z');

describe('versionToken', () => {
  it('serializes updatedAt as an ISO-8601 string with milliseconds', () => {
    expect(versionToken({ updatedAt: AT })).toBe('2026-09-04T01:02:03.456Z');
  });
});

describe('parseVersionToken', () => {
  it('round-trips a token emitted by versionToken', () => {
    expect(parseVersionToken(versionToken({ updatedAt: AT }))?.getTime()).toBe(
      AT.getTime(),
    );
  });

  // A loose `new Date(raw)` accepts '2026' and '4 Sept 2026'. Those would
  // parse to a date that can never match a stored updatedAt, turning a
  // malformed token into a bogus "someone else edited this" instead of the
  // client error it is.
  it.each(['', '2026', '4 Sept 2026', '2026-09-04', '2026-09-04T01:02:03Z'])(
    'rejects %p',
    raw => {
      expect(parseVersionToken(raw)).toBeNull();
    },
  );

  it('rejects a well-shaped but impossible date', () => {
    expect(parseVersionToken('2026-99-99T01:02:03.456Z')).toBeNull();
  });
});

describe('dashboardETag', () => {
  it('emits a strong quoted etag', () => {
    expect(dashboardETag({ updatedAt: AT })).toBe('"2026-09-04T01:02:03.456Z"');
  });
});

describe('parseIfMatch', () => {
  it('accepts a quoted strong etag', () => {
    expect(parseIfMatch('"2026-09-04T01:02:03.456Z"')?.valueOf()).toBe(
      AT.getTime(),
    );
  });

  it('accepts a weak etag prefix', () => {
    expect(parseIfMatch('W/"2026-09-04T01:02:03.456Z"')?.valueOf()).toBe(
      AT.getTime(),
    );
  });

  it('accepts an unquoted token', () => {
    expect(parseIfMatch('2026-09-04T01:02:03.456Z')?.valueOf()).toBe(
      AT.getTime(),
    );
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseIfMatch('  "2026-09-04T01:02:03.456Z" ')?.valueOf()).toBe(
      AT.getTime(),
    );
  });

  it('treats * as match-any', () => {
    expect(parseIfMatch('*')).toBe('*');
  });

  it('rejects a comma-separated list', () => {
    expect(parseIfMatch('"2026-09-04T01:02:03.456Z", "*"')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseIfMatch('not-an-etag')).toBeNull();
  });
});
