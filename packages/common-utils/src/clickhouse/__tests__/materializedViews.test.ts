import {
  getConfigsForKeyValues,
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

    it('should return errors if selecting a column which is not in the materialized view', async () => {
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

    it('should return errors if selecting an aggregation which is not supported for the specified column', async () => {
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

    it('should return errors if the granularity of the query is less than the materialized view granularity', async () => {
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
        granularity: '30 second',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        "Granularity must be a multiple of the view's granularity (1 minute).",
      ]);
    });

    it('should return errors if the granularity of the query is greater than but not a multiple of the materialized view granularity', async () => {
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
        granularity: '90 second',
      };

      const result = await tryConvertConfigToMaterializedViewSelect(
        chartConfig,
        MV_CONFIG_METRIC_ROLLUP_1M,
        metadata,
      );

      expect(result.optimizedConfig).toBeUndefined();
      expect(result.errors).toEqual([
        "Granularity must be a multiple of the view's granularity (1 minute).",
      ]);
    });

    it('should return errors if no granularity is specified but the date range is too short for the MV granularity', async () => {
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
          new Date('2024-01-01T00:00:00Z'),
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
          new Date('2024-01-01T00:00:00Z'),
        ],
        select: [
          {
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
        dateRangeEndInclusive: false,
      });
      expect(result.errors).toBeUndefined();
    });

    it('should set dateRangeEndInclusive to false when optimizing a config with dateRange', async () => {
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
        dateRange: [
          new Date('2023-01-01T00:00:00Z'),
          new Date('2023-01-02T01:00:00Z'),
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
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
        granularity: '1 minute',
        dateRange: chartConfig.dateRange,
        dateRangeEndInclusive: false,
      });
      expect(result.errors).toBeUndefined();
    });

    it('should align dateRange to MV granularity when optimizing a config with dateRange', async () => {
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
          new Date('2023-01-01T00:00:30Z'),
          new Date('2023-01-02T01:00:45Z'),
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
            valueExpression: 'count',
            aggFn: 'sum',
          },
        ],
        where: '',
        connection: 'test-connection',
        dateRange: [
          new Date('2023-01-01T00:00:00Z'),
          new Date('2023-01-02T01:01:00Z'),
        ],
        dateRangeEndInclusive: false,
      });
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

    it('should return errors if the generated MV config is not valid', async () => {
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
          errors: [
            "Granularity must be a multiple of the view's granularity (1 minute).",
          ],
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

  describe('getConfigsForKeyValues', () => {
    const mockClickHouseClient = {
      testChartConfigValidity: jest.fn(),
    } as unknown as jest.Mocked<ClickhouseClient>;

    const MV_CONFIG_LOGS_1M: MaterializedViewConfiguration = {
      databaseName: 'default',
      tableName: 'logs_rollup_1m',
      dimensionColumns: 'environment, service, status_code',
      minGranularity: '1 minute',
      timestampColumn: 'Timestamp',
      aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
    };

    const MV_CONFIG_LOGS_1H: MaterializedViewConfiguration = {
      databaseName: 'default',
      tableName: 'logs_rollup_1h',
      dimensionColumns: 'environment, region',
      minGranularity: '1 hour',
      timestampColumn: 'Timestamp',
      aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
    };

    const MV_CONFIG_TRACES_1M: MaterializedViewConfiguration = {
      databaseName: 'default',
      tableName: 'traces_rollup_1m',
      dimensionColumns: 'service.name, endpoint',
      minGranularity: '1 minute',
      timestampColumn: 'Timestamp',
      aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return MVs for all keys when single MV covers all keys', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service', 'status_code'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M],
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: true,
        rowEstimate: 1000,
      });

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([
        {
          databaseName: 'default',
          tableName: 'logs_rollup_1m',
          keys: ['environment', 'service', 'status_code'],
        },
      ]);
      expect(result.uncoveredKeys).toEqual([]);
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).toHaveBeenCalledTimes(1);
    });

    it('should distribute keys across multiple MVs', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service', 'region'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M, MV_CONFIG_LOGS_1H],
      };

      mockClickHouseClient.testChartConfigValidity.mockImplementation(
        ({ config }) =>
          Promise.resolve({
            isValid: true,
            rowEstimate:
              config.from.tableName === 'logs_rollup_1h' ? 500 : 1000,
          }),
      );

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      // Should prefer logs_rollup_1h (500 rows) over logs_rollup_1m (1000 rows) for shared keys
      expect(result.mvs).toHaveLength(2);
      expect(result.mvs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            databaseName: 'default',
            tableName: 'logs_rollup_1h',
            keys: expect.arrayContaining(['environment', 'region']),
          }),
          expect.objectContaining({
            databaseName: 'default',
            tableName: 'logs_rollup_1m',
            keys: ['service'],
          }),
        ]),
      );
      expect(result.uncoveredKeys).toEqual([]);
    });

    it('should return uncovered keys when no MV supports them', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'unsupported_key'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M],
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: true,
        rowEstimate: 1000,
      });

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([
        {
          databaseName: 'default',
          tableName: 'logs_rollup_1m',
          keys: ['environment'],
        },
      ]);
      expect(result.uncoveredKeys).toEqual(['unsupported_key']);
    });

    it('should skip invalid MVs and return uncovered keys', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M],
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: false,
        error: 'Invalid query',
      });

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([]);
      expect(result.uncoveredKeys).toEqual(['environment', 'service']);
    });

    it('should prefer MVs with lower row estimates', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M, MV_CONFIG_LOGS_1H],
      };

      mockClickHouseClient.testChartConfigValidity.mockImplementation(
        ({ config }) =>
          Promise.resolve({
            isValid: true,
            rowEstimate:
              config.from.tableName === 'logs_rollup_1h' ? 500 : 1000,
          }),
      );

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([
        {
          databaseName: 'default',
          tableName: 'logs_rollup_1h',
          keys: ['environment'],
        },
      ]);
      expect(result.uncoveredKeys).toEqual([]);
    });

    it('should handle empty keys array', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys: string[] = [];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M],
      };

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([]);
      expect(result.uncoveredKeys).toEqual([]);
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).not.toHaveBeenCalled();
    });

    it('should handle source with no materialized views', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [],
      };

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([]);
      expect(result.uncoveredKeys).toEqual(['environment', 'service']);
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).not.toHaveBeenCalled();
    });

    it('should filter out MVs that do not support the date range', async () => {
      const MV_CONFIG_WITH_MIN_DATE: MaterializedViewConfiguration = {
        databaseName: 'default',
        tableName: 'logs_rollup_recent',
        dimensionColumns: 'environment, service',
        minGranularity: '1 minute',
        timestampColumn: 'Timestamp',
        aggregatedColumns: [{ aggFn: 'count', mvColumn: 'count' }],
        minDate: '2024-01-15',
      };

      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_WITH_MIN_DATE],
      };

      const result = await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(result.mvs).toEqual([]);
      expect(result.uncoveredKeys).toEqual(['environment', 'service']);
      expect(
        mockClickHouseClient.testChartConfigValidity,
      ).not.toHaveBeenCalled();
    });

    it('should generate correct select statement with multiple keys', async () => {
      const chartConfig: ChartConfigWithOptDateRange = {
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        where: '',
        connection: 'test-connection',
        dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
        select: '',
      };

      const keys = ['environment', 'service', 'status_code'];
      const source = {
        from: { databaseName: 'default', tableName: 'logs' },
        materializedViews: [MV_CONFIG_LOGS_1M],
      };

      mockClickHouseClient.testChartConfigValidity.mockResolvedValue({
        isValid: true,
        rowEstimate: 1000,
      });

      await getConfigsForKeyValues({
        chartConfig,
        keys,
        source: source as any,
        clickhouseClient: mockClickHouseClient,
        metadata,
      });

      expect(mockClickHouseClient.testChartConfigValidity).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            select:
              'groupUniqArray(1)(environment) AS param0, groupUniqArray(1)(service) AS param1, groupUniqArray(1)(status_code) AS param2',
          }),
          metadata,
        }),
      );
    });
  });
});
