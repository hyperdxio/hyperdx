import { TSource } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { MetricsDataType, NumberFormat } from '../types';
import {
  formatAttributeClause,
  formatDate,
  formatNumber,
  getMetricTableName,
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

describe('useQueryHistory', () => {
  const mockGetItem = jest.fn();
  const mockSetItem = jest.fn();
  const mockRemoveItem = jest.fn();

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
