import { TSource } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { MetricsDataType, NumberFormat } from '../types';
import * as utils from '../utils';
import {
  formatAttributeClause,
  formatDate,
  formatNumber,
  getMetricTableName,
  stripTrailingSlash,
  useQueryHistory,
} from '../utils';

describe('utils', () => {
  it('12h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: true,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: true,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });

  it('12h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: false,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: false,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });
});

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

    it('applies factor multiplication', () => {
      const format: NumberFormat = {
        output: 'number',
        factor: 0.001, // Convert to milliseconds
      };
      expect(formatNumber(1000, format)).toBe('1');
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
    expect(mockSetItem).not.toBeCalled();
  });
});
