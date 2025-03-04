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
        " (MetricName = 'nodejs.event_loop.utilization') GROUP BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket`" +
        ' ORDER BY toStartOfInterval(toDateTime(TimeUnix), INTERVAL 1 minute) AS `__hdx_time_bucket`' +
        ' WITH FILL FROM toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(1739318400000), INTERVAL 1 minute))\n' +
        '      TO toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(1765670400000), INTERVAL 1 minute))\n' +
        '      STEP 60' +
        ' LIMIT 10',
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
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(config, mockMetadata);
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toBe(
      'WITH RawSum AS (SELECT toStartOfInterval(toDateTime(TimeUnix), INTERVAL 5 minute) AS `__hdx_time_bucket2`, AttributesHash, last_value(a.Value) AS `__hdx_value_high`,\n' +
        '              any(`__hdx_value_high`) OVER(PARTITION BY AttributesHash ORDER BY `__hdx_time_bucket2` ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS `__hdx_value_high_prev`,\n' +
        '              `__hdx_value_high` - `__hdx_value_high_prev` AS Value, any(ResourceAttributes) AS ResourceAttributes, any(ResourceSchemaUrl) AS ResourceSchemaUrl,\n' +
        '              any(ScopeName) AS ScopeName, any(ScopeVersion) AS ScopeVersion, any(ScopeAttributes) AS ScopeAttributes, any(ScopeDroppedAttrCount) AS ScopeDroppedAttrCount,\n' +
        '              any(ScopeSchemaUrl) AS ScopeSchemaUrl, any(ServiceName) AS ServiceName, any(MetricName) AS MetricName, any(MetricDescription) AS MetricDescription,\n' +
        '              any(MetricUnit) AS MetricUnit, any(Attributes) AS Attributes, any(StartTimeUnix) AS StartTimeUnix, any(Flags) AS Flags, any(AggregationTemporality) AS AggregationTemporality,\n' +
        '              any(IsMonotonic) AS IsMonotonic\n' +
        '            FROM (\n' +
        '              SELECT SUM(Rate) OVER (PARTITION BY AttributesHash ORDER BY AttributesHash, TimeUnix ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS Value, *\n' +
        '              FROM (\n' +
        '                SELECT *, cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS AttributesHash,\n' +
        '                  any(AttributesHash) OVER (ORDER BY AttributesHash, TimeUnix ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevAttributesHash,\n' +
        '                  any(Value) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevValue,\n' +
        '                  IF(AggregationTemporality = 1, Value,\n' +
        '                    IF(Value - PrevValue < 0 AND AttributesHash = PrevAttributesHash, Value,\n' +
        '                      IF(AttributesHash != PrevAttributesHash, 0, Value - PrevValue))) AS Rate\n' +
        '                FROM default.otel_metrics_sum\n' +
        "                WHERE MetricName = 'db.client.connections.usage')\n" +
        '              ORDER BY AttributesHash, TimeUnix) a\n' +
        '            GROUP BY AttributesHash, `__hdx_time_bucket2`\n' +
        '            ORDER BY AttributesHash, `__hdx_time_bucket2`\n' +
        '          ) SELECT avg(\n' +
        '      toFloat64OrNull(toString(Value))\n' +
        '    ),toStartOfInterval(toDateTime(`__hdx_time_bucket2`), INTERVAL 5 minute) AS `__hdx_time_bucket` FROM RawSum WHERE (`__hdx_time_bucket2` >= fromUnixTimestamp64Milli(1739318400000) AND `__hdx_time_bucket2` <= fromUnixTimestamp64Milli(1765670400000)) GROUP BY toStartOfInterval(toDateTime(`__hdx_time_bucket2`), INTERVAL 5 minute) AS `__hdx_time_bucket` ORDER BY toStartOfInterval(toDateTime(`__hdx_time_bucket2`), INTERVAL 5 minute) AS `__hdx_time_bucket` WITH FILL FROM toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(1739318400000), INTERVAL 5 minute))\n' +
        '      TO toUnixTimestamp(toStartOfInterval(fromUnixTimestamp64Milli(1765670400000), INTERVAL 5 minute))\n' +
        '      STEP 300 LIMIT 10',
    );
  });

  it('should generate sql for a single histogram metric', async () => {
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
    expect(actual).toBe(
      'WITH HistRate AS (SELECT *, any(BucketCounts) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevBucketCounts,\n' +
        '            any(CountLength) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevCountLength,\n' +
        '            any(AttributesHash) OVER (ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) AS PrevAttributesHash,\n' +
        '            IF(AggregationTemporality = 1,\n' +
        '               BucketCounts,\n' +
        '               IF(AttributesHash = PrevAttributesHash AND CountLength = PrevCountLength,\n' +
        '                  arrayMap((prev, curr) -> IF(curr < prev, curr, toUInt64(toInt64(curr) - toInt64(prev))), PrevBucketCounts, BucketCounts),\n' +
        '                  BucketCounts)) as BucketRates\n' +
        '          FROM (\n' +
        '            SELECT *, cityHash64(mapConcat(ScopeAttributes, ResourceAttributes, Attributes)) AS AttributesHash,\n' +
        '                   length(BucketCounts) as CountLength\n' +
        '            FROM default.otel_metrics_histogram)\n' +
        "            WHERE MetricName = 'http.server.duration'\n " +
        '           ORDER BY Attributes, TimeUnix ASC\n' +
        '          ),RawHist AS (\n' +
        '            SELECT *, toUInt64( 0.5 * arraySum(BucketRates)) AS Rank,\n' +
        '                   arrayCumSum(BucketRates) as CumRates,\n' +
        '                   arrayFirstIndex(x -> if(x > Rank, 1, 0), CumRates) AS BucketLowIdx,\n' +
        '                   IF(BucketLowIdx = length(BucketRates),\n' +
        '                      ExplicitBounds[length(ExplicitBounds)],  -- if the low bound is the last bucket, use the last bound value\n' +
        '                      IF(BucketLowIdx > 1, -- indexes are 1-based\n' +
        '                         ExplicitBounds[BucketLowIdx] + (ExplicitBounds[BucketLowIdx + 1] - ExplicitBounds[BucketLowIdx]) *\n' +
        '                         intDivOrZero(\n' +
        '                             Rank - CumRates[BucketLowIdx - 1],\n' +
        '                             CumRates[BucketLowIdx] - CumRates[BucketLowIdx - 1]),\n' +
        '                    arrayElement(ExplicitBounds, BucketLowIdx + 1) * intDivOrZero(Rank, CumRates[BucketLowIdx]))) as Rate\n' +
        '            FROM HistRate) SELECT sum(\n' +
        '      toFloat64OrNull(toString(Rate))\n' +
        '    )' +
        ' FROM RawHist' +
        ' WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000))' +
        ' LIMIT 10',
    );
  });
});
