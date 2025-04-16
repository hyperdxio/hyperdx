import { ResponseJSON } from '@clickhouse/client-web';

import { computeRatio, computeResultSetRatio } from '../useChartConfig';

describe('computeRatio', () => {
  it('should correctly compute ratio of two numbers', () => {
    expect(computeRatio('10', '2')).toBe(5);
    expect(computeRatio('3', '4')).toBe(0.75);
    expect(computeRatio('0', '5')).toBe(0);
  });

  it('should return NaN when denominator is zero', () => {
    expect(isNaN(computeRatio('10', '0'))).toBe(true);
  });

  it('should return NaN for non-numeric inputs', () => {
    expect(isNaN(computeRatio('abc', '2'))).toBe(true);
    expect(isNaN(computeRatio('10', 'xyz'))).toBe(true);
    expect(isNaN(computeRatio('abc', 'xyz'))).toBe(true);
    expect(isNaN(computeRatio('', '5'))).toBe(true);
  });

  it('should handle string representations of numbers', () => {
    expect(computeRatio('10.5', '2')).toBe(5.25);
    expect(computeRatio('-10', '5')).toBe(-2);
    expect(computeRatio('10', '-5')).toBe(-2);
  });
});

describe('computeResultSetRatio', () => {
  it('should compute ratio for a valid result set with timestamp column', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [
        { timestamp: '2025-04-15 10:00:00', requests: '100', errors: '10' },
        { timestamp: '2025-04-15 11:00:00', requests: '200', errors: '20' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.meta.length).toBe(2);
    expect(result.meta[0].name).toBe('requests/errors');
    expect(result.meta[0].type).toBe('Float64');
    expect(result.meta[1].name).toBe('timestamp');

    expect(result.data.length).toBe(2);
    expect(result.data[0]['requests/errors']).toBe(10);
    expect(result.data[0].timestamp).toBe('2025-04-15 10:00:00');
    expect(result.data[1]['requests/errors']).toBe(10);
    expect(result.data[1].timestamp).toBe('2025-04-15 11:00:00');
  });

  it('should compute ratio for a valid result set without timestamp column', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [{ requests: '100', errors: '10' }],
      rows: 1,
      statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 50 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.meta.length).toBe(1);
    expect(result.meta[0].name).toBe('requests/errors');
    expect(result.meta[0].type).toBe('Float64');

    expect(result.data.length).toBe(1);
    expect(result.data[0]['requests/errors']).toBe(10);
    expect(result.data[0].timestamp).toBeUndefined();
  });

  it('should handle NaN values in ratio computation', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [
        { timestamp: '2025-04-15 10:00:00', requests: '100', errors: '0' },
        { timestamp: '2025-04-15 11:00:00', requests: 'invalid', errors: '20' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.data.length).toBe(2);
    expect(isNaN(result.data[0]['requests/errors'])).toBe(true);
    expect(isNaN(result.data[1]['requests/errors'])).toBe(true);
  });

  it('should throw error when result set has insufficient columns', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
      ],
      data: [{ timestamp: '2025-04-15 10:00:00', requests: '100' }],
      rows: 1,
      statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 50 },
    };

    expect(() => computeResultSetRatio(mockResultSet)).toThrow(
      /Unable to compute ratio/,
    );
  });
});
