import { TSource } from '@hyperdx/common-utils/dist/types';
import { SortingState } from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';

import { MetricsDataType, NumberFormat } from '../types';
import * as utils from '../utils';
import {
  formatAttributeClause,
  formatNumber,
  getMetricTableName,
  mapKeyBy,
  orderByStringToSortingState,
  sortingStateToOrderByString,
  stripTrailingSlash,
  useQueryHistory,
} from '../utils';

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

  describe('NaN handling', () => {
    it('returns "N/A" for NaN without options', () => {
      expect(formatNumber(NaN)).toBe('N/A');
      expect(formatNumber(NaN, { output: 'number', mantissa: 2 })).toBe('N/A');
    });

    it('returns a string unchanged if a number cannot be parsed from it', () => {
      // @ts-expect-error not passing a number
      expect(formatNumber('not a number')).toBe('not a number');

      expect(
        // @ts-expect-error not passing a number
        formatNumber('not a number', { output: 'number', mantissa: 2 }),
      ).toBe('not a number');
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
