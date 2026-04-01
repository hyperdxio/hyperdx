import { parseTimeRange } from '../tools/query';

describe('parseTimeRange', () => {
  it('should return default range (last 15 minutes) when no arguments provided', () => {
    const before = Date.now();
    const result = parseTimeRange();
    const after = Date.now();

    expect(result).not.toHaveProperty('error');

    const { startDate, endDate } = result as {
      startDate: Date;
      endDate: Date;
    };
    // endDate should be approximately now
    expect(endDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(endDate.getTime()).toBeLessThanOrEqual(after);
    // startDate should be ~15 minutes before endDate
    const diffMs = endDate.getTime() - startDate.getTime();
    expect(diffMs).toBe(15 * 60 * 1000);
  });

  it('should use provided startTime and endTime', () => {
    const result = parseTimeRange(
      '2025-01-01T00:00:00Z',
      '2025-01-02T00:00:00Z',
    );
    expect(result).not.toHaveProperty('error');

    const { startDate, endDate } = result as {
      startDate: Date;
      endDate: Date;
    };
    expect(startDate.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2025-01-02T00:00:00.000Z');
  });

  it('should default startTime to 15 minutes before endTime', () => {
    const result = parseTimeRange(undefined, '2025-06-15T10:00:00Z');
    expect(result).not.toHaveProperty('error');

    const { startDate, endDate } = result as {
      startDate: Date;
      endDate: Date;
    };
    expect(endDate.toISOString()).toBe('2025-06-15T10:00:00.000Z');
    expect(startDate.toISOString()).toBe('2025-06-15T09:45:00.000Z');
  });

  it('should default endTime to now', () => {
    const before = Date.now();
    const result = parseTimeRange('2025-06-15T11:00:00Z');
    const after = Date.now();

    expect(result).not.toHaveProperty('error');

    const { startDate, endDate } = result as {
      startDate: Date;
      endDate: Date;
    };
    expect(startDate.toISOString()).toBe('2025-06-15T11:00:00.000Z');
    expect(endDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(endDate.getTime()).toBeLessThanOrEqual(after);
  });

  it('should return error for invalid startTime', () => {
    const result = parseTimeRange('not-a-date', '2025-01-01T00:00:00Z');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Invalid');
  });

  it('should return error for invalid endTime', () => {
    const result = parseTimeRange('2025-01-01T00:00:00Z', 'garbage');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Invalid');
  });

  it('should return error when both times are invalid', () => {
    const result = parseTimeRange('bad', 'also-bad');
    expect(result).toHaveProperty('error');
  });
});
