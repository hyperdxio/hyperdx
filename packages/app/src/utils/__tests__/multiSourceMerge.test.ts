import {
  computeFrontier,
  coveredUntil,
  mergeStreams,
  MULTI_SOURCE_ROW_FIELDS,
  StreamSnapshot,
} from '@/utils/multiSourceMerge';

const TS_KEY = '__hdx_timestamp';

const T = (iso: string) => new Date(iso);
const ms = (iso: string) => new Date(iso).getTime();

// Search range: 10:00 - 12:00 UTC
const DATE_RANGE: [Date, Date] = [
  T('2026-08-07T10:00:00Z'),
  T('2026-08-07T12:00:00Z'),
];

const row = (iso: string, extra: Record<string, any> = {}) => ({
  [TS_KEY]: iso,
  ...extra,
});

const makeStream = (
  overrides: Partial<StreamSnapshot> & { sourceId: string },
): StreamSnapshot => ({
  sourceName: overrides.sourceId,
  rows: [],
  window: null,
  lastPageRowCount: null,
  hasNextPage: true,
  isActive: true,
  dateRange: DATE_RANGE,
  ...overrides,
});

const parseTs = (r: Record<string, any>) => new Date(r[TS_KEY]).getTime();

describe('coveredUntil (DESC)', () => {
  it('covers the whole range when the stream is fully drained', () => {
    const stream = makeStream({
      sourceId: 'a',
      hasNextPage: false,
      window: {
        startTime: T('2026-08-07T10:00:00Z'),
        endTime: T('2026-08-07T12:00:00Z'),
      },
      lastPageRowCount: 0,
    });
    expect(coveredUntil(stream, 'DESC', parseTs)).toBe(DATE_RANGE[0].getTime());
  });

  it('covers nothing during the initial fetch even though hasNextPage is still false', () => {
    // useInfiniteQuery reports hasNextPage=false before the first page lands;
    // that must not be mistaken for a drained stream.
    const stream = makeStream({ sourceId: 'a', hasNextPage: false });
    expect(coveredUntil(stream, 'DESC', parseTs)).toBe(DATE_RANGE[1].getTime());
  });

  it('covers nothing before the first page arrives', () => {
    const stream = makeStream({ sourceId: 'a' });
    expect(coveredUntil(stream, 'DESC', parseTs)).toBe(DATE_RANGE[1].getTime());
  });

  it('covers through the window start when the last page was empty', () => {
    const stream = makeStream({
      sourceId: 'a',
      window: {
        startTime: T('2026-08-07T11:45:00Z'),
        endTime: T('2026-08-07T12:00:00Z'),
      },
      lastPageRowCount: 0,
    });
    expect(coveredUntil(stream, 'DESC', parseTs)).toBe(
      ms('2026-08-07T11:45:00Z'),
    );
  });

  it('covers only through the oldest fetched row when stopped mid-window at LIMIT', () => {
    const stream = makeStream({
      sourceId: 'a',
      rows: [row('2026-08-07T11:59:00Z'), row('2026-08-07T11:50:00Z')],
      window: {
        startTime: T('2026-08-07T11:45:00Z'),
        endTime: T('2026-08-07T12:00:00Z'),
      },
      lastPageRowCount: 2,
    });
    expect(coveredUntil(stream, 'DESC', parseTs)).toBe(
      ms('2026-08-07T11:50:00Z'),
    );
  });
});

describe('coveredUntil (ASC)', () => {
  it('mirrors the DESC semantics from the start of the range', () => {
    expect(coveredUntil(makeStream({ sourceId: 'a' }), 'ASC', parseTs)).toBe(
      DATE_RANGE[0].getTime(),
    );
    expect(
      coveredUntil(
        makeStream({
          sourceId: 'a',
          hasNextPage: false,
          window: {
            startTime: T('2026-08-07T10:00:00Z'),
            endTime: T('2026-08-07T12:00:00Z'),
          },
          lastPageRowCount: 0,
        }),
        'ASC',
        parseTs,
      ),
    ).toBe(DATE_RANGE[1].getTime());
    expect(
      coveredUntil(
        makeStream({
          sourceId: 'a',
          window: {
            startTime: T('2026-08-07T10:00:00Z'),
            endTime: T('2026-08-07T10:15:00Z'),
          },
          lastPageRowCount: 0,
        }),
        'ASC',
        parseTs,
      ),
    ).toBe(ms('2026-08-07T10:15:00Z'));
  });
});

const drainedStream = (sourceId: string) =>
  makeStream({
    sourceId,
    hasNextPage: false,
    window: {
      startTime: T('2026-08-07T10:00:00Z'),
      endTime: T('2026-08-07T12:00:00Z'),
    },
    lastPageRowCount: 0,
  });

describe('computeFrontier', () => {
  it('is the least-covered active stream (max for DESC)', () => {
    const drained = drainedStream('a');
    const midWindow = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T11:50:00Z')],
      window: {
        startTime: T('2026-08-07T11:45:00Z'),
        endTime: T('2026-08-07T12:00:00Z'),
      },
      lastPageRowCount: 1,
    });
    expect(computeFrontier([drained, midWindow], 'DESC', parseTs)).toBe(
      ms('2026-08-07T11:50:00Z'),
    );
  });

  it('ignores inactive (errored/excluded) streams so they cannot stall the merge', () => {
    const drained = drainedStream('a');
    const errored = makeStream({ sourceId: 'b', isActive: false });
    expect(computeFrontier([drained, errored], 'DESC', parseTs)).toBe(
      DATE_RANGE[0].getTime(),
    );
  });

  it('is null when no stream is active', () => {
    const errored = makeStream({ sourceId: 'a', isActive: false });
    expect(computeFrontier([errored], 'DESC', parseTs)).toBeNull();
  });
});

