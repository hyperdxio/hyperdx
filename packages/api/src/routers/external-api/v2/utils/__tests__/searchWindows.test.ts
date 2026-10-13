import { resolveSearchWindows } from '@/routers/external-api/v2/utils/searchWindows';

const source = { timestampValueExpression: 'Timestamp' };

const START = new Date('2026-05-10T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

describe('resolveSearchWindows', () => {
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
