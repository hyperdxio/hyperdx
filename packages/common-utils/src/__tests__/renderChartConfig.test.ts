import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/metadata';
import { ChartConfigWithOptDateRange, DisplayType } from '@/types';

import { renderChartConfig } from '../renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: Metadata;

  beforeEach(() => {
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue({}),
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
      },
      from: {
        databaseName: 'default',
        tableName: 'metrics', // trigger for metric logic
      },
      select: [
        {
          aggFn: 'avg',
          alias: 'Utilization',
          valueExpression: '',
          metricType: 'gauge', // new field; narrow down table search
          metricName: 'nodejs.event_loop.utilization', // new field; the what
        },
        // {
        //   aggFn: 'count',
        //   alias: 'CPU Utilization',
        //   valueExpression: '',
        //   metricType: 'gauge', // new field; narrow down table search
        //   metricName: 'cpu_utilization', // new field; the what
        // },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2024-02-12'), new Date('2024-02-14')],
      granularity: '1 minute',
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    console.log(actual);

    // expect(actual).toBe(
    //   "SELECT countIf(MetricName = 'cpu_utilization') AS `CPU Utilization`,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` FROM default.otel_metrics_gauge WHERE (TimeUnix >= fromUnixTimestamp64Milli(1704067200000) AND TimeUnix <= fromUnixTimestamp64Milli(1704153600000)) AND (MetricName = 'cpu_utilization') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` ",
    // );
  });

  //   it('should generate sql for multiple gauge metrics', async () => {
  //     const config: ChartConfigWithOptDateRange = {
  //       displayType: DisplayType.Line,
  //       connection: 'test-connection',
  //       // metricTables is added from the Source object via spread operator
  //       metricTables: {
  //         gauge: 'otel_metrics_gauge',
  //         histogram: 'otel_metrics_histogram',
  //         sum: 'otel_metrics_sum',
  //       },
  //       from: {
  //         databaseName: 'default',
  //         tableName: 'metrics', // trigger for metric logic
  //       },
  //       select: [
  //         {
  //           aggFn: 'count',
  //           alias: 'CPU Utilization',
  //           valueExpression: '',
  //           metricType: 'gauge', // new field; narrow down table search
  //           metricName: 'cpu_utilization', // new field; the what
  //         },
  //         {
  //           aggFn: 'quantile',
  //           level: 0.99,
  //           alias: '99th Percentile Heap Usage',
  //           valueExpression: '',
  //           metricType: 'gauge',
  //           metricName: 'heap_usage',
  //         },
  //       ],
  //       where: '',
  //       whereLanguage: 'sql',
  //       timestampValueExpression: 'TimeUnix',
  //       dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
  //       granularity: '1 hour',
  //     };

  //     const generatedSql = await renderChartConfig(config, mockMetadata);
  //     const actual = parameterizedQueryToSql(generatedSql);
  //     expect(actual).toBe(
  //       "SELECT countIf(MetricName = 'cpu_utilization') AS `CPU Utilization`,quantileIf(0.99)(toFloat64OrNull(toString(Value)), MetricName = 'heap_usage' AND toFloat64OrNull(toString(Value)) IS NOT NULL) AS `99th Percentile Heap Usage`,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` FROM default.otel_metrics_gauge WHERE (TimeUnix >= fromUnixTimestamp64Milli(1704067200000) AND TimeUnix <= fromUnixTimestamp64Milli(1704153600000)) AND (MetricName = 'cpu_utilization' OR MetricName = 'heap_usage') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` ",
  //     );
  //   });

  //   it('should generate sql for a single sum metric', async () => {
  //     const config: ChartConfigWithOptDateRange = {
  //       displayType: DisplayType.Line,
  //       connection: 'test-connection',
  //       // metricTables is added from the Source object via spread operator
  //       metricTables: {
  //         gauge: 'otel_metrics_gauge',
  //         histogram: 'otel_metrics_histogram',
  //         sum: 'otel_metrics_sum',
  //       },
  //       from: {
  //         databaseName: 'default',
  //         tableName: 'metrics', // trigger for metric logic
  //       },
  //       select: [
  //         {
  //           aggFn: 'count',
  //           alias: 'Login Failures',
  //           valueExpression: '',
  //           metricType: 'sum', // new field; narrow down table search
  //           metricName: 'login_failures', // new field; the what
  //         },
  //       ],
  //       where: '',
  //       whereLanguage: 'sql',
  //       timestampValueExpression: 'TimeUnix',
  //       dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
  //       granularity: '5 minutes',
  //     };

  //     const generatedSql = await renderChartConfig(config, mockMetadata);
  //     const actual = parameterizedQueryToSql(generatedSql);
  //     expect(actual).toBe(
  //       "SELECT countIf(MetricName = 'login_failures') AS `Login Failures`,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` FROM default.otel_metrics_sum WHERE (TimeUnix >= fromUnixTimestamp64Milli(1704067200000) AND TimeUnix <= fromUnixTimestamp64Milli(1704153600000)) AND (MetricName = 'login_failures') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` ",
  //     );
  //   });
});
