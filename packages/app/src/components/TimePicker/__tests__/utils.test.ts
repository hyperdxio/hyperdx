import {
  dateParser,
  formatTimeRangeText,
  fromDateInputValue,
  parseTimeRangeInput,
  rangeNeedsExplicitYear,
  timeRangeInputToSeconds,
  toDateInputValue,
} from '@/components/TimePicker/utils';

describe('dateParser', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock current date to ensure consistent test results
    jest.useFakeTimers();
    mockDate = new Date('2025-01-15T22:00:00');
    jest.setSystemTime(mockDate);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null for undefined input', () => {
    expect(dateParser(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(dateParser('')).toBeNull();
  });

  it('parses absolute date', () => {
    expect(dateParser('2024-01-15')).toEqual(new Date('2024-01-15T12:00:00'));
  });

  it('parses month/date at specific time correctly', () => {
    expect(dateParser('Jan 15 13:12:00')).toEqual(
      new Date('2025-01-15T13:12:00'),
    );
  });

  it('parses future numeric month/date with prior year', () => {
    expect(dateParser('01/31')).toEqual(new Date('2024-01-31T12:00:00'));
  });

  it('parses non-future numeric month/date with current year', () => {
    expect(dateParser('01/15')).toEqual(new Date('2025-01-15T12:00:00'));
  });

  it('parses future month name/date with prior year', () => {
    expect(dateParser('Jan 31')).toEqual(new Date('2024-01-31T12:00:00'));
  });

  it('parses non-future month name/date with current year', () => {
    expect(dateParser('Jan 15')).toEqual(new Date('2025-01-15T12:00:00'));
  });

  it('clamps slightly future dates to now (within 1 day) - no year specified', () => {
    // Input: 23:00. Now: 22:00. Should clamp to now (22:00)
    const result = dateParser('Jan 15 23:00:00');
    expect(result?.getTime()).toEqual(mockDate.getTime());
    expect(result?.getFullYear()).toEqual(2025);
  });

  it('clamps slightly future dates to now (within 1 day) - year specified', () => {
    // Explicit year should be preserved even if in future, but clamped to now
    const result = dateParser('2025-01-15 23:00:00');
    expect(result?.getTime()).toEqual(mockDate.getTime());
    // Verify it didn't shift to 2024
    expect(result?.getFullYear()).toEqual(2025);
  });

  it('shifts year back for dates more than 1 day in future with inferred year', () => {
    // mocked time is 2025-01-15 22:00
    // Jan 17 is more than 1 day in future, should shift to 2024
    const result = dateParser('Jan 17 12:00:00');
    expect(result).toEqual(new Date('2024-01-17T12:00:00'));
  });

  it('does NOT shift year back for dates more than 1 day in future with explicit year', () => {
    // mocked time is 2025-01-15 22:00
    // Jan 17, 2025 is more than 1 day in future, but year is explicit
    const result = dateParser('2025-01-17 12:00:00');
    expect(result).toEqual(new Date('2025-01-17T12:00:00'));
    expect(result?.getFullYear()).toEqual(2025);
  });

  it('handles dates in the past correctly', () => {
    // mocked time is 2025-01-15 22:00
    const result = dateParser('Jan 10 12:00:00');
    expect(result).toEqual(new Date('2025-01-10T12:00:00'));
    expect(result?.getFullYear()).toEqual(2025);
  });

  it('handles edge case: exactly 1 day in the future', () => {
    // mocked time is 2025-01-15 22:00:00
    // Exactly 24 hours later: 2025-01-16 22:00:00
    // Should be clamped since it's <= 1 day from now
    const result = dateParser('Jan 16 22:00:00');
    expect(result?.getTime()).toEqual(mockDate.getTime());
  });

  it('handles edge case: just over 1 day in the future', () => {
    // mocked time is 2025-01-15 22:00:00
    // 24 hours + 1 second later should shift year
    const result = dateParser('Jan 16 22:00:01');
    expect(result).toEqual(new Date('2024-01-16T22:00:01'));
  });
});

