import {
  DEFAULT_TIME_WINDOWS_SECONDS,
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
} from '@hyperdx/common-utils/dist/core/searchWindows';

import {
  nextSearchWindow,
  resolveFirstSearchWindow,
  windowBounds,
} from '@/routers/external-api/v2/utils/searchWindows';

type Opts = Parameters<typeof resolveFirstSearchWindow>[4];

// Every window of a walk, in the order pages visit them.
async function resolveSearchWindows(
  source: { timestampValueExpression?: string },
  orderBy: string,
  start: Date,
  end: Date,
  opts?: Opts,
) {
  const first = await resolveFirstSearchWindow(
    source,
    orderBy,
    start,
    end,
    opts,
  );
  const range = { start, end };
  const windows: {
    startTime: Date;
    endTime: Date;
    windowIndex: number;
    direction: 'ASC' | 'DESC';
  }[] = [];
  for (
    let w: typeof first.window | null = first.window;
    w != null;
    w = nextSearchWindow(w, range, first.direction, first.cut?.bucketMs)
  ) {
    windows.push({
      startTime: new Date(w.startTime),
      endTime: new Date(w.endTime),
      windowIndex: w.ordinal,
      direction: first.direction,
    });
  }
  return windows;
}

// Reference windows: build every window, floor the boundaries between
// them to the second, drop empties. Stepping must reproduce it exactly.
function referenceWindows(
  start: Date,
  end: Date,
  direction: 'ASC' | 'DESC',
  alignMs = 1000,
) {
  const windows =
    direction === 'ASC'
      ? generateTimeWindowsAscending(start, end)
      : generateTimeWindowsDescending(start, end);
  if (windows.length <= 1) return windows.map(w => [w.startTime, w.endTime]);
  const snap = (t: Date) =>
    t.getTime() === start.getTime() || t.getTime() === end.getTime()
      ? t.getTime()
      : Math.max(Math.floor(t.getTime() / alignMs) * alignMs, start.getTime());
  return windows
    .map(w => [snap(w.startTime), snap(w.endTime)])
    .filter(([a, b]) => a < b)
    .map(([a, b]) => [new Date(a), new Date(b)]);
}

const source = { timestampValueExpression: 'Timestamp' };

