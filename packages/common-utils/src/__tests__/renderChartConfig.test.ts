import { parameterizedQueryToSql } from '@/clickhouse';
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
    expect(actual).toBe(
      'SELECT quantile(0.95)(toFloat64OrNull(toString(Value))),toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket`' +
        ' FROM default.otel_metrics_gauge WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000)) AND' +
        " (MetricName = 'nodejs.event_loop.utilization') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket` " +
        'ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket` LIMIT 10',
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
      granularity: '5 minutes',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toBe(
      'WITH RawSum AS (SELECT *,\n' +
        '               any(Value) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevValue,\n' +
        '               any(AttributesHash) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevAttributesHash,\n' +
        '               IF(AggregationTemporality = 1,\n' +
        '                  Value,IF(Value - PrevValue < 0 AND AttributesHash = PrevAttributesHash, Value,\n' +
        '                      IF(AttributesHash != PrevAttributesHash, 0, Value - PrevValue))) as Rate\n' +
        '            FROM (\n' +
        '                SELECT *, \n' +
        '                       cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS AttributesHash\n' +
        '                FROM default.otel_metrics_sum\n' +
        "                WHERE MetricName = 'db.client.connections.usage'\n" +
        '                ORDER BY AttributesHash, TimeUnix ASC\n' +
        '            ) )SELECT avg(\n' +
        '      toFloat64OrNull(toString(Rate))\n' +
        '    ),toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` ' +
        'FROM RawSum WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000)) ' +
        "AND (MetricName = 'db.client.connections.usage') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` " +
        'ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minutes) AS `__hdx_time_bucket` LIMIT 10',
    );
  });
});
