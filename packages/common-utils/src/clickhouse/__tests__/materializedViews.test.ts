import {
  isUnsupportedCountFunction,
  tryConvertConfigToMaterializedViewSelect,
  tryOptimizeConfigWithMaterializedView,
  tryOptimizeConfigWithMaterializedViewWithExplanations,
} from '@/core/materializedViews';
import { Metadata } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  MaterializedViewConfiguration,
} from '@/types';

import { ColumnMeta } from '..';
import { ClickhouseClient } from '../node';

describe('materializedViews', () => {
  const metadata: Metadata = {
    getColumn: jest.fn().mockImplementation(({ column }) => {
      const columns: Record<string, ColumnMeta> = {
        count: {
          type: 'SimpleAggregateFunction(sum, UInt64)',
        } as unknown as ColumnMeta,
        sum__Duration: {
          type: 'SimpleAggregateFunction(sum, UInt64)',
        } as unknown as ColumnMeta,
        avg__Duration: {
          type: 'AggregateFunction(avg, Int64)',
        } as unknown as ColumnMeta,
        histogram__Duration: {
          type: 'AggregateFunction(histogram(2), Int64)',
        } as unknown as ColumnMeta,
        quantile__Duration: {
          type: 'AggregateFunction(quantile(0.5), Int64)',
        } as unknown as ColumnMeta,
        StatusCode: {
          type: 'LowCardinality(String)',
        } as unknown as ColumnMeta,
      };
      return columns[column];
    }),
  } as unknown as Metadata;

  const MV_CONFIG_METRIC_ROLLUP_1M: MaterializedViewConfiguration = {
    databaseName: 'default',
    tableName: 'metrics_rollup_1m',
    dimensionColumns:
      'SpanKind, ServiceName, StatusCode, az, endpoint, version',
    minGranularity: '1 minute',
    timestampColumn: 'Timestamp',
    aggregatedColumns: [
      { aggFn: 'count', mvColumn: 'count' },
      { aggFn: 'sum', sourceColumn: 'Duration', mvColumn: 'sum__Duration' },
      { aggFn: 'avg', sourceColumn: 'Duration', mvColumn: 'avg__Duration' },
      {
        aggFn: 'histogram',
        sourceColumn: 'Duration',
        mvColumn: 'histogram__Duration',
      },
      {
        aggFn: 'quantile',
        sourceColumn: 'Duration',
        mvColumn: 'quantile__Duration',
      },
    ],
  };

  const MV_CONFIG_DB_STATEMENT_ROLLUP_1S: MaterializedViewConfiguration = {
    databaseName: 'default',
    tableName: 'db_statement_rollup_1s',
    dimensionColumns: 'ServiceName, db.statement',
    minGranularity: '1 second',
    timestampColumn: 'Timestamp',
    aggregatedColumns: [
      { aggFn: 'count', mvColumn: 'count' },
      { aggFn: 'sum', sourceColumn: 'Duration', mvColumn: 'sum__Duration' },
      { aggFn: 'avg', sourceColumn: 'Duration', mvColumn: 'avg__Duration' },
    ],
  };

  const SOURCE = {
    from: { databaseName: 'default', tableName: 'otel_spans' },
    materializedViews: [MV_CONFIG_METRIC_ROLLUP_1M],
  };

  describe('tryConvertConfigToMaterializedViewSelect', () => {
    it('should return empty object if selecting a string instead of an array of aggregates', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: 'count(), StatusCode',
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result).toEqual({
        errors: ['Only array-based select statements are supported.'],
      });
    });

    it('should return mvConfig and errors if selecting a column which is not in the materialized view', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'non_existent_column',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        "The aggregate function sum is not available for column 'non_existent_column'.",
      ]);
    });

    it('should return mvConfig and errors if selecting an aggregation which is not supported for the specified column', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'min',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        "The aggregate function min is not available for column 'Duration'.",
      ]);
    });

    it('should convert a SimpleAggregateFunction select', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'sum__Duration',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should convert an AggregateFunction select', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'avg__Duration',
            aggFn: 'avgMerge',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should convert an quantile AggregateFunction select', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'quantile',
            level: 0.95,
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'quantile__Duration',
            aggFn: 'quantileMerge',
            level: 0.95,
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should convert a histogram AggregateFunction select', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'histogram',
            level: 20,
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'histogram__Duration',
            aggFn: 'histogramMerge',
            level: 20,
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should preserve the where clause and group by columns during conversion', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'sum',
          },
        ],
        where: "StatusCode = '200'",
        groupBy: 'StatusCode',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'sum__Duration',
            aggFn: 'sum',
          },
        ],
        where: "StatusCode = '200'",
        groupBy: 'StatusCode',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should preserve aliases', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'sum',
            alias: 'Total Duration',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'sum__Duration',
            aggFn: 'sum',
            alias: 'Total Duration',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should support multiple aggregates for multi-series charts', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        where: '',
        connection: 'test-connection',
        select: [
          {
            aggFn: 'quantile',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Duration',
            level: 0.95,
          },
          {
            aggFn: 'quantile',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Duration',
            level: 0.99,
          },
        ],
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'quantile__Duration',
            aggFn: 'quantileMerge',
            level: 0.95,
          },
          {
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'quantile__Duration',
            aggFn: 'quantileMerge',
            level: 0.99,
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should leave aggConditions intact when converting', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'sum',
            aggCondition: 'StatusCode:"Error"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'sum__Duration',
            aggFn: 'sum',
            aggCondition: 'StatusCode:"Error"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('supports count() aggregations with valueExpression defined', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('supports count() aggregations without valueExpression defined as empty string', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('supports count() aggregations with sourceColumn defined in MV Configuration', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        {
          ...MV_CONFIG_METRIC_ROLLUP_1M,
          aggregatedColumns: [
            { aggFn: 'count', sourceColumn: 'Duration', mvColumn: 'count' },
          ],
        },
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should return mvConfig and errors if the granularity of the query is less than the materialized view granularity', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
        granularity: '30 seconds',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual(['Granularity must be at least 1 minute.']);
    });

    it('should return mvConfig and errors if no granularity is specified but the date range is too short for the MV granularity', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
        dateRange: [
          new Date('2023-01-01T00:00:00Z'),
          new Date('2023-01-01T00:00:30Z'),
        ],
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        'The selected date range is too short for the granularity of this materialized view.',
      ]);
    });

    it('should optimize a config with a granularity equal to the minimum materialized view granularity', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
        granularity: '1 minute',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
        granularity: '1 minute',
      });
      expect(result.errors).toBeUndefined();
    });

    it('should return an error when attempting to aggregate a column which is a dimension column', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'StatusCode',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        "The aggregate function sum is not available for column 'StatusCode'.",
      ]);
    });

    it('should prevent usage of custom count() expressions', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: "countIf(StatusCode='Error') / count()",
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        'Custom count() expressions are not supported with materialized views.',
      ]);
    });

    it("should not use the materialized view when the chart config references a date range prior to the MV's date range", async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
        dateRange: [
          new Date('2022-12-01T00:00:00Z'),
          new Date('2022-12-31T23:59:59Z'),
        ],
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        {
          ...MV_CONFIG_METRIC_ROLLUP_1M,
          minDate: '2023-01-01T00:00:00Z',
        },
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        'The selected date range includes dates for which this view does not contain data.',
      ]);
    });

    it('should not use the materialized view when the chart config has no date range and the MV has a minimum date', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        {
          ...MV_CONFIG_METRIC_ROLLUP_1M,
          minDate: '2023-01-01T00:00:00Z',
        },
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        'The selected date range includes dates for which this view does not contain data.',
      ]);
    });

    it("should use the materialized view when the chart config's date range is after the MV's minimum date", async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
        dateRange: [
          new Date('2023-12-01T00:00:00Z'),
          new Date('2023-12-31T23:59:59Z'),
        ],
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        {
          ...MV_CONFIG_METRIC_ROLLUP_1M,
          minDate: '2023-01-01T00:00:00Z',
        },
        metadata,
      );

      expect(result.optimizedConfig).toEqual({
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        dateRange: [
          new Date('2023-12-01T00:00:00Z'),
          new Date('2023-12-31T23:59:59Z'),
        ],
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
      });
      expect(result.errors).toBeUndefined();
    });
  });

  describe('isUnsupportedCountFunction', () => {
    it.each([
      [true, 'count()'],
      [true, 'countIf('],
      [true, ' COUNT ( ) '],
      [false, 'count'],
      [true, 'error_count / count()'],
      [false, 'countDistinct('],
    ])('should be %s for valueExpression "%s"', (expected, valueExpression) => {
      expect(isUnsupportedCountFunction({ valueExpression })).toBe(expected);
    });
  });

  describe('tryOptimizeConfigWithMaterializedView', () => {
    const mockClickHouseClient = {
      testChartConfigValidity: jest.fn(),
    } as unknown as jest.Mocked<ClickhouseClient>;

    beforeEach(() => {
      jest.clearAllMocks();

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: true,
        rowEstimate: 1000,
        error: undefined,
      });
    });

    it('should return the original config if no materialized view optimization is possible', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'table_without_mv',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        {
          from: { databaseName: 'default', tableName: 'table_without_mv' },
        },
      );

      expect(actual).toEqual(chartConfig);
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).not.toHaveBeenCalled();
    });

    it('should return the original config if the generated MV config is not valid', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: false,
        error: '',
      });

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        SOURCE,
      );

      expect(actual).toEqual(chartConfig);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            from: {
              databaseName: 'default',
              tableName: 'metrics_rollup_1m',
            },
            select: [
              {
                valueExpression: 'avg__Duration',
                aggFn: 'avgMerge',
              },
            ],
            where: '',
            connection: 'test-connection',
          },
        }),
      );
    });

    it('should return the optimized config if a valid materialized view configuration is generated', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'avg__Duration',
            aggFn: 'avgMerge',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        SOURCE,
      );

      expect(actual).toEqual(optimizedConfig);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });

    it('should return an optimized config when there are expressions referencing optimized columns', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
            alias: 'error_count',
            aggCondition: 'lower(StatusCode) = "error"',
            aggConditionLanguage: 'sql',
          },
          {
            valueExpression: '',
            aggFn: 'count',
            alias: 'total_count',
          },
          {
            valueExpression: `error_count / total_count`,
            alias: 'Error Rate %',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
            alias: 'error_count',
            aggCondition: 'lower(StatusCode) = "error"',
            aggConditionLanguage: 'sql',
          },
          {
            valueExpression: 'count',
            aggFn: 'sum',
            alias: 'total_count',
          },
          {
            valueExpression: `error_count / total_count`,
            alias: 'Error Rate %',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        SOURCE,
      );

      expect(actual).toEqual(optimizedConfig);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });

    it('should return an optimized CTE', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        with: [
          {
            name: 'cte_1',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'otel_spans',
              },
              select: [
                {
                  valueExpression: 'Duration',
                  aggFn: 'avg',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
        ],
        select: '',
        from: {
          databaseName: '',
          tableName: 'cte_1',
        },
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        with: [
          {
            name: 'cte_1',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'metrics_rollup_1m',
              },
              select: [
                {
                  valueExpression: 'avg__Duration',
                  aggFn: 'avgMerge',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
        ],
        select: '',
        from: {
          databaseName: '',
          tableName: 'cte_1',
        },
        where: '',
        connection: 'test-connection',
      };

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        SOURCE,
      );

      expect(actual).toEqual(optimizedConfig);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });

    it('should return multiple optimized CTEs', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        with: [
          {
            name: 'cte_1',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'otel_spans',
              },
              select: [
                {
                  valueExpression: 'Duration',
                  aggFn: 'avg',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
          {
            name: 'cte_2',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'otel_spans',
              },
              select: [
                {
                  valueExpression: 'Duration',
                  aggFn: 'sum',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
        ],
        select: [
          {
            valueExpression: 'ServiceName',
          },
        ],
        from: {
          databaseName: '',
          tableName: 'cte_1',
        },
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        with: [
          {
            name: 'cte_1',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'metrics_rollup_1m',
              },
              select: [
                {
                  valueExpression: 'avg__Duration',
                  aggFn: 'avgMerge',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
          {
            name: 'cte_2',
            chartConfig: {
              from: {
                databaseName: 'default',
                tableName: 'metrics_rollup_1m',
              },
              select: [
                {
                  valueExpression: 'sum__Duration',
                  aggFn: 'sum',
                },
              ],
              where: '',
              connection: 'test-connection',
            },
          },
        ],
        select: [
          {
            valueExpression: 'ServiceName',
          },
        ],
        from: {
          databaseName: '',
          tableName: 'cte_1',
        },
        where: '',
        connection: 'test-connection',
      };

      const actual = await tryOptimizeConfigWithMaterializedView(
        chartConfig,
        metadata,
        mockClickHouseClient,
        {} as any,
        SOURCE,
      );

      expect(actual).toEqual(optimizedConfig);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });
  });

  describe('tryOptimizeConfigWithMaterializedViewWithExplanation', () => {
    const mockClickHouseClient = {
      testChartConfigValidity: jest.fn(),
    } as unknown as jest.Mocked<ClickhouseClient>;

    beforeEach(() => {
      jest.clearAllMocks();

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: true,
        rowEstimate: 1000,
        error: undefined,
      });
    });

    it('should return empty object if no materialized view optimization is possible', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'table_without_mv',
        },
        select: [
          {
            valueExpression: '',
            aggFn: 'count',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          {
            from: { databaseName: 'default', tableName: 'table_without_mv' },
          },
        );

      expect(result).toEqual({
        explanations: [],
        optimizedConfig: undefined,
      });
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).not.toHaveBeenCalled();
    });

    it('should return mvConfig and errors if the generated MV config is not valid', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: false,
        error: 'Error while constructing materialized view query.',
      });

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          SOURCE,
        );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.explanations).toEqual([
        {
          mvConfig: MV_CONFIG_METRIC_ROLLUP_1M,
          success: false,
          errors: ['Error while constructing materialized view query.'],
        },
      ]);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            from: {
              databaseName: 'default',
              tableName: 'metrics_rollup_1m',
            },
            select: [
              {
                valueExpression: 'avg__Duration',
                aggFn: 'avgMerge',
              },
            ],
            where: '',
            connection: 'test-connection',
          },
        }),
      );
    });

    it('should return the optimized config if a valid materialized view configuration is generated', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'avg__Duration',
            aggFn: 'avgMerge',
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          SOURCE,
        );

      expect(result.optimizedConfig).toEqual(optimizedConfig);
      expect(result.explanations).toEqual([
        {
          mvConfig: MV_CONFIG_METRIC_ROLLUP_1M,
          errors: [],
          rowEstimate: 1000,
          success: true,
        },
      ]);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });

    it('should optimize a config with a second materialized view if the first view does not support the query', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
        timestampValueExpression: 'Timestamp',
        granularity: '1 second',
      };

      const optimizedConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'db_statement_rollup_1s',
        },
        select: [
          {
            valueExpression: 'avg__Duration',
            aggFn: 'avgMerge',
          },
        ],
        where: '',
        connection: 'test-connection',
        timestampValueExpression: 'Timestamp',
        granularity: '1 second',
      };

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          {
            ...SOURCE,
            materializedViews: [
              MV_CONFIG_METRIC_ROLLUP_1M,
              MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
            ],
          },
        );

      expect(result.optimizedConfig).toEqual(optimizedConfig);
      expect(result.explanations).toEqual([
        {
          mvConfig: MV_CONFIG_METRIC_ROLLUP_1M,
          errors: ['Granularity must be at least 1 minute.'],
          success: false,
        },
        {
          mvConfig: MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
          errors: [],
          rowEstimate: 1000,
          success: true,
        },
      ]);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });

    it('should optimize a config with the MV that will scan the fewest rows, if multiple MVs could be used', async () => {
      mockClickHouseClient.testChartConfigValidity.mockImplementation(
        ({ config }) => {
          if (config.from.tableName === 'db_statement_rollup_1s') {
            return Promise.resolve({
              isValid: true,
              rowEstimate: 1000,
              error: undefined,
            });
          }
          return Promise.resolve({
            isValid: true,
            rowEstimate: 10000,
            error: undefined,
          });
        },
      );

      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'avg',
          },
        ],
        where: '',
        connection: 'test-connection',
        timestampValueExpression: 'Timestamp',
        granularity: '1 hour',
      };

      const expectedOptimizedConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'db_statement_rollup_1s',
        },
        select: [
          {
            valueExpression: 'avg__Duration',
            aggFn: 'avgMerge',
          },
        ],
        where: '',
        connection: 'test-connection',
        timestampValueExpression: 'Timestamp',
        granularity: '1 hour',
      };

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          {
            ...SOURCE,
            materializedViews: [
              MV_CONFIG_METRIC_ROLLUP_1M,
              MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
            ],
          },
        );

      expect(result.optimizedConfig).toEqual(expectedOptimizedConfig);
      expect(result.explanations).toEqual([
        {
          mvConfig: MV_CONFIG_METRIC_ROLLUP_1M,
          errors: [],
          rowEstimate: 10000,
          success: false,
        },
        {
          mvConfig: MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
          errors: [],
          rowEstimate: 1000,
          success: true,
        },
      ]);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expectedOptimizedConfig,
        }),
      );
    });

    it('should return errors for all materialized views, even if only the first is used', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'otel_spans',
        },
        select: [
          {
            valueExpression: 'Duration',
            aggFn: 'quantile',
            level: 0.95,
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const optimizedConfig = {
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1m',
        },
        select: [
          {
            valueExpression: 'quantile__Duration',
            aggFn: 'quantileMerge',
            level: 0.95,
          },
        ],
        where: '',
        connection: 'test-connection',
      };

      const result =
        await tryOptimizeConfigWithMaterializedViewWithExplanations(
          chartConfig,
          metadata,
          mockClickHouseClient,
          {} as any,
          {
            ...SOURCE,
            materializedViews: [
              MV_CONFIG_METRIC_ROLLUP_1M,
              MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
            ],
          },
        );

      expect(result.optimizedConfig).toEqual(optimizedConfig);
      expect(result.explanations).toEqual([
        {
          mvConfig: MV_CONFIG_METRIC_ROLLUP_1M,
          errors: [],
          rowEstimate: 1000,
          success: true,
        },
        {
          mvConfig: MV_CONFIG_DB_STATEMENT_ROLLUP_1S,
          errors: [
            "The aggregate function p95 is not available for column 'Duration'.",
          ],
          success: false,
        },
      ]);
      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: optimizedConfig,
        }),
      );
    });
  });
});
