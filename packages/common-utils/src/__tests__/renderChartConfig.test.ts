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
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '1 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toBe(
      'SELECT avgIf(\n' +
        "      toFloat64OrNull(toString(Value)), MetricName = 'nodejs.event_loop.utilization' AND toFloat64OrNull(toString(Value)) IS NOT NULL\n" +
        '    ) AS `Utilization`,MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket`' +
        ' FROM default.otel_metrics_gauge WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000))' +
        " AND (MetricName = 'nodejs.event_loop.utilization') GROUP BY MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket`" +
        ' ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket` LIMIT 10',
    );
  });

  it('should generate sql for multiple gauge metrics', async () => {
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
          aggFn: 'count',
          alias: 'CPU Utilization',
          valueExpression: '',
          metricType: 'gauge', // new field; narrow down table search
          metricName: 'cpu_utilization', // new field; the what
        },
        {
          aggFn: 'quantile',
          level: 0.99,
          alias: '99th Percentile Heap Usage',
          valueExpression: '',
          metricType: 'gauge',
          metricName: 'heap_usage',
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '1 hour',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toBe(
      "SELECT countIf(MetricName = 'cpu_utilization') AS `CPU Utilization`,quantileIf(0.99)(toFloat64OrNull(toString(Value)), MetricName = 'heap_usage' AND toFloat64OrNull(toString(Value))" +
        ' IS NOT NULL) AS `99th Percentile Heap Usage`,MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` FROM default.otel_metrics_gauge' +
        " WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000)) AND (MetricName = 'cpu_utilization' OR MetricName = 'heap_usage')" +
        ' GROUP BY MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket`' +
        ' ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 hour) AS `__hdx_time_bucket` LIMIT 10',
    );
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
      },
      from: {
        databaseName: 'default',
        tableName: 'metrics', // trigger for metric logic
      },
      select: [
        {
          aggFn: 'count',
          alias: 'Login Failures',
          valueExpression: '',
          metricType: 'sum', // new field; narrow down table search
          metricName: 'login_failures', // new field; the what
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minutes',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toBe(
      "SELECT countIf(MetricName = 'login_failures') AS `Login Failures`,MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket`" +
        " FROM default.otel_metrics_sum WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000)) AND (MetricName = 'login_failures')" +
        ' GROUP BY MetricName, ResourceAttributes,toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket`' +
        ' ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` LIMIT 10',
    );
  });
});