describe('parseTimeRangeInput', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T22:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns [null, null] for empty string', () => {
    expect(parseTimeRangeInput('')).toEqual([null, null]);
  });

  it('returns [null, null] for invalid input', () => {
    expect(parseTimeRangeInput('invalid input')).toEqual([null, null]);
  });

  it('parses a range fully before the current time correctly', () => {
    expect(parseTimeRangeInput('Jan 2 - Jan 10')).toEqual([
      new Date('2025-01-02T12:00:00'),
      new Date('2025-01-10T12:00:00'),
    ]);
  });

  it('parses a range with an implied start date in the previous year', () => {
    expect(parseTimeRangeInput('Jan 31 - Jan 15')).toEqual([
      new Date('2024-01-31T12:00:00'),
      new Date('2025-01-15T12:00:00'),
    ]);
  });

  it('parses a range with specific times correctly', () => {
    expect(parseTimeRangeInput('Jan 31 12:00:00 - Jan 14 13:05:29')).toEqual([
      new Date('2024-01-31T12:00:00'),
      new Date('2025-01-14T13:05:29'),
    ]);
  });

  it('parses single date correctly', () => {
    expect(parseTimeRangeInput('2024-01-13')).toEqual([
      new Date('2024-01-13T12:00:00'),
      new Date(),
    ]);
  });

  it('parses explicit date range correctly', () => {
    expect(parseTimeRangeInput('2024-01-15 to 2024-01-16')).toEqual([
      new Date('2024-01-15T12:00:00'),
      new Date('2024-01-16T12:00:00'),
    ]);
  });
});

describe('rangeNeedsExplicitYear', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is false for a past range in the current year', () => {
    expect(
      rangeNeedsExplicitYear([
        new Date('2025-03-01T10:00:00'),
        new Date('2025-03-02T10:00:00'),
      ]),
    ).toBe(false);
  });

  it('is true when either date is in another year', () => {
    expect(
      rangeNeedsExplicitYear([
        new Date('2024-03-01T10:00:00'),
        new Date('2025-03-02T10:00:00'),
      ]),
    ).toBe(true);
  });

  it('is true when a date in the current year is in the future', () => {
    expect(
      rangeNeedsExplicitYear([
        new Date('2025-06-01T10:00:00'),
        new Date('2025-12-25T10:00:00'),
      ]),
    ).toBe(true);
  });

  it('compares years in the given time zone', () => {
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    const range: [Date, Date] = [
      new Date('2024-12-31T23:00:00Z'),
      new Date('2025-01-01T01:00:00Z'),
    ];
    expect(rangeNeedsExplicitYear(range, 'Etc/UTC')).toBe(true);
    // Already Jan 1 2025 in Tokyo for both dates.
    expect(rangeNeedsExplicitYear(range, 'Asia/Tokyo')).toBe(false);
  });
});

describe('formatTimeRangeText', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('omits the year for a past range in the current year', () => {
    expect(
      formatTimeRangeText([
        new Date('2026-03-03T10:00:00'),
        new Date('2026-03-05T10:00:00'),
      ]),
    ).toBe('Mar 3 10:00:00 - Mar 5 10:00:00');
  });

  it('includes the year when any date is outside the current year', () => {
    expect(
      formatTimeRangeText([
        new Date('2025-12-30T10:00:00'),
        new Date('2026-02-01T10:00:00'),
      ]),
    ).toBe('Dec 30 2025 10:00:00 - Feb 1 2026 10:00:00');
  });

  it('uses the requested clock', () => {
    expect(
      formatTimeRangeText(
        [new Date('2024-03-03T13:05:09'), new Date('2024-03-05T01:00:00')],
        { clock: '12h' },
      ),
    ).toBe('Mar 3 2024 1:05:09 PM - Mar 5 2024 1:00:00 AM');
  });

  it.each(['12h', '24h'] as const)(
    'round-trips past, boundary, current-year and future ranges with a %s clock',
    clock => {
      const ranges: [Date, Date][] = [
        [new Date('2024-03-03T13:05:09'), new Date('2024-03-05T01:00:00')],
        [new Date('2025-12-30T10:00:00'), new Date('2026-02-01T10:00:00')],
        [new Date('2026-03-03T10:00:00'), new Date('2026-03-05T10:00:00')],
        [new Date('2026-08-01T10:00:00'), new Date('2026-09-01T10:00:00')],
      ];
      for (const range of ranges) {
        expect(
          parseTimeRangeInput(formatTimeRangeText(range, { clock })),
        ).toEqual(range);
      }
    },
  );
});

