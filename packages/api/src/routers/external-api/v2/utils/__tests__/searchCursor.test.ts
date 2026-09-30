import {
  decodeSearchCursor,
  encodeSearchCursor,
  fingerprintQuery,
} from '@/routers/external-api/v2/utils/searchCursor';

const FP_INPUT = {
  sourceId: '69b46cb0d964ce2d0b9506a8',
  where: 'SeverityText:ERROR',
  whereLanguage: 'lucene',
  select: 'Timestamp,Body',
  orderBy: 'Timestamp DESC',
  startTime: '2026-05-10T00:00:00.000Z',
  endTime: '2026-05-10T01:00:00.000Z',
};

describe('searchCursor', () => {
  it('round-trips window index and offset', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor({ windowIndex: 3, offset: 500 }, fp);
    expect(decodeSearchCursor(cursor, fp)).toEqual({
      windowIndex: 3,
      offset: 500,
    });
  });

  it('rejects a cursor minted for a different query', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor({ windowIndex: 1, offset: 0 }, fp);
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

  it('changes the fingerprint for every field that changes the result set', () => {
    const base = fingerprintQuery(FP_INPUT);
    for (const patch of [
      { sourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      { where: 'x:1' },
      { whereLanguage: 'sql' },
      { select: 'Body' },
      { orderBy: 'Timestamp ASC' },
      { startTime: '2026-05-09T00:00:00.000Z' },
      { endTime: '2026-05-10T02:00:00.000Z' },
    ]) {
      expect(fingerprintQuery({ ...FP_INPUT, ...patch })).not.toEqual(base);
    }
  });
});
