import { dateParser, parseTimeRangeInput } from '../utils';

describe('dateParser', () => {
  beforeEach(() => {
    // Mock current date to ensure consistent test results
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T22:00'));
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
