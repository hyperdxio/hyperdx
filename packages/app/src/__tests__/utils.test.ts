import {
  ChartPaletteTokenSchema,
  ColorCondition,
  NumericUnit,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';

import { MetricsDataType, NumberFormat } from '@/types';
import * as utils from '@/utils';
import {
  COLORS,
  evaluateColorCondition,
  formatAttributeClause,
  formatDurationMs,
  formatDurationMsCompact,
  formatNumber,
  getAllMetricTables,
  getColorFromCSSToken,
  getMetricTableName,
  mapKeyBy,
  mergePath,
  orderByStringToSortingState,
  parseTimestampToMs,
  resolveConditionalColor,
  sortingStateToOrderByString,
  stripTrailingSlash,
  useQueryHistory,
} from '@/utils';

describe('formatAttributeClause', () => {
  it('should format SQL attribute clause correctly', () => {
    expect(
      formatAttributeClause('ResourceAttributes', 'service', 'nginx', true),
    ).toBe("ResourceAttributes['service']='nginx'");

    expect(formatAttributeClause('metadata', 'environment', 'prod', true)).toBe(
      "metadata['environment']='prod'",
    );

    expect(formatAttributeClause('data', 'user-id', 'abc-123', true)).toBe(
      "data['user-id']='abc-123'",
    );
  });

  it('should format lucene attribute clause correctly', () => {
    expect(formatAttributeClause('attrs', 'service', 'nginx', false)).toBe(
      'attrs.service:"nginx"',
    );

    expect(
      formatAttributeClause('metadata', 'environment', 'prod', false),
    ).toBe('metadata.environment:"prod"');

    expect(formatAttributeClause('data', 'user-id', 'abc-123', false)).toBe(
      'data.user-id:"abc-123"',
    );
  });
});

describe('getMetricTableName', () => {
  // Base source object with required properties
  const createBaseSource = () => ({
    from: {
      tableName: '',
      databaseName: 'test_db',
    },
    id: 'test-id',
    name: 'test-source',
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    kind: 'metric' as const,
  });

  // Source with metric tables
  const createSourceWithMetrics = () => ({
    ...createBaseSource(),
    metricTables: {
      gauge: 'gauge_table',
      counter: 'counter_table',
    },
  });

  it('returns the default table name when metricType is null', () => {
    const source = createSourceWithMetrics() as unknown as TSource;

    expect(getMetricTableName(source)).toBe('');
    expect(getMetricTableName(source, undefined)).toBe('');
  });

  it('returns the specific metric table when metricType is provided', () => {
    const source = createSourceWithMetrics() as unknown as TSource;

    expect(getMetricTableName(source, 'gauge' as MetricsDataType)).toBe(
      'gauge_table',
    );
    expect(getMetricTableName(source, 'counter' as MetricsDataType)).toBe(
      'counter_table',
    );
  });

  it('handles case insensitivity for metric types', () => {
    const source = createSourceWithMetrics() as unknown as TSource;

    expect(getMetricTableName(source, 'GAUGE' as MetricsDataType)).toBe(
      'gauge_table',
    );
    expect(getMetricTableName(source, 'Counter' as MetricsDataType)).toBe(
      'counter_table',
    );
  });

  it('returns undefined when the requested metric type does not exist', () => {
    const source = {
      ...createBaseSource(),
      metricTables: {
        gauge: 'gauge_table',
      },
    } as unknown as TSource;

    expect(
      getMetricTableName(source, 'histogram' as MetricsDataType),
    ).toBeUndefined();
  });

  it('handles sources without metricTables property', () => {
    const source = createBaseSource() as unknown as TSource;

    expect(getMetricTableName(source)).toBe('');
    expect(
      getMetricTableName(source, 'gauge' as MetricsDataType),
    ).toBeUndefined();
  });
});

describe('getAllMetricTables', () => {
  const createMetricSource = (metricTables: Record<string, string>): TSource =>
    ({
      kind: 'metric' as const,
      from: { databaseName: 'test_db', tableName: '' },
      connection: 'test-conn',
      id: 'test-id',
      name: 'test',
      timestampValueExpression: 'timestamp',
      metricTables,
    }) as unknown as TSource;

  it('returns empty array for non-metric source', () => {
    const source = {
      kind: 'log' as const,
      from: { databaseName: 'test_db', tableName: 'logs' },
      connection: 'test-conn',
      id: 'test-id',
      name: 'test',
      timestampValueExpression: 'timestamp',
    } as unknown as TSource;

    expect(getAllMetricTables(source)).toEqual([]);
  });

  it('returns empty array when metricTables is undefined', () => {
    const source = {
      kind: 'metric' as const,
      from: { databaseName: 'test_db', tableName: '' },
      connection: 'test-conn',
      id: 'test-id',
      name: 'test',
      timestampValueExpression: 'timestamp',
    } as unknown as TSource;

    expect(getAllMetricTables(source)).toEqual([]);
  });

  it('returns TableConnection for each populated metric table', () => {
    const source = createMetricSource({
      Gauge: 'gauge_table',
      Sum: 'sum_table',
    });

    const result = getAllMetricTables(source);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          tableName: 'gauge_table',
          databaseName: 'test_db',
          connectionId: 'test-conn',
        },
        {
          tableName: 'sum_table',
          databaseName: 'test_db',
          connectionId: 'test-conn',
        },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('filters out metric types with no table name', () => {
    const source = createMetricSource({
      Gauge: 'gauge_table',
      Histogram: '',
    });

    const result = getAllMetricTables(source);
    expect(result).toEqual([
      {
        tableName: 'gauge_table',
        databaseName: 'test_db',
        connectionId: 'test-conn',
      },
    ]);
  });

  it('returns all four metric types when all are populated', () => {
    const source = createMetricSource({
      Gauge: 'gauge_t',
      Histogram: 'histogram_t',
      Sum: 'sum_t',
      Summary: 'summary_t',
    });

    const result = getAllMetricTables(source);
    expect(result).toHaveLength(4);
    expect(result.map(t => t.tableName).sort()).toEqual([
      'gauge_t',
      'histogram_t',
      'sum_t',
      'summary_t',
    ]);
    // All should share the same database and connection
    for (const tc of result) {
      expect(tc.databaseName).toBe('test_db');
      expect(tc.connectionId).toBe('test-conn');
    }
  });

  it('returns empty array when all metric table values are falsy', () => {
    const source = createMetricSource({
      Gauge: '',
      Histogram: '',
    });

    expect(getAllMetricTables(source)).toEqual([]);
  });
});

describe('formatNumber', () => {
  it('handles undefined/null values', () => {
    expect(formatNumber(undefined)).toBe('N/A');
    expect(formatNumber(null as any)).toBe('N/A');
  });

  it('returns string representation when no format options provided', () => {
    expect(formatNumber(1234)).toBe('1234');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-1234)).toBe('-1234');
  });

  describe('number format', () => {
    it('formats with mantissa', () => {
      const format: NumberFormat = {
        output: 'number',
        mantissa: 2,
      };
      expect(formatNumber(1234.5678, format)).toBe('1234.57');
    });

    it('formats with thousand separator', () => {
      const format: NumberFormat = {
        output: 'number',
        thousandSeparated: true,
      };
      expect(formatNumber(1234567, format)).toBe('1,234,567');
    });

    it('does not apply factor multiplication', () => {
      const format: NumberFormat = {
        output: 'number',
        factor: 0.001, // Convert to milliseconds
      };
      expect(formatNumber(1000, format)).toBe('1000');
    });
  });

  describe('currency format', () => {
    it('formats with default currency symbol', () => {
      const format: NumberFormat = {
        output: 'currency',
        thousandSeparated: true,
      };
      expect(formatNumber(1234.56, format)).toBe('$1,235');
    });

    it('formats with custom currency symbol', () => {
      const format: NumberFormat = {
        output: 'currency',
        currencySymbol: '€',
      };
      expect(formatNumber(1234.56, format)).toBe('€1235');
    });
  });

  describe('percentage format', () => {
    it('formats as percentage', () => {
      const format: NumberFormat = {
        output: 'percent',
      };
      expect(formatNumber(0.1234, format)).toBe('12%');
    });

    it('formats percentage with mantissa', () => {
      const format: NumberFormat = {
        output: 'percent',
        mantissa: 2,
      };
      expect(formatNumber(0.1234, format)).toBe('12.34%');
    });
  });

  describe('byte format', () => {
    it('formats bytes with binary base', () => {
      const format: NumberFormat = {
        output: 'byte',
        decimalBytes: false,
      };
      expect(formatNumber(1024, format)).toBe('1 KB');
    });

    it('formats bytes with decimal base', () => {
      const format: NumberFormat = {
        output: 'byte',
        decimalBytes: true,
      };
      expect(formatNumber(1000, format)).toBe('1 KB');
    });
  });

  describe('time format', () => {
    it('formats seconds input', () => {
      const format: NumberFormat = {
        output: 'time',
        factor: 1, // seconds
      };
      expect(formatNumber(3661, format)).toBe('1:01:01');
    });

    it('formats milliseconds input', () => {
      const format: NumberFormat = {
        output: 'time',
        factor: 0.001, // milliseconds
      };
      expect(formatNumber(61000, format)).toBe('0:01:01');
    });

    it('formats microseconds input', () => {
      const format: NumberFormat = {
        output: 'time',
        factor: 0.000001, // microseconds
      };
      expect(formatNumber(1000000, format)).toBe('0:00:01');
    });

    it('formats nanoseconds input', () => {
      const format: NumberFormat = {
        output: 'time',
        factor: 0.000000001, // nanoseconds
      };
      expect(formatNumber(1000000001, format)).toBe('0:00:01');
    });
  });

  describe('duration format', () => {
    it('formats seconds input as adaptive duration', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 1,
      };
      expect(formatNumber(30.41, format)).toBe('30.41s');
      expect(formatNumber(0.045, format)).toBe('45ms');
      expect(formatNumber(3661, format)).toBe('1.02h');
    });

    it('formats milliseconds input as adaptive duration', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 0.001,
      };
      expect(formatNumber(30410, format)).toBe('30.41s');
      expect(formatNumber(45, format)).toBe('45ms');
    });

    it('formats nanoseconds input as adaptive duration', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 0.000000001,
      };
      expect(formatNumber(30410000000, format)).toBe('30.41s');
      expect(formatNumber(45000000, format)).toBe('45ms');
      expect(formatNumber(500, format)).toBe('0.5µs');
    });

    it('handles zero value', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 1,
      };
      expect(formatNumber(0, format)).toBe('0ms');
    });

    it('defaults factor to 1 (seconds) when not specified', () => {
      const format: NumberFormat = {
        output: 'duration',
      };
      expect(formatNumber(1.5, format)).toBe('1.5s');
    });

    it('formats sub-millisecond values as microseconds', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 1,
      };
      expect(formatNumber(0.0003, format)).toBe('300µs');
    });

    it('formats large values as hours', () => {
      const format: NumberFormat = {
        output: 'duration',
        factor: 1,
      };
      expect(formatNumber(7200, format)).toBe('2h');
    });
  });

  describe('unit handling', () => {
    it('appends unit to formatted number', () => {
      const format: NumberFormat = {
        output: 'number',
        unit: 'ms',
      };
      expect(formatNumber(1234, format)).toBe('1234 ms');
    });
  });

  describe('average format', () => {
    it('formats large numbers with abbreviations when average is true', () => {
      const format: NumberFormat = {
        output: 'number',
        average: true,
      };
      expect(formatNumber(1234567, format)).toBe('1m');
    });
  });

  describe('numericUnit with data output (byte)', () => {
    it('formats with fixed unit suffix', () => {
      expect(
        formatNumber(500, {
          output: 'byte',
          numericUnit: NumericUnit.Kibibytes,
        }),
      ).toBe('500 KiB');
      expect(
        formatNumber(500, {
          output: 'byte',
          numericUnit: NumericUnit.Megabytes,
          mantissa: 1,
        }),
      ).toBe('500.0 MB');
    });

    it('auto-scales IEC bytes', () => {
      expect(
        formatNumber(0, {
          output: 'byte',
          numericUnit: NumericUnit.BytesIEC,
        }),
      ).toBe('0 B');
      expect(
        formatNumber(1024, {
          output: 'byte',
          numericUnit: NumericUnit.BytesIEC,
        }),
      ).toBe('1 KiB');
      expect(
        formatNumber(1048576, {
          output: 'byte',
          numericUnit: NumericUnit.BytesIEC,
          mantissa: 2,
        }),
      ).toBe('1.00 MiB');
    });

    it('auto-scales SI bytes', () => {
      expect(
        formatNumber(1000, {
          output: 'byte',
          numericUnit: NumericUnit.BytesSI,
        }),
      ).toBe('1 KB');
      expect(
        formatNumber(1000000, {
          output: 'byte',
          numericUnit: NumericUnit.BytesSI,
        }),
      ).toBe('1 MB');
    });

    it('auto-scales IEC bits', () => {
      expect(
        formatNumber(1024, {
          output: 'byte',
          numericUnit: NumericUnit.BitsIEC,
        }),
      ).toBe('1 Kibit');
    });

    it('auto-scales SI bits', () => {
      expect(
        formatNumber(1000, {
          output: 'byte',
          numericUnit: NumericUnit.BitsSI,
        }),
      ).toBe('1 Kbit');
    });

    it('handles negative values in auto-scale', () => {
      expect(
        formatNumber(-1024, {
          output: 'byte',
          numericUnit: NumericUnit.BytesIEC,
        }),
      ).toBe('-1 KiB');
      expect(
        formatNumber(-1500000, {
          output: 'byte',
          numericUnit: NumericUnit.BytesSI,
          mantissa: 2,
        }),
      ).toBe('-1.50 MB');
    });

    it('falls back to numbro for byte output without numericUnit', () => {
      // Without numericUnit, the legacy numbro byte formatting is used
      expect(formatNumber(1024, { output: 'byte', decimalBytes: false })).toBe(
        '1 KB',
      );
    });
  });

  describe('numericUnit with data_rate output', () => {
    it('formats fixed data rate units', () => {
      expect(
        formatNumber(42, {
          output: 'data_rate',
          numericUnit: NumericUnit.PacketsSec,
        }),
      ).toBe('42 pkt/s');
      expect(
        formatNumber(100, {
          output: 'data_rate',
          numericUnit: NumericUnit.KilobytesSec,
          mantissa: 1,
        }),
      ).toBe('100.0 KB/s');
    });

    it('auto-scales data rate (IEC bytes/s)', () => {
      expect(
        formatNumber(1024, {
          output: 'data_rate',
          numericUnit: NumericUnit.BytesSecIEC,
        }),
      ).toBe('1 KiB/s');
    });

    it('auto-scales data rate (SI bits/s)', () => {
      expect(
        formatNumber(1000, {
          output: 'data_rate',
          numericUnit: NumericUnit.BitsSecSI,
        }),
      ).toBe('1 Kbit/s');
    });

    it('falls back to plain toFixed for data_rate without numericUnit', () => {
      expect(formatNumber(1234.567, { output: 'data_rate', mantissa: 2 })).toBe(
        '1234.57',
      );
    });

    it('handles string-type numeric values', () => {
      expect(
        formatNumber('500', {
          output: 'byte',
          numericUnit: NumericUnit.Kibibytes,
        }),
      ).toBe('500 KiB');

      expect(
        formatNumber('1024', {
          output: 'data_rate',
          numericUnit: NumericUnit.BytesSecIEC,
        }),
      ).toBe('1 KiB/s');
    });
  });

  describe('numericUnit with throughput output', () => {
    it('formats fixed throughput units', () => {
      expect(
        formatNumber(100, {
          output: 'throughput',
          numericUnit: NumericUnit.Rps,
        }),
      ).toBe('100 rps');
      expect(
        formatNumber(50, {
          output: 'throughput',
          numericUnit: NumericUnit.Iops,
        }),
      ).toBe('50 iops');
      expect(
        formatNumber(200, {
          output: 'throughput',
          numericUnit: NumericUnit.Opm,
          mantissa: 1,
        }),
      ).toBe('200.0 opm');
    });

    it('falls back to plain toFixed for throughput without numericUnit', () => {
      expect(formatNumber(9999, { output: 'throughput' })).toBe('9999');
    });
  });

  describe('numericUnit ignored for non-data outputs', () => {
    it('ignores numericUnit for number output', () => {
      // numericUnit is only checked for byte/data_rate/throughput
      expect(
        formatNumber(1024, {
          output: 'number',
          numericUnit: NumericUnit.BytesIEC,
        }),
      ).toBe('1024');
    });

    it('ignores numericUnit for percent output', () => {
      expect(
        formatNumber(0.5, {
          output: 'percent',
          numericUnit: NumericUnit.BytesIEC,
        }),
      ).toBe('50%');
    });
  });

  describe('NaN handling', () => {
    it('returns "N/A" for NaN without options', () => {
      expect(formatNumber(NaN)).toBe('N/A');
      expect(formatNumber(NaN, { output: 'number', mantissa: 2 })).toBe('N/A');
    });

    it('returns a string unchanged if a number cannot be parsed from it', () => {
      expect(formatNumber('not a number')).toBe('not a number');

      expect(
        formatNumber('not a number', { output: 'number', mantissa: 2 }),
      ).toBe('not a number');
    });
  });
});

