import { createClient } from '@clickhouse/client';
import { ClickHouseClient } from '@clickhouse/client-common';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

describe('queryChartConfig Integration Tests', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const TABLE_NAME = 'otel_metrics_gauge_int_test';

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    // Mirror the OTel gauge schema so renderChartConfig can target it.
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE_NAME} (
        ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        ResourceSchemaUrl String CODEC(ZSTD(1)),
        ScopeName String CODEC(ZSTD(1)),
        ScopeVersion String CODEC(ZSTD(1)),
        ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
        ScopeSchemaUrl String CODEC(ZSTD(1)),
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        MetricName String CODEC(ZSTD(1)),
        MetricDescription String CODEC(ZSTD(1)),
        MetricUnit String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Value Float64 CODEC(ZSTD(1)),
        Flags UInt32 CODEC(ZSTD(1))
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimeUnix)
      ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
    });

    const rows: Array<{
      ServiceName: string;
      MetricName: string;
      TimeUnix: string;
      Value: number;
    }> = [];
    for (const metricName of ['metric.alpha', 'metric.beta', 'metric.gamma']) {
      for (const ts of ['2025-04-15 10:00:00', '2025-04-15 10:01:00']) {
        rows.push({
          ServiceName: 'svc-a',
          MetricName: metricName,
          TimeUnix: ts,
          Value: Math.random(),
        });
      }
    }

    await client.insert({
      table: `${DATABASE}.${TABLE_NAME}`,
      values: rows.map(r => ({
        ResourceAttributes: {},
        ResourceSchemaUrl: '',
        ScopeName: '',
        ScopeVersion: '',
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: '',
        ServiceName: r.ServiceName,
        MetricName: r.MetricName,
        MetricDescription: '',
        MetricUnit: '',
        Attributes: {},
        StartTimeUnix: r.TimeUnix,
        TimeUnix: r.TimeUnix,
        Value: r.Value,
        Flags: 0,
      })),
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE_NAME}`,
    });
    await hdxClient.close();
    await client.close();
  });

  it('places all value columns first in the joined meta when splitting metric selects', async () => {
    const metricTables = {
      gauge: TABLE_NAME,
      histogram: 'unused',
      sum: 'unused',
      summary: 'unused',
      'exponential histogram': 'unused',
    };

    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables,
      from: { databaseName: DATABASE, tableName: '' },
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'sql',
          valueExpression: 'Value',
          metricName: 'metric.alpha',
          metricType: MetricsDataType.Gauge,
        },
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'sql',
          valueExpression: 'Value',
          metricName: 'metric.beta',
          metricType: MetricsDataType.Gauge,
        },
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'sql',
          valueExpression: 'Value',
          metricName: 'metric.gamma',
          metricType: MetricsDataType.Gauge,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-04-14'), new Date('2025-04-16')],
      granularity: '1 minute',
      limit: { limit: 100 },
    };

    const result = await hdxClient.queryChartConfig({
      config,
      metadata,
      querySettings: undefined,
    });

    const metaNames = result.meta?.map(m => m.name) ?? [];

    // The three value columns (aliased as `${aggFn}(${metricName})` by
    // setChartSelectsAlias) must appear in select order at the head of meta.
    expect(metaNames.slice(0, 3)).toEqual([
      'avg(metric.alpha)',
      'avg(metric.beta)',
      'avg(metric.gamma)',
    ]);
    // The timestamp column appears after the value columns.
    expect(metaNames).toContain('__hdx_time_bucket');
    expect(metaNames.indexOf('__hdx_time_bucket')).toBeGreaterThanOrEqual(3);
  });
});
