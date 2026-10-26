import { cutWindowAtSecond } from '@/routers/external-api/v2/utils/searchWindows';

const window = {
  ordinal: 0,
  startTime: '2026-10-25T11:45:00.000Z',
  endTime: '2026-10-25T12:00:00.400Z',
};
const ms = (iso: string) => Date.parse(iso);

describe('cutWindowAtSecond', () => {
  it('ends a descending window just after the last row second', () => {
    expect(
      cutWindowAtSecond({
        window,
        direction: 'DESC',
        offset: 0,
        pageLength: 2000,
        lastSecondMs: ms('2026-10-25T11:58:31.000Z'),
        trailingRunLength: 12,
      }),
    ).toEqual({
      window: { ...window, endTime: '2026-10-25T11:58:32.000Z' },
      offset: 12,
    });
  });

  it('keeps the range end when the last row second reaches it', () => {
    expect(
      cutWindowAtSecond({
        window,
        direction: 'DESC',
        offset: 0,
        pageLength: 2000,
        lastSecondMs: ms('2026-10-25T12:00:00.000Z'),
        trailingRunLength: 2000,
      }),
    ).toEqual({ window, offset: 2000 });
  });

  it('starts an ascending window at the last row second', () => {
    expect(
      cutWindowAtSecond({
        window,
        direction: 'ASC',
        offset: 0,
        pageLength: 2000,
        lastSecondMs: ms('2026-10-25T11:46:10.000Z'),
        trailingRunLength: 7,
      }),
    ).toEqual({
      window: { ...window, startTime: '2026-10-25T11:46:10.000Z' },
      offset: 7,
    });
  });

  it.each(['DESC', 'ASC'] as const)(
    'adds the page to the offset when the whole %s page was one second',
    direction => {
      const cut =
        direction === 'DESC'
          ? { ...window, endTime: '2026-10-25T11:58:32.000Z' }
          : { ...window, startTime: '2026-10-25T11:58:31.000Z' };
      expect(
        cutWindowAtSecond({
          window: cut,
          direction,
          offset: 300,
          pageLength: 1000,
          lastSecondMs: ms('2026-10-25T11:58:31.000Z'),
          trailingRunLength: 1000,
        }),
      ).toEqual({ window: cut, offset: 1300 });
    },
  );
});