describe('formatDurationMs', () => {
  it('formats zero', () => {
    expect(formatDurationMs(0)).toBe('0ms');
  });

  it('formats microseconds', () => {
    expect(formatDurationMs(0.5)).toBe('500µs');
    expect(formatDurationMs(0.003)).toBe('3µs');
    expect(formatDurationMs(0.01)).toBe('10µs');
  });

  it('formats milliseconds', () => {
    expect(formatDurationMs(1)).toBe('1ms');
    expect(formatDurationMs(45)).toBe('45ms');
    expect(formatDurationMs(999)).toBe('999ms');
    expect(formatDurationMs(5.5)).toBe('5.5ms');
  });

  it('formats seconds', () => {
    expect(formatDurationMs(1000)).toBe('1s');
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(30410)).toBe('30.41s');
  });

  it('formats minutes', () => {
    expect(formatDurationMs(60000)).toBe('1min');
    expect(formatDurationMs(90000)).toBe('1.5min');
  });

  it('formats hours', () => {
    expect(formatDurationMs(3600000)).toBe('1h');
    expect(formatDurationMs(7200000)).toBe('2h');
  });

  it('handles negative values', () => {
    expect(formatDurationMs(-1500)).toBe('-1.5s');
  });

  it('handles sub-microsecond precision', () => {
    expect(formatDurationMs(0.0005)).toBe('0.5µs');
  });
});