const START = new Date('2026-05-10T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

describe('search window stepping', () => {
  it('windows a timestamp-led descending order', async () => {
    const windows = await resolveSearchWindows(
      source,
      'Timestamp DESC',
      START,
      END,
    );
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].direction).toBe('DESC');
    expect(windows[0].endTime).toEqual(END);
  });

  it('windows a timestamp-led ascending order in the other direction', async () => {
    const windows = await resolveSearchWindows(
      source,
      'Timestamp ASC',
      START,
      END,
    );
    expect(windows[0].direction).toBe('ASC');
    expect(windows[0].startTime).toEqual(START);
  });

  it('disengages windowing when the order does not lead with the timestamp', async () => {
    const windows = await resolveSearchWindows(
      source,
      'SeverityText DESC',
      START,
      END,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].startTime).toEqual(START);
    expect(windows[0].endTime).toEqual(END);
  });

  it('returns exactly one window when start equals end', async () => {
    const windows = await resolveSearchWindows(
      source,
      'Timestamp DESC',
      START,
      START,
    );
    expect(windows).toHaveLength(1);
  });

  it('covers the full range with no gaps between adjacent windows', async () => {
    const windows = await resolveSearchWindows(
      source,
      'Timestamp DESC',
      START,
      END,
    );
    windows
      .slice(0, -1)
      .forEach((w, i) =>
        expect(w.startTime).toEqual(windows.at(i + 1)?.endTime),
      );
    expect(windows[windows.length - 1].startTime).toEqual(START);
    expect(windows[0].endTime).toEqual(END);
  });

  it.each([
    ['descending', 'Timestamp DESC'],
    ['ascending', 'Timestamp ASC'],
  ])(
    'snaps %s interior boundaries to whole seconds and keeps the caller bounds exact',
    async (_, orderBy) => {
      const start = new Date('2026-05-10T00:00:00.250Z');
      const end = new Date('2026-05-11T00:00:00.750Z');
      const windows = await resolveSearchWindows(source, orderBy, start, end);
      expect(windows.length).toBeGreaterThan(1);

      const bounds = windows.flatMap(w => [w.startTime, w.endTime]);
      const interior = bounds.filter(
        t => t.getTime() !== start.getTime() && t.getTime() !== end.getTime(),
      );
      expect(interior.length).toBeGreaterThan(0);
      expect(interior.every(t => t.getTime() % 1000 === 0)).toBe(true);
      expect(bounds.map(t => t.getTime())).toContain(start.getTime());
      expect(bounds.map(t => t.getTime())).toContain(end.getTime());
      windows.forEach((w, i) => expect(w.windowIndex).toBe(i));
    },
  );

  it('drops a window that snapping leaves empty and keeps the range covered', async () => {
    const start = new Date('2026-05-10T00:00:00.400Z');
    const end = new Date('2026-05-10T00:15:00.700Z');
    const windows = await resolveSearchWindows(
      source,
      'Timestamp DESC',
      start,
      end,
    );

    expect(windows).toEqual([
      { startTime: start, endTime: end, windowIndex: 0, direction: 'DESC' },
    ]);
  });

  it.each([
    [
      'a compound toStartOf part next to the raw column',
      'toStartOfMinute(Timestamp), Timestamp',
      undefined,
    ],
    [
      'a Date column next to a DateTime64 column',
      'EventDate, Timestamp',
      'Date',
    ],
  ])('windows %s', async (_, timestampValueExpression, eventDateType) => {
    const windows = await resolveSearchWindows(
      { timestampValueExpression },
      'Timestamp DESC',
      START,
      END,
      {
        columnType: async column =>
          column === 'EventDate' ? eventDateType : 'DateTime64(9)',
      },
    );
    expect(windows.length).toBeGreaterThan(1);
  });

  it.each([
    [
      'a lone toStartOf expression',
      'toStartOfMinute(Timestamp)',
      'toStartOfMinute(Timestamp) DESC',
      undefined,
    ],
    ['a bare Date column', 'EventDate', 'EventDate DESC', 'Date'],
    [
      'a Nullable(Date32) column',
      'EventDate',
      'EventDate DESC',
      'Nullable(Date32)',
    ],
  ])(
    'uses one window for %s, whose bounds are inclusive on both ends',
    async (_, timestampValueExpression, orderBy, columnType) => {
      const windows = await resolveSearchWindows(
        { timestampValueExpression },
        orderBy,
        START,
        END,
        { columnType: async () => columnType },
      );
      expect(windows).toHaveLength(1);
    },
  );

  it.each([
    ['DESC', 'Timestamp', 'Timestamp', 1000],
    ['ASC', 'Timestamp', 'Timestamp', 1000],
    [
      'DESC',
      'toStartOfMinute(Timestamp), Timestamp',
      'toStartOfMinute(Timestamp)',
      60_000,
    ],
    [
      'ASC',
      'toStartOfMinute(Timestamp), Timestamp',
      'toStartOfMinute(Timestamp)',
      60_000,
    ],
  ] as const)(
    'steps through exactly the reference windows (%s, %s)',
    async (direction, timestampValueExpression, sortKey, alignMs) => {
      const walkSource = { timestampValueExpression };
      // Deterministic pseudo-random ranges: 0 to 30 days, millisecond precision.
      let seed = 42;
      const rand = () =>
        (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
      // Plus edge ranges: a mid-second start, with lengths within a second of
      // each cumulative window boundary, where flooring can empty a window.
      const edgeStart = new Date('2026-05-10T00:00:00.700Z');
      let cumulative = 0;
      for (const size of [...DEFAULT_TIME_WINDOWS_SECONDS, 86_400, 86_400]) {
        cumulative += size * 1000;
        for (const delta of [-61_300, -1300, -300, 0, 300, 1300, 61_300]) {
          const end = new Date(edgeStart.getTime() + cumulative + delta);
          const walked = await resolveSearchWindows(
            walkSource,
            `${sortKey} ${direction}`,
            edgeStart,
            end,
          );
          expect(walked.map(w => [w.startTime, w.endTime])).toEqual(
            referenceWindows(edgeStart, end, direction, alignMs),
          );
        }
      }
      for (let i = 0; i < 200; i++) {
        const start = new Date(
          Date.UTC(2026, 4, 1) + Math.floor(rand() * 86_400_000),
        );
        const end = new Date(
          start.getTime() + Math.floor(rand() * 30 * 86_400_000),
        );
        const walked = await resolveSearchWindows(
          walkSource,
          `${sortKey} ${direction}`,
          start,
          end,
        );
        expect(walked.map(w => [w.startTime, w.endTime])).toEqual(
          referenceWindows(start, end, direction, alignMs),
        );
      }
    },
  );

  it('steps through windows sized by the default table, then 24h repeating', async () => {
    const windows = await resolveSearchWindows(
      source,
      'Timestamp DESC',
      START,
      new Date(START.getTime() + 3 * 86_400_000),
    );
    const sizes = windows.map(
      w => (w.endTime.getTime() - w.startTime.getTime()) / 1000,
    );
    expect(sizes.slice(0, DEFAULT_TIME_WINDOWS_SECONDS.length)).toEqual(
      DEFAULT_TIME_WINDOWS_SECONDS,
    );
    expect(
      sizes
        .slice(DEFAULT_TIME_WINDOWS_SECONDS.length, -1)
        .every(s => s === 86_400),
    ).toBe(true);
  });

  it.each([
    ['EventDate, toDateTime(ts)', 'toDateTime(ts) DESC', 'toDateTime(ts)'],
    [
      'TimestampTime, Timestamp',
      '(TimestampTime, Timestamp) DESC',
      'TimestampTime',
    ],
    ['TimestampTime, Timestamp', 'Timestamp DESC, Body', 'Timestamp'],
    ['toStartOfMinute(Timestamp), Timestamp', 'Timestamp DESC', 'Timestamp'],
  ])(
    'cuts %s ordered by %s on %s',
    async (timestampValueExpression, orderBy, cutPart) => {
      const first = await resolveFirstSearchWindow(
        { timestampValueExpression },
        orderBy,
        START,
        END,
        {
          columnType: async column =>
            column === 'EventDate'
              ? 'Date'
              : column === 'TimestampTime' || column === 'EventTime'
                ? 'DateTime'
                : 'DateTime64(9)',
        },
      );
      expect(first.windowed).toBe(true);
      expect(first.cut).toEqual({ expression: cutPart, bucketMs: 1000 });
    },
  );

  it.each([
    ['toStartOfSecond(Timestamp)', 1000],
    ['toStartOfMinute(Timestamp)', 60_000],
    ['toStartOfFiveMinutes(Timestamp)', 300_000],
    ['toStartOfFiveMinute(Timestamp)', 300_000],
    ['toStartOfFifteenMinutes(Timestamp)', 900_000],
  ])(
    'cuts on a rounded leading key %s in %ims buckets',
    async (key, bucketMs) => {
      const first = await resolveFirstSearchWindow(
        { timestampValueExpression: `${key}, Timestamp` },
        `${key} DESC, Body`,
        START,
        END,
        { columnType: async () => 'DateTime64(9)' },
      );
      expect(first.windowed).toBe(true);
      expect(first.cut).toEqual({ expression: key, bucketMs });
    },
  );

  it.each([
    // Ten-minute buckets don't align to UTC in +x:45 time zones.
    [
      'toStartOfTenMinutes(Timestamp), Timestamp',
      'toStartOfTenMinutes(Timestamp) DESC, Body',
    ],
    [
      'toStartOfHour(Timestamp), Timestamp',
      'toStartOfHour(Timestamp) DESC, Body',
    ],
    ['EventDate, EventTime', 'EventDate DESC, Body'],
    // Without an exact part, rounded bounds are inclusive on both ends.
    ['toStartOfMinute(Timestamp)', 'toStartOfMinute(Timestamp) DESC, Body'],
  ])(
    'uses one window for %s ordered by %s',
    async (timestampValueExpression, orderBy) => {
      const first = await resolveFirstSearchWindow(
        { timestampValueExpression },
        orderBy,
        START,
        END,
        {
          columnType: async column =>
            column === 'EventDate' ? 'Date' : 'DateTime64(9)',
        },
      );
      expect(first.windowed).toBe(false);
      expect(first.cut).toBeNull();
    },
  );

  it('reports windowing for a range shorter than the first window', async () => {
    const short = await resolveFirstSearchWindow(
      source,
      'Timestamp DESC',
      START,
      new Date(START.getTime() + 10 * 60 * 1000),
    );
    expect(short.windowed).toBe(true);
    const unordered = await resolveFirstSearchWindow(
      source,
      'Body DESC',
      START,
      END,
    );
    expect(unordered.windowed).toBe(false);
    const offsetOnly = await resolveFirstSearchWindow(
      source,
      'Timestamp DESC',
      START,
      END,
      {
        forceSingleWindow: true,
      },
    );
    expect(offsetOnly.windowed).toBe(false);
  });

  it('includes a window end only when it is the range end', () => {
    const range = { start: START, end: END };
    const newest = {
      ordinal: 0,
      startTime: '2026-05-10T23:45:00.000Z',
      endTime: END.toISOString(),
    };
    const older = {
      ordinal: 1,
      startTime: '2026-05-10T17:45:00.000Z',
      endTime: '2026-05-10T23:45:00.000Z',
    };
    expect(windowBounds(newest, range)).toEqual({
      dateRange: [new Date(newest.startTime), END],
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: true,
    });
    expect(windowBounds(older, range)).toMatchObject({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: false,
    });
  });

  it('windows a default tuple order led by the timestamp', async () => {
    const tupleSource = { timestampValueExpression: 'TimestampTime' };
    const windows = await resolveSearchWindows(
      tupleSource,
      '(TimestampTime, Timestamp) DESC',
      START,
      END,
    );
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].direction).toBe('DESC');
  });

  it('uses one window when a tuple order is not led by the timestamp', async () => {
    const windows = await resolveSearchWindows(
      source,
      '(SeverityText, Timestamp) DESC',
      START,
      END,
    );
    expect(windows).toHaveLength(1);
  });

  it('uses one window when the first sort key only derives from the timestamp', async () => {
    const windows = await resolveSearchWindows(
      source,
      'toHour(Timestamp) DESC',
      START,
      END,
    );
    expect(windows).toHaveLength(1);
  });
});
