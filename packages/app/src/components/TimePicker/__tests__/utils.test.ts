import { dateParser, parseTimeRangeInput } from '../utils';

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
