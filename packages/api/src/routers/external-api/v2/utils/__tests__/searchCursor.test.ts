import {
  decodeSearchCursor,
  encodeSearchCursor,
  fingerprintQuery,
  type SearchCursorState,
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

const state = (
  overrides: Partial<SearchCursorState> = {},
): SearchCursorState => ({
  window: {
    ordinal: 1,
    startTime: '2026-05-10T00:30:00.000Z',
    endTime: '2026-05-10T00:45:00.000Z',
  },
  offset: 500,
  ...RANGE,
  ...overrides,
});

// Rewrites the payload half of a cursor while keeping its signature.
const tamper = (cursor: string, edit: (p: Record<string, unknown>) => void) => {
  const [payload, sig] = cursor.split('.');
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  edit(parsed);
  return `${Buffer.from(JSON.stringify(parsed)).toString('base64url')}.${sig}`;
};

describe('searchCursor', () => {
  it('round-trips the window, offset and range', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(state(), fp);
    expect(decodeSearchCursor(cursor, fp)).toEqual(state());
  });

  it('encodes the same state to the same cursor', () => {
    const fp = fingerprintQuery(FP_INPUT);
    expect(encodeSearchCursor(state(), fp)).toBe(
      encodeSearchCursor(state(), fp),
    );
  });

  it('rejects a cursor minted for a different query', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(state(), fp);
    const otherFp = fingerprintQuery({
      ...FP_INPUT,
      where: 'SeverityText:WARN',
    });
    expect(decodeSearchCursor(cursor, otherFp)).toEqual({
      error: 'CURSOR_QUERY_MISMATCH',
    });
  });

  it.each([
    ['the offset', (p: Record<string, unknown>) => (p.o = 999_999)],
    [
      'the window start',
      (p: Record<string, unknown>) => (p.ws = RANGE.startTime),
    ],
    [
      'the range end',
      (p: Record<string, unknown>) => (p.e = '2030-01-01T00:00:00.000Z'),
    ],
  ])('rejects a cursor whose %s was edited', (_, edit) => {
    const fp = fingerprintQuery(FP_INPUT);
    const edited = tamper(encodeSearchCursor(state(), fp), edit);
    expect(decodeSearchCursor(edited, fp)).toEqual({ error: 'INVALID_CURSOR' });
  });

  it('rejects a cursor signed with a different secret', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const cursor = encodeSearchCursor(state(), fp, 'secret-a');
    expect(decodeSearchCursor(cursor, fp, 'secret-b')).toEqual({
      error: 'INVALID_CURSOR',
    });
    expect(decodeSearchCursor(cursor, fp, 'secret-a')).toEqual(state());
  });

  it('rejects malformed, unsigned and unknown-version cursors', () => {
    const fp = fingerprintQuery(FP_INPUT);
    expect(decodeSearchCursor('not-base64!!', fp)).toEqual({
      error: 'INVALID_CURSOR',
    });
    const [payload] = encodeSearchCursor(state(), fp).split('.');
    expect(decodeSearchCursor(payload, fp)).toEqual({
      error: 'INVALID_CURSOR',
    });
    const future = tamper(encodeSearchCursor(state(), fp), p => (p.v = 99));
    expect(decodeSearchCursor(future, fp)).toEqual({ error: 'INVALID_CURSOR' });
  });

  it('rejects a window outside the pinned range', () => {
    const fp = fingerprintQuery(FP_INPUT);
    const outside = encodeSearchCursor(
      state({
        window: {
          ordinal: 0,
          startTime: '2026-05-10T00:45:00.000Z',
          endTime: '2026-05-10T01:15:00.000Z',
        },
      }),
      fp,
    );
    expect(decodeSearchCursor(outside, fp)).toEqual({
      error: 'INVALID_CURSOR',
    });
  });

  it('accepts in-window offsets past the request field cap', () => {
    // A walk through a dense window passes the request field's 10,000 cap.
    const fp = fingerprintQuery(FP_INPUT);
    const deep = encodeSearchCursor(state({ offset: 50_000 }), fp);
    expect(decodeSearchCursor(deep, fp)).toMatchObject({ offset: 50_000 });
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