describe('timeRangeInputToSeconds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T22:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the relative range length in seconds', () => {
    expect(timeRangeInputToSeconds('Past 1h')).toBe(3600);
    expect(timeRangeInputToSeconds('Past 15m')).toBe(900);
  });

  it('returns the span of an absolute range', () => {
    expect(timeRangeInputToSeconds('2024-01-15 to 2024-01-16')).toBe(86400);
  });

  it('returns null for unparseable input', () => {
    expect(timeRangeInputToSeconds('')).toBeNull();
    expect(timeRangeInputToSeconds('not a date')).toBeNull();
  });
});

describe('time zones', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-22T15:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads a range ending now in the given zone without clamping it', () => {
    const lastHour = [
      new Date('2026-10-22T14:00:00Z'),
      new Date('2026-10-22T15:00:00Z'),
    ];
    expect(
      parseTimeRangeInput('Oct 22 14:00:00 - Oct 22 15:00:00', 'Etc/UTC'),
    ).toEqual(lastHour);
    expect(
      parseTimeRangeInput(
        'Oct 22 07:00:00 - Oct 22 08:00:00',
        'America/Los_Angeles',
      ),
    ).toEqual(lastHour);
  });

  it.each(['Etc/UTC', 'Asia/Tokyo', 'America/Los_Angeles'])(
    'round-trips a range across a DST change in %s',
    timeZone => {
      jest.setSystemTime(new Date('2026-11-10T12:00:00Z'));
      const range: [Date, Date] = [
        new Date('2026-10-31T15:00:00Z'),
        new Date('2026-11-02T16:00:00Z'),
      ];
      for (const clock of ['12h', '24h'] as const) {
        expect(
          parseTimeRangeInput(
            formatTimeRangeText(range, { timeZone, clock }),
            timeZone,
          ),
        ).toEqual(range);
      }
    },
  );

  it('resolves relative words against the date in the given zone', () => {
    // Oct 22 12:00 in Tokyo, Oct 21 20:00 in Los Angeles.
    jest.setSystemTime(new Date('2026-10-22T03:00:00Z'));
    expect(parseTimeRangeInput('yesterday 5pm', 'Asia/Tokyo')[0]).toEqual(
      new Date('2026-10-21T08:00:00Z'),
    );
    expect(
      parseTimeRangeInput('yesterday 5pm', 'America/Los_Angeles')[0],
    ).toEqual(new Date('2026-10-21T00:00:00Z'));
  });

  it('keeps an explicit offset in the text', () => {
    expect(
      parseTimeRangeInput('2026-10-22T10:00:00Z', 'America/Los_Angeles')[0],
    ).toEqual(new Date('2026-10-22T10:00:00Z'));
  });

  // New York repeats 01:00-02:00 on Nov 1 2026: first at UTC-4, then at UTC-5.
  it('keeps both occurrences of the repeated hour apart', () => {
    jest.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const zone = 'America/New_York';
    expect(parseTimeRangeInput('2026-11-01T01:30:00-04:00', zone)[0]).toEqual(
      new Date('2026-11-01T05:30:00Z'),
    );
    expect(parseTimeRangeInput('2026-11-01T01:30:00-05:00', zone)[0]).toEqual(
      new Date('2026-11-01T06:30:00Z'),
    );
  });

  it('ends a relative range at now during the repeated hour', () => {
    jest.setSystemTime(new Date('2026-11-01T06:30:00Z'));
    expect(parseTimeRangeInput('Past 1h', 'America/New_York')).toEqual([
      new Date('2026-11-01T05:30:00Z'),
      new Date('2026-11-01T06:30:00Z'),
    ]);
  });

  it('parses date input text in the given zone', () => {
    expect(dateParser('Oct 22 07:00', 'America/Los_Angeles')).toEqual(
      new Date('2026-10-22T14:00:00Z'),
    );
  });

  it('converts DateInput values in the given zone', () => {
    const date = new Date('2026-10-22T15:00:00Z');
    expect(toDateInputValue(date, 'America/Los_Angeles')).toBe(
      '2026-10-22 08:00:00',
    );
    expect(
      fromDateInputValue('2026-10-22 08:00:00', 'America/Los_Angeles'),
    ).toEqual(date);
    expect(fromDateInputValue('2026-10-22', 'Etc/UTC')).toEqual(
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(fromDateInputValue('not a date', 'Etc/UTC')).toBeNull();
  });
});
