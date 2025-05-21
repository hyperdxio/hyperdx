import { chSql, parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

import { renderChartConfig } from '../renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: Metadata;

  beforeEach(() => {
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
      getColumn: jest.fn().mockResolvedValue({ type: 'DateTime' }),
    } as unknown as Metadata;
  });

  it('should generate sql for a single gauge metric', async () => {
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

    const generatedSql = await renderChartConfig(config, mockMetadata);
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
});
