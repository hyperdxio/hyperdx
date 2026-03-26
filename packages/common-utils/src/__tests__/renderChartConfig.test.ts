import { chSql, ColumnMeta, parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  QuerySettings,
} from '@/types';

import {
  ChartConfigWithOptDateRangeEx,
  renderChartConfig,
  timeFilterExpr,
} from '../core/renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: jest.Mocked<Metadata>;

  beforeEach(() => {
    const columns = [
      { name: 'timestamp', type: 'DateTime' },
      { name: 'value', type: 'Float64' },
      { name: 'TraceId', type: 'String' },
      { name: 'ServiceName', type: 'String' },
    ];
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
      getColumn: jest
        .fn()
        .mockImplementation(async ({ column }) =>
          columns.find(col => col.name === column),
        ),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'timestamp' }),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
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

  const querySettings: QuerySettings = [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '1' },
    { setting: 'additional_result_filter', value: 'x != 2' },
    { setting: 'count_distinct_implementation', value: 'uniqCombined64' },
    { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
  ];

  it('should generate sql for a single gauge metric', async () => {
    const generatedSql = await renderChartConfig(
      gaugeConfiguration,
      mockMetadata,
      querySettings,
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
      querySettings,
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

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
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

    await expect(
      renderChartConfig(config, mockMetadata, querySettings),
    ).rejects.toThrow('multi select or string select on metrics not supported');
  });

  describe('histogram metric queries', () => {
    describe('quantile', () => {
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });
    });

    describe('count', () => {
      it('should generate a count query without grouping or time bucketing', async () => {
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
              aggFn: 'count',
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a count query without grouping but time bucketing', async () => {
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
              aggFn: 'count',
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a count query with grouping and time bucketing', async () => {
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
              aggFn: 'count',
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

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow(
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

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming sql object in CTE');
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

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming chartConfig object in CTE');
    });
  });

  describe('materialized column optimization with expression alias CTEs', () => {
    it('should rewrite WHERE to use materialized column when with clauses are expression aliases (isSubquery: false)', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(
          new Map([["LogAttributes['attr_key']", 'attr_key']]),
        );

      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        with: [
          {
            name: 'body',
            sql: chSql`toString(Body)`,
            isSubquery: false,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: "LogAttributes['attr_key'] = 'attr_val'",
        whereLanguage: 'sql',
        granularity: '1 minute',
        timestampValueExpression: 'Timestamp',
        dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);

      expect(mockMetadata.getMaterializedColumnsLookupTable).toHaveBeenCalled();
      expect(sql).toContain("attr_key = 'attr_val'");
      expect(sql).not.toContain("LogAttributes['attr_key']");
    });

    it('should skip materialized columns when with clauses are subquery CTEs', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(
          new Map([["LogAttributes['attr_key']", 'attr_key']]),
        );

      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: '',
          tableName: 'TestCte',
        },
        with: [
          {
            name: 'TestCte',
            sql: chSql`SELECT * FROM otel_logs`,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: '',
        whereLanguage: 'sql',
      };

      await renderChartConfig(config, mockMetadata, querySettings);
      expect(
        mockMetadata.getMaterializedColumnsLookupTable,
      ).not.toHaveBeenCalled();
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
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

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      // Should use the simple string comparison for regular metrics (not IN-based)
      expect(actual).toContain("MetricName = 'some.regular.metric'");
      expect(actual).not.toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });
  });

  describe('HAVING clause', () => {
    it('should render HAVING clause with SQL language', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: 'count(*) > 100',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 100');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with multiple conditions', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'metrics',
        },
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'response_time',
            aggCondition: '',
          },
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'endpoint',
        having: 'avg(response_time) > 500 AND count(*) > 10',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('avg(response_time) > 500 AND count(*) > 10');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when not provided', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with granularity and groupBy', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'events',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'event_type',
        having: 'count(*) > 50',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
        granularity: '5 minute',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 50');
      expect(actual).toContain('GROUP BY');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when having is empty string', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: '',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
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
      {
        description:
          'with wrapped toStartOfInterval in primary key (should not optimize)',
        timestampValueExpression: `timestamp`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        primaryKey:
          '-toInt64(toStartOfInterval(timestamp, toIntervalMinute(15))), service_id, timestamp',
        expected: `(timestamp >= fromUnixTimestamp64Milli(1739319154000) AND timestamp <= fromUnixTimestamp64Milli(1739491954000))`,
      },
      {
        description:
          'with toStartOfHour and dateRangeEndInclusive=false (must stay inclusive on coarse filter)',
        timestampValueExpression: 'toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'with compound expression and dateRangeEndInclusive=false (raw col exclusive, toStartOf inclusive)',
        timestampValueExpression: 'timestamp, toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()}))AND(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'with toStartOfHour and dateRangeStartInclusive=false (must stay inclusive on coarse filter)',
        timestampValueExpression: 'toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        expected: `(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
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

  it('should not generate invalid SQL when primary key wraps toStartOfInterval', async () => {
    mockMetadata.getTableMetadata.mockResolvedValue({
      primary_key:
        'proxy_tier, status, is_customer_content, -toInt64(toStartOfInterval(timestamp, toIntervalMinute(15))), service_id',
    } as any);

    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'http_request_logs',
      },
      select: 'timestamp, cluster_id, service_id',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'timestamp',
      dateRange: [
        new Date('2025-02-12 00:12:34Z'),
        new Date('2025-02-14 00:12:34Z'),
      ],
      limit: { limit: 200, offset: 0 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).not.toContain('toStartOfInterval(fromUnixTimestamp64Milli');
    expect(actual).toMatchSnapshot();
  });

  describe('Aggregate Merge Functions', () => {
    it('should generate SQL for an aggregate merge function', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'avgMerge',
            valueExpression: 'Duration',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('avgMerge(Duration)');
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an aggregate merge function with a condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'avgMerge',
            valueExpression: 'Duration',
            aggCondition: 'severity:"ERROR"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "avgMergeIf(Duration, ((severity = 'ERROR')) AND toFloat64OrDefault(toString(Duration)) IS NOT NULL)",
      );
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an quantile merge function with a condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'quantileMerge',
            aggCondition: 'severity:"ERROR"',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Duration',
            level: 0.95,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "quantileMergeIf(0.95)(Duration, ((severity = 'ERROR')) AND toFloat64OrDefault(toString(Duration)) IS NOT NULL)",
      );
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an histogram merge function', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'histogramMerge',
            valueExpression: 'Duration',
            level: 20,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('histogramMerge(20)(Duration)');
      expect(actual).toMatchSnapshot();
    });
  });

  describe('SETTINGS clause', () => {
    const config: ChartConfigWithOptDateRangeEx = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'logs',
      },
      select: [
        {
          aggFn: 'histogramMerge',
          valueExpression: 'Duration',
          level: 20,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      groupBy: 'severity',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };

    test('should apply the "query settings" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should apply the "chart config" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable'",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should concat the "chart config" and "query setting" settings and apply them to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable', optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });
  });

  it('returns sqlTemplate verbatim for raw sql config', async () => {
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate: 'SELECT count() FROM logs WHERE level = {level:String}',
      connection: 'conn-1',
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE level = {level:String}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: undefined,
      endDateMilliseconds: undefined,
    });
  });

  it('injects startDateMilliseconds and endDateMilliseconds params for raw sql config with dateRange', async () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate:
        'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
      connection: 'conn-1',
      dateRange: [start, end],
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: start.getTime(),
      endDateMilliseconds: end.getTime(),
    });
  });

  describe('raw sql macro replacement', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');

    it('replaces $__dateFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__dateFilter(d)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
      expect(result.params.startDateMilliseconds).toBe(start.getTime());
      expect(result.params.endDateMilliseconds).toBe(end.getTime());
    });

    it('replaces $__timeFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__timeFilter(ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
    });

    it('replaces $__timeFilter_ms macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__timeFilter_ms(ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
      );
    });

    it('replaces $__fromTime and $__toTime macros in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE ts >= $__fromTime AND ts <= $__toTime',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
    });

    it('replaces $__fromTime_ms and $__toTime_ms macros in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE ts >= $__fromTime_ms AND ts <= $__toTime_ms',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
      );
    });

    it('replaces $__dateTimeFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__dateTimeFilter(d, ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
      );
    });

    it('replaces $__timeInterval macro in raw sql Line config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT $__timeInterval(ts) AS t, count() FROM logs WHERE $__timeFilter(ts) GROUP BY t',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toContain(
        'toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second)',
      );
      expect(result.sql).toContain(
        'ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
      );
      expect(result.params.intervalSeconds).toBeGreaterThan(0);
    });

    it('replaces $__interval_s macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT toStartOfInterval(ts, INTERVAL $__interval_s second) FROM logs',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT toStartOfInterval(ts, INTERVAL {intervalSeconds:Int64} second) FROM logs',
      );
      expect(result.params.intervalSeconds).toBeGreaterThan(0);
    });

    it('passes through raw sql with no macros unchanged', async () => {
      const sql =
        'SELECT count() FROM logs WHERE ts >= {startDateMilliseconds:Int64}';
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: sql,
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(sql);
    });

    it('replaces $__filters macro with rendered filter conditions', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE $__timeFilter(ts) AND $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          filters: [
            { type: 'sql', condition: "ServiceName = 'api'" },
            { type: 'sql_ast', operator: '>', left: 'duration', right: '100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toContain(
        "AND ((ServiceName = 'api') AND (duration > 100))",
      );
    });

    it('replaces $__filters with 1 = 1 when no filters provided', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('replaces $__filters with 1 = 1 when source and from are defined but filters is empty', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          filters: [],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('renders lucene filters to SQL in $__filters when source is specified', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          implicitColumnExpression: 'Body',
          filters: [{ type: 'lucene', condition: 'ServiceName:api' }],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE (((ServiceName ILIKE '%api%')))",
      );
    });

    it('renders mixed lucene and sql filters in $__filters', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          implicitColumnExpression: 'Body',
          filters: [
            { type: 'lucene', condition: 'ServiceName:api' },
            { type: 'sql', condition: 'duration > 100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE (((ServiceName ILIKE '%api%')) AND (duration > 100))",
      );
    });

    it('skips filters without source metadata (no from)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          filters: [
            { type: 'lucene', condition: 'ServiceName:api' },
            { type: 'sql', condition: 'duration > 100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });
  });
});
