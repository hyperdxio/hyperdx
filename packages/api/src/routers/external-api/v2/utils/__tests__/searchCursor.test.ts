import {
  decodeSearchCursor,
  encodeSearchCursor,
  fingerprintQuery,
  MAX_CURSOR_OFFSET,
} from '@/routers/external-api/v2/utils/searchCursor';

const FP_INPUT = {
  sourceId: '69b46cb0d964ce2d0b9506a8',
  where: 'SeverityText:ERROR',
  whereLanguage: 'lucene',
  select: 'Timestamp,Body',
  orderBy: 'Timestamp DESC',
};

const RANGE = {
  startTime: '2026-05-10T00:00:00.000Z',
  endTime: '2026-05-10T01:00:00.000Z',
};

describe('searchCursor', () => {
  it('round-trips window index and offset', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(
      { windowIndex: 3, offset: 500, ...RANGE },
      fp,
    );
    expect(decodeSearchCursor(cursor, fp)).toEqual({
      windowIndex: 3,
      offset: 500,
      ...RANGE,
    });
  });

  it('rejects a cursor minted for a different query', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(
      { windowIndex: 1, offset: 0, ...RANGE },
      fp,
    );
    const otherFp = fingerprintQuery({
      ...FP_INPUT,
      where: 'SeverityText:WARN',
    });
    expect(decodeSearchCursor(cursor, otherFp)).toEqual({
      error: 'CURSOR_QUERY_MISMATCH',
    });
  });

  it('rejects malformed and unknown-version cursors', () => {
    const fp = fingerprintQuery(FP_INPUT);
    expect(decodeSearchCursor('not-base64!!', fp)).toEqual({
      error: 'INVALID_CURSOR',
    });
    const future = Buffer.from(
      JSON.stringify({ v: 99, w: 0, o: 0, f: fp }),
    ).toString('base64url');
    expect(decodeSearchCursor(future, fp)).toEqual({ error: 'INVALID_CURSOR' });
  });

  it('accepts in-window offsets past the request field cap', () => {
    // The `offset` request field stops at 10,000, but a walk through a dense
    // window legitimately passes that; capping here used to 400 mid-walk.
    const fp = fingerprintQuery(FP_INPUT);
    const deep = encodeSearchCursor(
      { windowIndex: 0, offset: 50_000, ...RANGE },
      fp,
    );
    expect(decodeSearchCursor(deep, fp)).toMatchObject({ offset: 50_000 });
  });

  it('rejects an offset past the sanity bound', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const over = encodeSearchCursor(
      { windowIndex: 0, offset: MAX_CURSOR_OFFSET + 1, ...RANGE },
      fp,
    );
    expect(decodeSearchCursor(over, fp)).toEqual({ error: 'INVALID_CURSOR' });

    const atBound = encodeSearchCursor(
      { windowIndex: 0, offset: MAX_CURSOR_OFFSET, ...RANGE },
      fp,
    );
    expect(decodeSearchCursor(atBound, fp)).toMatchObject({
      offset: MAX_CURSOR_OFFSET,
    });
  });

  it('carries the time range instead of fingerprinting it', () => {
    // A defaulted endTime resolves to a fresh `now` each request; if it were
    // fingerprinted, every returned cursor would be rejected on the next call.
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(
      { windowIndex: 1, offset: 5, ...RANGE },
      fp,
    );
    expect(decodeSearchCursor(cursor, fp)).toMatchObject(RANGE);
  });

  it('changes the fingerprint for every field that changes the result set', () => {
    const base = fingerprintQuery(FP_INPUT);
    for (const patch of [
      { sourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      { where: 'x:1' },
      { whereLanguage: 'sql' },
      { select: 'Body' },
      { orderBy: 'Timestamp ASC' },
    ]) {
      expect(fingerprintQuery({ ...FP_INPUT, ...patch })).not.toEqual(base);
    }
  });
});
