import {
  formatRelativeDuration,
  getSavedSearchLanding,
  getTimeRangeChoices,
  hasExplicitTimeParams,
  isLiveTailDuration,
  isRangeEndingNow,
  resolveDefaultTimeRange,
  toDefaultTimeRange,
} from '@/components/SavedSearches/savedSearchTimeRange';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0, 500);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ONE_DAY = { type: 'relative' as const, value: 86400 };
const ONE_HOUR = { type: 'relative' as const, value: 3600 };

const windowEndingAt = (end: number, durationMs: number): [Date, Date] => [
  new Date(end - durationMs),
  new Date(end),
];

describe('hasExplicitTimeParams', () => {
  it.each([
    ['', false],
    ['?source=abc&where=x', false],
    ['?from=1&to=2', false],
    ['?from=1&to=2&isLive=false', true],
    ['?isLive=true', true],
    ['?liveInterval=300000', true],
  ])('%s -> %s', (search, expected) => {
    expect(hasExplicitTimeParams(search)).toBe(expected);
  });
});

describe('isLiveTailDuration', () => {
  it.each([
    [MINUTE, true],
    [HOUR, true],
    [6 * HOUR, true],
    [12 * HOUR, false],
    [DAY, false],
    [90 * MINUTE, false],
  ])('%i ms -> %s', (durationMs, expected) => {
    expect(isLiveTailDuration(durationMs)).toBe(expected);
  });
});

describe('getSavedSearchLanding', () => {
  it('opens a range live tail supports as live tail with that interval', () => {
    expect(getSavedSearchLanding(ONE_HOUR, '', NOW)).toEqual({
      kind: 'live',
      intervalMs: HOUR,
    });
  });

  it('opens a longer range as a window ending at the current second', () => {
    const end = NOW - 500;
    expect(getSavedSearchLanding(ONE_DAY, '', NOW)).toEqual({
      kind: 'window',
      range: [new Date(end - DAY), new Date(end)],
    });
  });

  it('yields to a time already in the URL', () => {
    expect(
      getSavedSearchLanding(ONE_DAY, '?from=1&to=2&isLive=false', NOW),
    ).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('ignores a %s range', (_name, stored) => {
    expect(getSavedSearchLanding(stored, '', NOW)).toBeNull();
  });
});

describe('toDefaultTimeRange', () => {
  it('snaps to a preset within one second', () => {
    expect(toDefaultTimeRange(DAY + 800)).toEqual(ONE_DAY);
  });

  it('rounds other durations to whole seconds', () => {
    expect(toDefaultTimeRange(90 * MINUTE + 400)).toEqual({
      type: 'relative',
      value: 5400,
    });
  });
});

describe('isRangeEndingNow', () => {
  it('allows at least a minute of slack', () => {
    expect(
      isRangeEndingNow(windowEndingAt(NOW - 59 * SECOND, MINUTE), NOW),
    ).toBe(true);
    expect(
      isRangeEndingNow(windowEndingAt(NOW - 61 * SECOND, MINUTE), NOW),
    ).toBe(false);
  });

  it('allows 10% of the duration for long windows', () => {
    const twoHoursAgo = NOW - 2 * 60 * MINUTE;
    expect(isRangeEndingNow(windowEndingAt(twoHoursAgo, DAY), NOW)).toBe(true);
  });

  it('rejects a window that ended in the past', () => {
    const oct2 = Date.UTC(2026, 9, 2);
    expect(isRangeEndingNow(windowEndingAt(oct2, DAY), NOW)).toBe(false);
  });
});

describe('formatRelativeDuration', () => {
  it.each([
    [86400, '1 day'],
    [5400, '1 hour 30 minutes'],
    [30 * 86400, '30 days'],
  ])('%i -> %s', (seconds, expected) => {
    expect(formatRelativeDuration(seconds)).toBe(expected);
  });
});

describe('getTimeRangeChoices', () => {
  const lastDay = { kind: 'window' as const, range: windowEndingAt(NOW, DAY) };

  it('offers only live tail during default live tail with nothing stored', () => {
    expect(
      getTimeRangeChoices({
        current: { kind: 'live', intervalMs: 15 * MINUTE },
        stored: null,
        nowMs: NOW,
      }),
    ).toEqual({ choices: ['live'], defaultChoice: 'live', currentRange: null });
  });

  it('offers a live tail interval picked in the time picker', () => {
    expect(
      getTimeRangeChoices({
        current: { kind: 'live', intervalMs: HOUR },
        stored: null,
        nowMs: NOW,
      }),
    ).toEqual({
      choices: ['live', 'current'],
      defaultChoice: 'live',
      currentRange: ONE_HOUR,
    });
  });

  it('offers the current window when it ends now, defaulting to live tail', () => {
    expect(
      getTimeRangeChoices({ current: lastDay, stored: null, nowMs: NOW }),
    ).toEqual({
      choices: ['live', 'current'],
      defaultChoice: 'live',
      currentRange: ONE_DAY,
    });
  });

  it('defaults to keeping a stored range', () => {
    const tenMinutes = {
      kind: 'window' as const,
      range: windowEndingAt(NOW, 10 * MINUTE),
    };
    expect(
      getTimeRangeChoices({ current: tenMinutes, stored: ONE_DAY, nowMs: NOW }),
    ).toMatchObject({
      choices: ['live', 'keep', 'current'],
      defaultChoice: 'keep',
    });
  });

  it('does not offer the current window when it equals the stored range', () => {
    expect(
      getTimeRangeChoices({ current: lastDay, stored: ONE_DAY, nowMs: NOW })
        .choices,
    ).toEqual(['live', 'keep']);
  });

  it('does not offer a window brushed into the past', () => {
    const brushed = {
      kind: 'window' as const,
      range: windowEndingAt(NOW - 3 * 60 * MINUTE, 10 * MINUTE),
    };
    expect(
      getTimeRangeChoices({ current: brushed, stored: ONE_DAY, nowMs: NOW })
        .choices,
    ).toEqual(['live', 'keep']);
  });
});

describe('resolveDefaultTimeRange', () => {
  const TEN_MINUTES = { type: 'relative' as const, value: 600 };

  it.each([
    [true, 'keep', ONE_DAY, undefined],
    [true, 'current', ONE_DAY, TEN_MINUTES],
    [true, 'current', null, TEN_MINUTES],
    [true, 'live', ONE_DAY, null],
    [true, 'live', null, undefined],
    [false, 'keep', ONE_DAY, ONE_DAY],
    [false, 'current', null, TEN_MINUTES],
    [false, 'live', ONE_DAY, undefined],
  ] as const)(
    'update=%s choice=%s stored=%j -> %j',
    (isUpdate, choice, stored, expected) => {
      expect(
        resolveDefaultTimeRange({
          isUpdate,
          choice,
          stored,
          currentRange: TEN_MINUTES,
        }),
      ).toEqual(expected);
    },
  );
});