describe('useLocalStorage', () => {
  // Create a mock for localStorage
  let localStorageMock: jest.Mocked<Storage>;

  beforeEach(() => {
    // Clear all mocks between tests
    jest.clearAllMocks();

    // Create localStorage mock
    localStorageMock = {
      getItem: jest.fn().mockImplementation((_: string) => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      length: 0,
    };

    // Replace window.localStorage with our mock
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterAll(() => {
    // Restore original implementations
    jest.restoreAllMocks();
  });

  test('should initialize with initial value when localStorage is empty', () => {
    // Mock localStorage.getItem to return null (empty)
    localStorageMock.getItem.mockReturnValueOnce(null);

    const initialValue = { test: 'value' };
    const { result } = renderHook(() =>
      utils.useLocalStorage('testKey', initialValue),
    );

    // Check if initialized with initial value
    expect(result.current[0]).toEqual(initialValue);

    // Verify localStorage was checked
    expect(localStorageMock.getItem).toHaveBeenCalledWith('testKey');
  });

  test('should retrieve existing value from localStorage', () => {
    // Mock localStorage to return existing value
    const existingValue = { test: 'existing' };
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(existingValue));

    const { result } = renderHook(() =>
      utils.useLocalStorage('testKey', { test: 'default' }),
    );

    // Should use the value from localStorage, not the initial value
    expect(result.current[0]).toEqual(existingValue);
    expect(localStorageMock.getItem).toHaveBeenCalledWith('testKey');
  });

  test('should update localStorage when setValue is called', () => {
    localStorageMock.getItem.mockReturnValueOnce(null);

    const { result } = renderHook(() =>
      utils.useLocalStorage('testKey', 'initial'),
    );

    // Update value
    const newValue = 'updated';
    act(() => {
      result.current[1](newValue);
    });

    // Check if state updated
    expect(result.current[0]).toBe(newValue);

    // Check if localStorage was updated
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'testKey',
      JSON.stringify(newValue),
    );
  });

  test('should handle functional updates', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(0));

    const { result } = renderHook(() =>
      utils.useLocalStorage<number>('testKey', 0),
    );

    // Update using function
    act(() => {
      result.current[1](prev => prev + 1);
    });

    // Check if state updated correctly
    expect(result.current[0]).toBe(1);

    // Check if localStorage was updated
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'testKey',
      JSON.stringify(1),
    );
  });

  test('should handle storage event from another window', () => {
    // Initial setup
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify('initial'));

    const { result } = renderHook(() =>
      utils.useLocalStorage('testKey', 'initial'),
    );

    // Update mock to return new value when checked after event
    localStorageMock.getItem.mockReturnValue(JSON.stringify('external update'));

    // Dispatch storage event
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'testKey',
          newValue: JSON.stringify('external update'),
        }),
      );
    });

    // State should be updated
    expect(result.current[0]).toBe('external update');
  });

  test('should handle customStorage event from same window but different hook instance', () => {
    // First hook instance
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify('initial1'));
    const { result: result1 } = renderHook(() =>
      utils.useLocalStorage('sharedKey', 'initial1'),
    );

    // Second hook instance
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify('initial1'));
    const { result: result2 } = renderHook(() =>
      utils.useLocalStorage('sharedKey', 'initial2'),
    );

    // Clear mock calls count
    localStorageMock.getItem.mockClear();

    // When the second hook checks localStorage after custom event
    localStorageMock.getItem.mockReturnValue(
      JSON.stringify('updated by hook 1'),
    );

    // Update value in the first instance
    act(() => {
      result1.current[1]('updated by hook 1');
    });

    // Manually trigger custom event (since it's happening within the same test)
    act(() => {
      const event = new CustomEvent<utils.CustomStorageChangeDetail>(
        'customStorage',
        {
          detail: {
            key: 'sharedKey',
            instanceId: 'some-id', // Different from the instance updating
          },
        },
      );
      window.dispatchEvent(event);
    });

    // The second instance should have updated values
    expect(result2.current[0]).toBe('updated by hook 1');
  });

  test('should not update if storage event is for a different key', () => {
    // Initial setup
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify('initial'));
    const { result } = renderHook(() =>
      utils.useLocalStorage('testKey', 'initial'),
    );

    // Clear the mock calls counter
    localStorageMock.getItem.mockClear();

    // Simulate storage event for a different key
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'differentKey',
          newValue: JSON.stringify('different value'),
        }),
      );
    });

    // State should remain unchanged
    expect(result.current[0]).toBe('initial');
    // localStorage should not be accessed since key doesn't match
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
  });
});

