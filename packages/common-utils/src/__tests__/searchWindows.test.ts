import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  windowInclusivity,
} from '@/core/searchWindows';

const START = new Date('2026-05-10T00:00:00.000Z');
const END = new Date('2026-05-11T00:00:00.000Z');

describe('windowInclusivity', () => {
  it('makes descending windows half-open, oldest window owning the range start', () => {
    const windows = generateTimeWindowsDescending(START, END);
    expect(windows.length).toBeGreaterThan(1);

    expect(windowInclusivity(windows[0], windows.length)).toEqual({
      dateRangeStartInclusive: false,
      dateRangeEndInclusive: true,
    });
    expect(
      windowInclusivity(windows[windows.length - 1], windows.length),
    ).toEqual({
      dateRangeStartInclusive: true,
      dateRangeEndInclusive: true,
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

  it('lets exactly one window claim each shared boundary instant', () => {
    const windows = generateTimeWindowsDescending(START, END);
    // start(i) === end(i+1). The older window claims it via its inclusive end,
    // so no window except the oldest may have an inclusive start.
    const wrongClaimants = windows.filter(
      (w, i) =>
        i !== windows.length - 1 &&
        windowInclusivity(w, windows.length).dateRangeStartInclusive,
    );
    expect(wrongClaimants).toEqual([]);
  });
});
