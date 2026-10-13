import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  windowInclusivity,
} from '@/core/searchWindows';

const START = new Date('2026-05-10T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

describe('windowInclusivity', () => {
  it('makes descending windows [start, end), newest window owning the range end', () => {
    const windows = generateTimeWindowsDescending(START, END);
    expect(windows.length).toBeGreaterThan(1);

    expect(windowInclusivity(windows[0], windows.length)).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: true,
    });
    expect(
      windowInclusivity(windows[windows.length - 1], windows.length),
    ).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: false,
    });
  });

  it('makes ascending windows half-open, newest window owning the range end', () => {
    const windows = generateTimeWindowsAscending(START, END);
    expect(windows.length).toBeGreaterThan(1);

    expect(windowInclusivity(windows[0], windows.length)).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: false,
    });
    expect(
      windowInclusivity(windows[windows.length - 1], windows.length),
    ).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: true,
    });
  });

  it('leaves a single window fully inclusive on both ends', () => {
    const windows = generateTimeWindowsDescending(START, START);
    expect(windows).toHaveLength(1);
    expect(windowInclusivity(windows[0], 1)).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: true,
    });
  });

  it.each([
    ['descending', generateTimeWindowsDescending(START, END)],
    ['ascending', generateTimeWindowsAscending(START, END)],
  ])(
    'lets exactly one %s window claim each shared boundary instant',
    (_, windows) => {
      // Every window includes its start; only the one holding the range end
      // includes its end.
      const ownsRangeEnd = (w: (typeof windows)[number]) =>
        w.endTime.getTime() === END.getTime();
      const wrongClaimants = windows.filter(
        w =>
          !ownsRangeEnd(w) &&
          windowInclusivity(w, windows.length).dateRangeEndInclusive,
      );
      expect(wrongClaimants).toEqual([]);
      expect(
        windows.every(
          w => windowInclusivity(w, windows.length).dateRangeStartInclusive,
        ),
      ).toBe(true);
    },
  );
});
