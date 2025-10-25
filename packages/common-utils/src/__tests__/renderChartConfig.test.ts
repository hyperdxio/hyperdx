import { chSql, ColumnMeta, parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

import { renderChartConfig, timeFilterExpr } from '../renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: jest.Mocked<Metadata>;

  beforeEach(() => {
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
      getColumn: jest.fn().mockResolvedValue({ type: 'DateTime' }),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'timestamp' }),
    } as unknown as jest.Mocked<Metadata>;
  });

  const gaugeConfiguration: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Line,
    connection: 'test-connection',
    // metricTables is added from the Source object via spread operator
    metricTables: {
      gauge: 'otel_metrics_gauge',
      histogram: 'otel_metrics_histogram',
      sum: 'otel_metrics_sum',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    },
    from: {
      databaseName: 'default',
      tableName: '',
    },
    select: [
      {
        aggFn: 'quantile',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: 'Value',
        level: 0.95,
        metricName: 'nodejs.event_loop.utilization',
        metricType: MetricsDataType.Gauge,
      },
    ],
    where: '',
    whereLanguage: 'lucene',
    timestampValueExpression: 'TimeUnix',
    dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
    granularity: '1 minute',
    limit: { limit: 10 },
  };

  it('should generate sql for a single gauge metric', async () => {
    const generatedSql = await renderChartConfig(
      gaugeConfiguration,
      mockMetadata,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should generate sql for a single gauge metric with a delta() function applied', async () => {
    const generatedSql = await renderChartConfig(
      {
        ...gaugeConfiguration,
        select: [
          {
            aggFn: 'max',
            valueExpression: 'Value',
            metricName: 'nodejs.event_loop.utilization',
            metricType: MetricsDataType.Gauge,
            isDelta: true,
          },
        ],
      },
      mockMetadata,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should generate sql for a single sum metric', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      // metricTables is added from the Source object via spread operator
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should throw error for string select on sum metric', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: 'Value',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    await expect(renderChartConfig(config, mockMetadata)).rejects.toThrow(
      'multi select or string select on metrics not supported',
    );
  });

  describe('histogram metric queries', () => {
    it('should generate a query without grouping or time bucketing', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.5,
            valueExpression: 'Value',
            metricName: 'http.server.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should generate a query without grouping but time bucketing', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.5,
            valueExpression: 'Value',
            metricName: 'http.server.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '2 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should generate a query with grouping and time bucketing', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.5,
            valueExpression: 'Value',
            metricName: 'http.server.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '2 minute',
        groupBy: `ResourceAttributes['host']`,
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });
  });

  describe('containing CTE clauses', () => {
    it('should render a ChSql CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: '',
          tableName: 'TestCte',
        },
        with: [
          { name: 'TestCte', sql: chSql`SELECT TimeUnix, Line FROM otel_logs` },
        ],
        select: [{ valueExpression: 'Line' }],
        where: '',
        whereLanguage: 'sql',
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should render a chart config CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'Parts',
            chartConfig: {
              connection: 'test-connection',
              timestampValueExpression: '',
              select: '_part, _part_offset',
              from: { databaseName: 'default', tableName: 'some_table' },
              where: '',
              whereLanguage: 'sql',
              filters: [
                {
                  type: 'sql',
                  condition: `FieldA = 'test'`,
                },
              ],
              orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
              limit: { limit: 1000 },
            },
          },
        ],
        select: '*',
        filters: [
          {
            type: 'sql',
            condition: `FieldA = 'test'`,
          },
          {
            type: 'sql',
            condition: `indexHint((_part, _part_offset) IN (SELECT tuple(_part, _part_offset) FROM Parts))`,
          },
        ],
        from: {
          databaseName: '',
          tableName: 'Parts',
        },
        where: '',
        whereLanguage: 'sql',
        orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
        limit: { limit: 1000 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should throw if the CTE is missing both sql and chartConfig', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            // Intentionally omitting both sql and chartConfig properties
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(renderChartConfig(config, mockMetadata)).rejects.toThrow(
        "must specify either 'sql' or 'chartConfig' in with clause",
      );
    });

    it('should throw if the CTE sql param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            sql: 'SELECT * FROM some_table' as any, // Intentionally not a ChSql object
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(renderChartConfig(config, mockMetadata)).rejects.toThrow(
        'non-conforming sql object in CTE',
      );
    });

    it('should throw if the CTE chartConfig param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            chartConfig: {
              // Missing required properties like select, from, etc.
              connection: 'test-connection',
            } as any, // Intentionally invalid chartConfig
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(renderChartConfig(config, mockMetadata)).rejects.toThrow(
        'non-conforming chartConfig object in CTE',
      );
    });
  });

  describe('k8s semantic convention migrations', () => {
    it('should generate SQL with metricNameSql for k8s.pod.cpu.utilization gauge metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'k8s.pod.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
            metricType: MetricsDataType.Gauge,
          },
        ],
        where: '',
        whereLanguage: 'lucene',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);

      // Verify the SQL contains the IN-based metric name condition
      expect(actual).toContain('k8s.pod.cpu.utilization');
      expect(actual).toContain('k8s.pod.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for k8s.node.cpu.utilization sum metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'max',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'k8s.node.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.node.cpu.utilization', 'k8s.node.cpu.usage')",
            metricType: MetricsDataType.Sum,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '5 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('k8s.node.cpu.utilization');
      expect(actual).toContain('k8s.node.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for container.cpu.utilization histogram metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            valueExpression: 'Value',
            metricName: 'container.cpu.utilization',
            metricNameSql:
              "MetricName IN ('container.cpu.utilization', 'container.cpu.usage')",
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '2 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('container.cpu.utilization');
      expect(actual).toContain('container.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for histogram metric with groupBy', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.99,
            valueExpression: 'Value',
            metricName: 'k8s.pod.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        groupBy: `ResourceAttributes['k8s.pod.name']`,
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('k8s.pod.cpu.utilization');
      expect(actual).toContain('k8s.pod.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should handle metrics without metricNameSql (backward compatibility)', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'some.regular.metric',
            // No metricNameSql provided
            metricType: MetricsDataType.Gauge,
          },
        ],
        where: '',
        whereLanguage: 'lucene',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(config, mockMetadata);
      const actual = parameterizedQueryToSql(generatedSql);

      // Should use the simple string comparison for regular metrics (not IN-based)
      expect(actual).toContain("MetricName = 'some.regular.metric'");
      expect(actual).not.toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });
  });

  describe('timeFilterExpr', () => {
    type TimeFilterExprTestCase = {
      timestampValueExpression: string;
      dateRangeStartInclusive?: boolean;
      dateRangeEndInclusive?: boolean;
      dateRange: [Date, Date];
      includedDataInterval?: string;
      expected: string;
      description: string;
      tableName?: string;
      databaseName?: string;
      primaryKey?: string;
    };

    const testCases: TimeFilterExprTestCase[] = [
      {
        description: 'with basic timestampValueExpression',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with dateRangeEndInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with dateRangeStartInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeStartInclusive: false,
        expected: `(timestamp > fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with includedDataInterval',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        includedDataInterval: '1 WEEK',
        expected: `(timestamp >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 1 WEEK) - INTERVAL 1 WEEK AND timestamp <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 1 WEEK) + INTERVAL 1 WEEK)`,
      },
      {
        description: 'with date type timestampValueExpression',
        timestampValueExpression: 'date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with multiple timestampValueExpression parts',
        timestampValueExpression: 'timestamp, date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))AND(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfDay() in timestampExpr',
        timestampValueExpression: 'toStartOfDay(timestamp)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfDay(timestamp) >= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND toStartOfDay(timestamp) <= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfDay  () in timestampExpr',
        timestampValueExpression: 'toStartOfDay  (timestamp)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfDay  (timestamp) >= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND toStartOfDay  (timestamp) <= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfInterval() in timestampExpr',
        timestampValueExpression:
          'toStartOfInterval(timestamp, INTERVAL 12  MINUTE)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, INTERVAL 12  MINUTE) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 12  MINUTE) AND toStartOfInterval(timestamp, INTERVAL 12  MINUTE) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 12  MINUTE))`,
      },
      {
        description:
          'with toStartOfInterval() with lowercase interval in timestampExpr',
        timestampValueExpression:
          'toStartOfInterval(timestamp, interval 1 minute)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, interval 1 minute) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), interval 1 minute) AND toStartOfInterval(timestamp, interval 1 minute) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), interval 1 minute))`,
      },
      {
        description: 'with toStartOfInterval() with timezone and offset',
        timestampValueExpression: `toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York')`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') AND toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York'))`,
      },
      {
        description: 'with nonstandard spacing',
        timestampValueExpression: ` toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) `,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL  1 MINUTE, toDateTime ( '2023-01-01 14:35:30' ), 'America/New_York') AND toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL  1 MINUTE, toDateTime ( '2023-01-01 14:35:30' ), 'America/New_York'))`,
      },
      {
        description: 'with optimizable timestampValueExpression',
        timestampValueExpression: `timestamp`,
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(1739319154000) AND timestamp <= fromUnixTimestamp64Milli(1739491954000))AND(toStartOfMinute(timestamp) >= toStartOfMinute(fromUnixTimestamp64Milli(1739319154000)) AND toStartOfMinute(timestamp) <= toStartOfMinute(fromUnixTimestamp64Milli(1739491954000)))`,
      },
      {
        description: 'with synthetic timestamp value expression for CTE',
        timestampValueExpression: `__hdx_time_bucket`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        databaseName: '',
        tableName: 'Bucketed',
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        expected: `(__hdx_time_bucket >= fromUnixTimestamp64Milli(1739319154000) AND __hdx_time_bucket <= fromUnixTimestamp64Milli(1739491954000))`,
      },

      {
        description: 'with toStartOfMinute in timestampValueExpression',
        timestampValueExpression: `toStartOfMinute(timestamp)`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        expected: `(toStartOfMinute(timestamp) >= toStartOfMinute(fromUnixTimestamp64Milli(1739319154000)) AND toStartOfMinute(timestamp) <= toStartOfMinute(fromUnixTimestamp64Milli(1739491954000)))`,
      },
    ];

    beforeEach(() => {
      mockMetadata.getColumn.mockImplementation(async ({ column }) =>
        column === 'date'
          ? ({ type: 'Date' } as ColumnMeta)
          : ({ type: 'DateTime' } as ColumnMeta),
      );
    });

    it.each(testCases)(
      'should generate a time filter expression $description',
      async ({
        timestampValueExpression,
        dateRangeEndInclusive = true,
        dateRangeStartInclusive = true,
        dateRange,
        expected,
        includedDataInterval,
        tableName = 'target_table',
        databaseName = 'default',
        primaryKey,
      }) => {
        if (primaryKey) {
          mockMetadata.getTableMetadata.mockResolvedValue({
            primary_key: primaryKey,
          } as any);
        }

        const actual = await timeFilterExpr({
          timestampValueExpression,
          dateRangeEndInclusive,
          dateRangeStartInclusive,
          dateRange,
          connectionId: 'test-connection',
          databaseName,
          tableName,
          metadata: mockMetadata,
          includedDataInterval,
        });

        const actualSql = parameterizedQueryToSql(actual);
        expect(actualSql).toBe(expected);
      },
    );
  });
});