describe('mergeStreams', () => {
  const window0 = {
    startTime: T('2026-08-07T11:45:00Z'),
    endTime: T('2026-08-07T12:00:00Z'),
  };

  it('interleaves rows across streams newest-first and tags their source', () => {
    const a = makeStream({
      sourceId: 'a',
      sourceName: 'app logs',
      rows: [row('2026-08-07T11:59:00Z'), row('2026-08-07T11:57:00Z')],
      window: window0,
      lastPageRowCount: 2,
      hasNextPage: false,
    });
    const b = makeStream({
      sourceId: 'b',
      sourceName: 'traces',
      rows: [row('2026-08-07T11:58:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: false,
    });

    const { rows } = mergeStreams([a, b], 'DESC', TS_KEY);

    expect(rows.map(r => r[TS_KEY])).toEqual([
      '2026-08-07T11:59:00Z',
      '2026-08-07T11:58:00Z',
      '2026-08-07T11:57:00Z',
    ]);
    expect(rows.map(r => r[MULTI_SOURCE_ROW_FIELDS.SOURCE_NAME])).toEqual([
      'app logs',
      'traces',
      'app logs',
    ]);
    expect(rows[0][MULTI_SOURCE_ROW_FIELDS.SOURCE_ID]).toBe('a');
  });

  it('holds back rows older than the frontier until lagging streams catch up', () => {
    // Stream a is fully drained down to 10:00; stream b stopped at LIMIT with
    // its oldest row at 11:50 — anything older than 11:50 from a must wait.
    const a = makeStream({
      sourceId: 'a',
      rows: [
        row('2026-08-07T11:55:00Z'),
        row('2026-08-07T11:49:00Z'), // older than b's coverage — held back
      ],
      window: window0,
      lastPageRowCount: 2,
      hasNextPage: false,
    });
    const b = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T11:50:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: true,
    });

    const { rows, frontier, laggingSourceIds } = mergeStreams(
      [a, b],
      'DESC',
      TS_KEY,
    );

    expect(frontier).toBe(ms('2026-08-07T11:50:00Z'));
    expect(rows.map(r => r[TS_KEY])).toEqual([
      '2026-08-07T11:55:00Z',
      '2026-08-07T11:50:00Z',
    ]);
    expect(laggingSourceIds).toEqual(['b']);
  });

  it('shows everything when all streams are drained', () => {
    const a = makeStream({
      sourceId: 'a',
      rows: [row('2026-08-07T10:05:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: false,
    });
    const b = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T10:03:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: false,
    });

    const { rows, laggingSourceIds } = mergeStreams([a, b], 'DESC', TS_KEY);

    expect(rows).toHaveLength(2);
    expect(laggingSourceIds).toEqual([]);
  });

  it('holds everything back while a stream has no page yet, without marking it lagging', () => {
    const a = makeStream({
      sourceId: 'a',
      rows: [row('2026-08-07T11:59:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: false,
    });
    const pending = makeStream({ sourceId: 'b' });

    const { rows, laggingSourceIds } = mergeStreams(
      [a, pending],
      'DESC',
      TS_KEY,
    );

    // Frontier sits at the range end until b's first page lands.
    expect(rows).toEqual([]);
    // b's initial fetch is already in flight — nothing to advance.
    expect(laggingSourceIds).toEqual([]);
  });

  it('still shows rows from errored streams but never waits on them', () => {
    const a = makeStream({
      sourceId: 'a',
      rows: [row('2026-08-07T11:59:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: false,
    });
    const errored = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T11:58:00Z')],
      window: window0,
      lastPageRowCount: 1,
      isActive: false,
    });

    const { rows, laggingSourceIds } = mergeStreams(
      [a, errored],
      'DESC',
      TS_KEY,
    );

    expect(rows.map(r => r[TS_KEY])).toEqual([
      '2026-08-07T11:59:00Z',
      '2026-08-07T11:58:00Z',
    ]);
    expect(laggingSourceIds).toEqual([]);
  });

  it('merges oldest-first with a mirrored frontier for ASC', () => {
    const window0Asc = {
      startTime: T('2026-08-07T10:00:00Z'),
      endTime: T('2026-08-07T10:15:00Z'),
    };
    const a = makeStream({
      sourceId: 'a',
      rows: [
        row('2026-08-07T10:01:00Z'),
        row('2026-08-07T10:20:00Z'), // beyond b's coverage — held back
      ],
      window: window0Asc,
      lastPageRowCount: 2,
      hasNextPage: false,
    });
    const b = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T10:05:00Z')],
      window: window0Asc,
      lastPageRowCount: 1,
      hasNextPage: true,
    });

    const { rows, frontier, laggingSourceIds } = mergeStreams(
      [a, b],
      'ASC',
      TS_KEY,
    );

    expect(frontier).toBe(ms('2026-08-07T10:05:00Z'));
    expect(rows.map(r => r[TS_KEY])).toEqual([
      '2026-08-07T10:01:00Z',
      '2026-08-07T10:05:00Z',
    ]);
    expect(laggingSourceIds).toEqual(['b']);
  });

  it('advances every stream tied at the frontier', () => {
    const a = makeStream({
      sourceId: 'a',
      rows: [row('2026-08-07T11:50:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: true,
    });
    const b = makeStream({
      sourceId: 'b',
      rows: [row('2026-08-07T11:50:00Z')],
      window: window0,
      lastPageRowCount: 1,
      hasNextPage: true,
    });

    const { laggingSourceIds } = mergeStreams([a, b], 'DESC', TS_KEY);

    expect(laggingSourceIds).toEqual(['a', 'b']);
  });
});