describe('stripTrailingSlash', () => {
  it('should throw an error for nullish values', () => {
    expect(() => stripTrailingSlash(null)).toThrow(
      'URL must be a non-empty string',
    );
    expect(() => stripTrailingSlash(undefined)).toThrow(
      'URL must be a non-empty string',
    );
  });

  it('should throw an error for non-string values', () => {
    expect(() => stripTrailingSlash(123 as any)).toThrow(
      'URL must be a non-empty string',
    );
    expect(() => stripTrailingSlash({} as any)).toThrow(
      'URL must be a non-empty string',
    );
  });

  it('should remove trailing slash from URLs', () => {
    expect(stripTrailingSlash('http://example.com/')).toBe(
      'http://example.com',
    );
    expect(stripTrailingSlash('http://example.com/api/')).toBe(
      'http://example.com/api',
    );
  });

  it('should not modify URLs without trailing slash', () => {
    expect(stripTrailingSlash('http://example.com')).toBe('http://example.com');
    expect(stripTrailingSlash('http://example.com/api')).toBe(
      'http://example.com/api',
    );
  });

  it('should handle URLs with multiple trailing slashes', () => {
    expect(stripTrailingSlash('http://example.com///')).toBe(
      'http://example.com//',
    );
  });
});

describe('useQueryHistory', () => {
  const mockGetItem = jest.fn();
  const mockSetItem = jest.fn();
  const mockRemoveItem = jest.fn();
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockRemoveItem.mockClear();
    mockGetItem.mockReturnValue('["service = test3","service = test1"]');
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (...args: string[]) => mockGetItem(...args),
        setItem: (...args: string[]) => mockSetItem(...args),
        removeItem: (...args: string[]) => mockRemoveItem(...args),
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it('adds new query', () => {
    const { result } = renderHook(() => useQueryHistory('searchSQL'));
    const setQueryHistory = result.current[1];
    act(() => {
      setQueryHistory('service = test2');
    });

    expect(mockSetItem).toHaveBeenCalledWith(
      'QuerySearchHistory.searchSQL',
      '["service = test2","service = test3","service = test1"]',
    );
  });

  it('does not add duplicate query, but change the order to front', () => {
    const { result } = renderHook(() => useQueryHistory('searchSQL'));
    const setQueryHistory = result.current[1];
    act(() => {
      setQueryHistory('service = test1');
    });

    expect(mockSetItem).toHaveBeenCalledWith(
      'QuerySearchHistory.searchSQL',
      '["service = test1","service = test3"]',
    );
  });

  it('does not add empty query', () => {
    const { result } = renderHook(() => useQueryHistory('searchSQL'));
    const setQueryHistory = result.current[1];
    act(() => {
      setQueryHistory('   '); // empty after trim
    });
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe('sortingStateToOrderByString', () => {
  it('returns undefined for null input', () => {
    expect(sortingStateToOrderByString(null)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    const sortingState: SortingState = [];
    expect(sortingStateToOrderByString(sortingState)).toBeUndefined();
  });

  it('converts sorting state with desc: false to ASC order', () => {
    const sortingState: SortingState = [{ id: 'timestamp', desc: false }];
    expect(sortingStateToOrderByString(sortingState)).toBe('timestamp ASC');
  });

  it('converts sorting state with desc: true to DESC order', () => {
    const sortingState: SortingState = [{ id: 'timestamp', desc: true }];
    expect(sortingStateToOrderByString(sortingState)).toBe('timestamp DESC');
  });

  it('handles column names with special characters', () => {
    const sortingState: SortingState = [{ id: 'user_count', desc: false }];
    expect(sortingStateToOrderByString(sortingState)).toBe('user_count ASC');
  });
});

describe('orderByStringToSortingState', () => {
  it('returns undefined for undefined input', () => {
    expect(orderByStringToSortingState(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(orderByStringToSortingState('')).toBeUndefined();
  });

  it('converts "column ASC" to sorting state with desc: false', () => {
    const result = orderByStringToSortingState('timestamp ASC');
    expect(result).toEqual([{ id: 'timestamp', desc: false }]);
  });

  it('converts "column DESC" to sorting state with desc: true', () => {
    const result = orderByStringToSortingState('timestamp DESC');
    expect(result).toEqual([{ id: 'timestamp', desc: true }]);
  });

  it('handles case insensitive direction keywords', () => {
    expect(orderByStringToSortingState('col asc')).toEqual([
      { id: 'col', desc: false },
    ]);
    expect(orderByStringToSortingState('col Asc')).toEqual([
      { id: 'col', desc: false },
    ]);
    expect(orderByStringToSortingState('col desc')).toEqual([
      { id: 'col', desc: true },
    ]);
    expect(orderByStringToSortingState('col Desc')).toEqual([
      { id: 'col', desc: true },
    ]);
    expect(orderByStringToSortingState('col DESC')).toEqual([
      { id: 'col', desc: true },
    ]);
  });

  it('returns undefined for invalid format without direction', () => {
    expect(orderByStringToSortingState('timestamp')).toBeUndefined();
  });

  it('returns undefined for invalid format with wrong number of parts', () => {
    expect(orderByStringToSortingState('col name ASC')).toBeUndefined();
  });

  it('returns undefined for invalid direction keyword', () => {
    expect(orderByStringToSortingState('col INVALID')).toBeUndefined();
  });

  it('handles column names with underscores', () => {
    const result = orderByStringToSortingState('user_count DESC');
    expect(result).toEqual([{ id: 'user_count', desc: true }]);
  });

  it('handles column names with numbers', () => {
    const result = orderByStringToSortingState('col123 ASC');
    expect(result).toEqual([{ id: 'col123', desc: false }]);
  });

  it('round-trips correctly with sortingStateToOrderByString', () => {
    const originalSort: SortingState = [{ id: 'service_name', desc: true }];
    const orderByString = sortingStateToOrderByString(originalSort);
    const roundTripSort = orderByStringToSortingState(orderByString);
    expect(roundTripSort).toEqual(originalSort);
  });
});

describe('mapKeyBy', () => {
  it('returns a map', () => {
    const result = mapKeyBy([{ id: 'a' }, { id: 'b' }], 'id');
    expect(result).toBeInstanceOf(Map);
  });

  it('adds each item to the map, keyed by the provided `key` param', () => {
    const data = [{ id: 'a' }, { id: 'b' }];
    const result = mapKeyBy(data, 'id');
    expect(result.size).toBe(2);
    expect(result.get('a')).toBe(data.at(0));
    expect(result.get('b')).toBe(data.at(1));
  });

  it('overwrites items with the same key', () => {
    const data = [{ id: 'a' }, { id: 'a' }];
    const result = mapKeyBy(data, 'id');
    expect(result.size).toBe(1);
    expect(result.get('a')).toBe(data.at(1));
  });
});

describe('parseTimestampToMs', () => {
  it('returns integer ms when there are no sub-millisecond digits', () => {
    const result = parseTimestampToMs('2024-01-01T00:00:01.000000000Z');
    expect(result).toBe(new Date('2024-01-01T00:00:01.000Z').getTime());
  });

  it('preserves sub-millisecond precision as a fractional ms', () => {
    const base = new Date('2024-01-01T00:00:01.000Z').getTime();
    const result = parseTimestampToMs('2024-01-01T00:00:01.000500000Z');
    expect(result).toBeCloseTo(base + 0.5, 4);
  });

  it('preserves whole-millisecond component when sub-ms digits are also present', () => {
    const base = new Date('2024-01-01T00:00:01.500Z').getTime();
    const result = parseTimestampToMs('2024-01-01T00:00:01.500500000Z');
    expect(result).toBeCloseTo(base + 0.5, 4);
  });

  it('handles max sub-millisecond value (999 µs + 999 ns)', () => {
    const base = new Date('2024-01-01T00:00:01.000Z').getTime();
    const result = parseTimestampToMs('2024-01-01T00:00:01.000999999Z');
    expect(result).toBeCloseTo(base + 0.999999, 3);
  });

  it('orders two timestamps within the same millisecond correctly', () => {
    const earlier = parseTimestampToMs('2024-01-01T00:00:01.000400000Z');
    const later = parseTimestampToMs('2024-01-01T00:00:01.000800000Z');
    expect(earlier).toBeLessThan(later);
  });
});

describe('formatDurationMsCompact', () => {
  it('returns 0 for zero', () => {
    expect(formatDurationMsCompact(0)).toBe('0');
  });

  it('formats negative values', () => {
    expect(formatDurationMsCompact(-5)).toBe('-5ms');
  });

  it('formats nanoseconds (< 0.001 ms)', () => {
    expect(formatDurationMsCompact(0.0005)).toBe('500ns');
    expect(formatDurationMsCompact(0.00012)).toBe('120ns');
  });

  it('formats microseconds (< 1 ms)', () => {
    expect(formatDurationMsCompact(0.005)).toBe('5µs');
    expect(formatDurationMsCompact(0.5)).toBe('500µs');
    expect(formatDurationMsCompact(0.123)).toBe('123µs');
  });

  it('formats milliseconds (< 1000 ms)', () => {
    expect(formatDurationMsCompact(5)).toBe('5ms');
    expect(formatDurationMsCompact(5.67)).toBe('5.7ms');
    expect(formatDurationMsCompact(100)).toBe('100ms');
    expect(formatDurationMsCompact(999)).toBe('999ms');
  });

  it('formats seconds (< 2 min)', () => {
    expect(formatDurationMsCompact(1000)).toBe('1s');
    expect(formatDurationMsCompact(5432)).toBe('5.43s');
    expect(formatDurationMsCompact(60_000)).toBe('60s');
    expect(formatDurationMsCompact(119_999)).toBe('120s');
  });

  it('formats minutes (< 1 hour)', () => {
    expect(formatDurationMsCompact(120_000)).toBe('2m');
    expect(formatDurationMsCompact(300_000)).toBe('5m');
    expect(formatDurationMsCompact(3_599_999)).toBe('60m');
  });

  it('formats hours (>= 1 hour)', () => {
    expect(formatDurationMsCompact(3_600_000)).toBe('1h');
    expect(formatDurationMsCompact(7_200_000)).toBe('2h');
  });
});

describe('mergePath', () => {
  describe('default (Array / unknown column)', () => {
    it('returns the bare key for a single-segment path', () => {
      expect(mergePath(['Body'])).toBe('Body');
    });

    it('numeric sub-segment becomes 1-based array index', () => {
      // ClickHouse arrays are 1-based but flattened data uses 0-based indices.
      expect(mergePath(['SomeArray', '0'])).toBe('SomeArray[1]');
      expect(mergePath(['SomeArray', '4'])).toBe('SomeArray[5]');
    });

    it('non-numeric sub-segment becomes string-key subscript', () => {
      expect(mergePath(['SomeColumn', 'service.name'])).toBe(
        "SomeColumn['service.name']",
      );
    });

    it('mixed numeric and string segments chain', () => {
      expect(mergePath(['Outer', '1', 'inner'])).toBe("Outer[2]['inner']");
    });
  });

  describe('JSON column', () => {
    it('emits dotted backtick-quoted accessor', () => {
      expect(mergePath(['BodyJson', 'service', 'name'], ['BodyJson'])).toBe(
        'BodyJson.`service`.`name`',
      );
    });
  });

  describe('Map column (HDX-4369)', () => {
    // Failing reproducer from the issue body: on a Map(String, String), a
    // numeric-looking sub-key must NOT collapse into array-index syntax.
    // ClickHouse rejects `LogAttributes[2]` against a Map column with
    // "Illegal types of arguments: Map(String, String), UInt8 for function
    // arrayElement". The fix adds a `mapColumns` parameter that forces the
    // bracketed string-key form regardless of whether the key parses as a
    // non-negative integer.
    it('numeric sub-key on a Map renders as string subscript, not array index', () => {
      const result = mergePath(['LogAttributes', '1'], [], ['LogAttributes']);
      expect(result).not.toBe('LogAttributes[2]');
      expect(result).not.toMatch(/\[\d+\]$/);
      expect(result).toBe("LogAttributes['1']");
    });

    it('non-numeric Map sub-key keeps string subscript (unchanged)', () => {
      expect(
        mergePath(['LogAttributes', 'service.name'], [], ['LogAttributes']),
      ).toBe("LogAttributes['service.name']");
    });

    it('multi-segment Map path chains string subscripts', () => {
      expect(
        mergePath(['LogAttributes', '1', 'foo'], [], ['LogAttributes']),
      ).toBe("LogAttributes['1']['foo']");
    });

    it('Array column with numeric key still uses array-index syntax', () => {
      // Inverse case: keep existing behavior for non-Map parents.
      expect(mergePath(['SomeArray', '1'], [], ['LogAttributes'])).toBe(
        'SomeArray[2]',
      );
    });

    it('JSON column wins over Map column when both lists contain the key', () => {
      // Caller can't currently configure the same column as both; the order
      // is deterministic if they did.
      expect(mergePath(['Body', '1'], ['Body'], ['Body'])).toBe('Body.`1`');
    });
  });

  describe('SQL escaping of single quotes and backslashes', () => {
    // Keys can contain user-controlled characters (Map sub-keys carry
    // arbitrary text). An unescaped single quote produces malformed SQL like
    // `Map['it's']`, which ClickHouse parses as the broken token sequence
    // `Map['it']s']`. Backslash must escape first so the quote-escape
    // backslash is not itself doubled.
    it('escapes single quotes in Map sub-keys', () => {
      expect(mergePath(['LogAttributes', "it's"], [], ['LogAttributes'])).toBe(
        "LogAttributes['it\\'s']",
      );
    });

    it('escapes backslashes in Map sub-keys', () => {
      expect(
        mergePath(['LogAttributes', 'back\\slash'], [], ['LogAttributes']),
      ).toBe("LogAttributes['back\\\\slash']");
    });

    it('escapes a key containing both a backslash and a quote', () => {
      expect(
        mergePath(['LogAttributes', "a\\b'c"], [], ['LogAttributes']),
      ).toBe("LogAttributes['a\\\\b\\'c']");
    });

    it('escapes single quotes in default-branch string subscripts', () => {
      // The default Array / unknown column branch also takes string-key
      // subscripts when the segment is non-numeric. Same escape applies.
      expect(mergePath(['SomeColumn', "it's"])).toBe("SomeColumn['it\\'s']");
    });

    it('leaves numeric segments untouched in the default branch', () => {
      // Numeric path collapses to bracketed integer index; escape is a
      // no-op because Number.isInteger(asNumber) succeeds. Sanity check.
      expect(mergePath(['SomeArray', '0'])).toBe('SomeArray[1]');
    });
  });
});

describe('getColorFromCSSToken', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the categorical hex directly from CATEGORICAL_HEX_BY_TOKEN without reading CSS', () => {
    // Categorical tokens are unified across themes, so the resolver
    // intentionally skips getComputedStyle to avoid a per-series
    // layout read. A CSS-var override has no effect on the returned
    // value (and shouldn't be relied upon by JS callers).
    const getComputedStyleSpy = jest
      .spyOn(global, 'getComputedStyle')
      .mockReturnValue({
        getPropertyValue: () => '#should-be-ignored',
      } as unknown as CSSStyleDeclaration);

    expect(getColorFromCSSToken('chart-blue')).toBe(COLORS[0]);
    expect(getComputedStyleSpy).not.toHaveBeenCalled();
  });

  it('returns the CSS variable value for semantic tokens when provided', () => {
    jest.spyOn(global, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) =>
        name === '--color-chart-success' ? '#theme-green' : '',
    } as unknown as CSSStyleDeclaration);

    expect(getColorFromCSSToken('chart-success')).toBe('#theme-green');
  });

  it('falls back to SEMANTIC_CHART_PALETTE when getComputedStyle throws for semantic tokens', () => {
    jest.spyOn(global, 'getComputedStyle').mockImplementation(() => {
      throw new Error('getComputedStyle unavailable');
    });

    // Defaults to HyperDX in jsdom because the document has no
    // theme-clickstack class.
    expect(getColorFromCSSToken('chart-success')).toBe('#3ca951');
    expect(getColorFromCSSToken('chart-warning')).toBe('#efb118');
    expect(getColorFromCSSToken('chart-error')).toBe('#ff725c');
  });

  it('returns the canonical hex for every categorical token in CATEGORICAL_PALETTE_TOKENS', () => {
    utils.CATEGORICAL_PALETTE_TOKENS.forEach((token, i) => {
      expect(getColorFromCSSToken(token)).toBe(COLORS[i]);
    });
  });

  it('schema rejects legacy chart-1..10; render-time consumers rely on resolveChartPaletteToken instead', () => {
    // The schema is deliberately strict (no `z.preprocess`) so that
    // its `z.input` type matches its `z.output` type — otherwise
    // `validateRequest` in the API would infer `req.body.tiles[i]
    // .config.color` as `unknown`. Legacy migration for stored
    // configs from #2265 happens at fetch time via
    // `normalizeDashboardTileColors` and at render time via
    // `resolveChartPaletteToken`.
    expect(() => ChartPaletteTokenSchema.parse('chart-1')).toThrow();
    expect(() => ChartPaletteTokenSchema.parse('chart-10')).toThrow();
  });
});

// ─── evaluateColorCondition ───────────────────────────────────────────────────

describe('evaluateColorCondition', () => {
  describe('numeric ordered operators', () => {
    it('gt: returns true when value > rule.value', () => {
      const rule: ColorCondition = {
        operator: 'gt',
        value: 10,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(11, rule)).toBe(true);
      expect(evaluateColorCondition(10, rule)).toBe(false);
      expect(evaluateColorCondition(9, rule)).toBe(false);
    });

    it('gte: returns true when value >= rule.value', () => {
      const rule: ColorCondition = {
        operator: 'gte',
        value: 10,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(10, rule)).toBe(true);
      expect(evaluateColorCondition(11, rule)).toBe(true);
      expect(evaluateColorCondition(9, rule)).toBe(false);
    });

    it('lt: returns true when value < rule.value', () => {
      const rule: ColorCondition = {
        operator: 'lt',
        value: 10,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(9, rule)).toBe(true);
      expect(evaluateColorCondition(10, rule)).toBe(false);
    });

    it('lte: returns true when value <= rule.value', () => {
      const rule: ColorCondition = {
        operator: 'lte',
        value: 10,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(10, rule)).toBe(true);
      expect(evaluateColorCondition(9, rule)).toBe(true);
      expect(evaluateColorCondition(11, rule)).toBe(false);
    });

    it('numeric operators return false for string values', () => {
      const rule: ColorCondition = {
        operator: 'gt',
        value: 10,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition('15', rule)).toBe(false);
    });
  });

  describe('between operator', () => {
    it('returns true when value is within [lo, hi]', () => {
      const rule: ColorCondition = {
        operator: 'between',
        value: [10, 100],
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(50, rule)).toBe(true);
      expect(evaluateColorCondition(10, rule)).toBe(true);
      expect(evaluateColorCondition(100, rule)).toBe(true);
      expect(evaluateColorCondition(9, rule)).toBe(false);
      expect(evaluateColorCondition(101, rule)).toBe(false);
    });

    it('handles inverted range (first > second) by normalising to [lo, hi]', () => {
      const rule: ColorCondition = {
        operator: 'between',
        value: [100, 10],
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(50, rule)).toBe(true);
      expect(evaluateColorCondition(5, rule)).toBe(false);
    });

    it('returns false for string values', () => {
      const rule: ColorCondition = {
        operator: 'between',
        value: [10, 100],
        color: 'chart-blue',
      };
      expect(evaluateColorCondition('50', rule)).toBe(false);
    });
  });

  describe('eq / neq operators', () => {
    it('eq: returns true on strict equality (number)', () => {
      const rule: ColorCondition = {
        operator: 'eq',
        value: 5,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(5, rule)).toBe(true);
      expect(evaluateColorCondition(6, rule)).toBe(false);
    });

    it('eq: returns true on strict equality (string)', () => {
      const rule: ColorCondition = {
        operator: 'eq',
        value: 'CRIT',
        color: 'chart-blue',
      };
      expect(evaluateColorCondition('CRIT', rule)).toBe(true);
      expect(evaluateColorCondition('crit', rule)).toBe(false);
    });

    it('eq: cross-type mismatch returns false ("5" vs 5)', () => {
      const rule: ColorCondition = {
        operator: 'eq',
        value: '5',
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(5, rule)).toBe(false);
    });

    it('neq: returns true when value differs', () => {
      const rule: ColorCondition = {
        operator: 'neq',
        value: 0,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition(1, rule)).toBe(true);
      expect(evaluateColorCondition(0, rule)).toBe(false);
    });

    it('neq: cross-type mismatch returns false (number vs string)', () => {
      const rule: ColorCondition = {
        operator: 'neq',
        value: 'none',
        color: 'chart-blue',
      };
      // Without the typeof guard, `42 !== 'none'` is true, which would make
      // the rule match every numeric value. Guarding keeps the docstring
      // contract: cross-type mismatches return false.
      expect(evaluateColorCondition(42, rule)).toBe(false);
    });

    it('neq: cross-type mismatch returns false (string vs number)', () => {
      const rule: ColorCondition = {
        operator: 'neq',
        value: 42,
        color: 'chart-blue',
      };
      expect(evaluateColorCondition('none', rule)).toBe(false);
    });
  });

  describe('string operators', () => {
    it('contains: returns true when string includes value', () => {
      const rule: ColorCondition = {
        operator: 'contains',
        value: 'error',
        color: 'chart-error',
      };
      expect(evaluateColorCondition('fatal error occurred', rule)).toBe(true);
      expect(evaluateColorCondition('warning', rule)).toBe(false);
    });

    it('contains: returns false for number values', () => {
      const rule: ColorCondition = {
        operator: 'contains',
        value: 'error',
        color: 'chart-error',
      };
      expect(evaluateColorCondition(42, rule)).toBe(false);
    });

    it('startsWith: matches prefix', () => {
      const rule: ColorCondition = {
        operator: 'startsWith',
        value: 'ERR',
        color: 'chart-error',
      };
      expect(evaluateColorCondition('ERR_500', rule)).toBe(true);
      expect(evaluateColorCondition('WARN_ERR', rule)).toBe(false);
    });

    it('endsWith: matches suffix', () => {
      const rule: ColorCondition = {
        operator: 'endsWith',
        value: 'CRIT',
        color: 'chart-error',
      };
      expect(evaluateColorCondition('ALERT_CRIT', rule)).toBe(true);
      expect(evaluateColorCondition('CRIT_OK', rule)).toBe(false);
    });

    it('regex: matches valid pattern', () => {
      const rule: ColorCondition = {
        operator: 'regex',
        value: '^err.*',
        color: 'chart-error',
      };
      expect(evaluateColorCondition('error123', rule)).toBe(true);
      expect(evaluateColorCondition('warning', rule)).toBe(false);
    });

    it('regex: bad pattern returns false without throwing', () => {
      const rule = {
        operator: 'regex' as const,
        value: '[invalid',
        color: 'chart-error' as const,
      };
      expect(() => evaluateColorCondition('test', rule)).not.toThrow();
      expect(evaluateColorCondition('test', rule)).toBe(false);
    });
  });
});

// ─── resolveConditionalColor ──────────────────────────────────────────────────

describe('resolveConditionalColor', () => {
  it('returns fallback when rules is undefined', () => {
    expect(resolveConditionalColor(50, undefined, 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('returns fallback when rules is empty', () => {
    expect(resolveConditionalColor(50, [], 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('returns fallback when value is null', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 0, color: 'chart-warning' },
    ];
    expect(resolveConditionalColor(null, rules, 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('returns fallback when value is undefined', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 0, color: 'chart-warning' },
    ];
    expect(resolveConditionalColor(undefined, rules, 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('returns the matching rule color when one rule matches', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 100, color: 'chart-warning' },
    ];
    expect(resolveConditionalColor(200, rules, 'chart-success')).toBe(
      'chart-warning',
    );
  });

  it('returns the LAST matching rule color (last-match-wins)', () => {
    // value 1000: both rules match; last (chart-error) wins
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 100, color: 'chart-warning' },
      { operator: 'gte', value: 500, color: 'chart-error' },
    ];
    expect(resolveConditionalColor(1000, rules, 'chart-success')).toBe(
      'chart-error',
    );
  });

  it('returns fallback when no rule matches', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 100, color: 'chart-warning' },
      { operator: 'gte', value: 500, color: 'chart-error' },
    ];
    // value 50: no rule matches, return fallback
    expect(resolveConditionalColor(50, rules, 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('covers the DBNumberChart success/warning/error scenario', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 100, color: 'chart-warning' },
      { operator: 'gte', value: 500, color: 'chart-error' },
    ];
    // 50 → no match → static color
    expect(resolveConditionalColor(50, rules, 'chart-success')).toBe(
      'chart-success',
    );
    // 200 → rule 1 matches, rule 2 doesn't → chart-warning
    expect(resolveConditionalColor(200, rules, 'chart-success')).toBe(
      'chart-warning',
    );
    // 1000 → both match → last match = chart-error
    expect(resolveConditionalColor(1000, rules, 'chart-success')).toBe(
      'chart-error',
    );
  });

  it('string rules do not match numeric values', () => {
    const rules: ColorCondition[] = [
      { operator: 'contains', value: 'err', color: 'chart-error' },
    ];
    // numeric value, string rule: no match
    expect(resolveConditionalColor(42, rules, 'chart-success')).toBe(
      'chart-success',
    );
  });

  it('returns undefined fallback when fallback is undefined and no rule matches', () => {
    const rules: ColorCondition[] = [
      { operator: 'gte', value: 100, color: 'chart-warning' },
    ];
    expect(resolveConditionalColor(50, rules, undefined)).toBeUndefined();
  });
});
