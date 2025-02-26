import { TSource } from '@hyperdx/common-utils/dist/types';

import { MetricsDataType } from '../types';
import {
  formatAttributeClause,
  formatDate,
  getMetricTableName,
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
      tableName: 'default_table',
      databaseName: 'test_db',
    },
    id: 'test-id',
    name: 'test-source',
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    kind: 'logs' as const,
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

    expect(getMetricTableName(source)).toBe('default_table');
    expect(getMetricTableName(source, undefined)).toBe('default_table');
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

    expect(getMetricTableName(source)).toBe('default_table');
    expect(
      getMetricTableName(source, 'gauge' as MetricsDataType),
    ).toBeUndefined();
  });
});
