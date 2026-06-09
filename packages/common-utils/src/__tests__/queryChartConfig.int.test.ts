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

  // This property is required by useChartNumberFormats, which uses position in `meta` to match
  // value columns with the chart config's series.
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

  // Validates the seriesLimit cap end-to-end against real ClickHouse: the
  // generated TopGroups CTE must be valid SQL and must restrict a
  // high-cardinality group-by to the top N series by max value in any bucket.
  it('caps high-cardinality group-by series to the top N via seriesLimit', async () => {
    const SERIES_TABLE = 'logs_series_limit_int_test';
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${SERIES_TABLE} (
        Timestamp DateTime CODEC(ZSTD(1)),
        ServiceName String CODEC(ZSTD(1)),
        Value Float64 CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, Timestamp)`,
    });

    // 50 distinct series; Value == index so the top 5 by value are svc-45..49.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      Timestamp: '2025-04-15 00:10:00',
      ServiceName: `svc-${String(i).padStart(2, '0')}`,
      Value: i,
    }));
    await client.insert({
      table: `${DATABASE}.${SERIES_TABLE}`,
      values: rows,
      format: 'JSONEachRow',
    });

    try {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: DATABASE, tableName: SERIES_TABLE },
        select: [
          {
            aggFn: 'max',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
          },
        ],
        groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [
          new Date('2025-04-15T00:00:00Z'),
          new Date('2025-04-15T01:00:00Z'),
        ],
        granularity: '5 minute',
        seriesLimit: 5,
      };

      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });

      // Without the cap this would be 50 distinct services.
      const services = new Set(
        (result.data as Array<{ ServiceName: string }>).map(r => r.ServiceName),
      );
      expect(services.size).toBeLessThanOrEqual(5);
      expect([...services].sort()).toEqual([
        'svc-45',
        'svc-46',
        'svc-47',
        'svc-48',
        'svc-49',
      ]);
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${SERIES_TABLE}`,
      });
    }
  });

  // Regression: a comma-separated *string* group-by (including a Map access with
  // a comma inside the brackets) must split into per-column NULL/empty checks
  // rather than emitting an invalid two-argument toString().
  it('handles a multi-column string group-by (with Map access) under seriesLimit', async () => {
    const TABLE = 'logs_string_gb_int_test';
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE} (
        Timestamp DateTime CODEC(ZSTD(1)),
        LogAttributes Map(String, String) CODEC(ZSTD(1)),
        ServiceName String CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, Timestamp)`,
    });

    const ts = '2025-04-15 00:10:00';
    const rows = [
      // capA/svc1 (5 rows), capB/svc2 (3 rows) — the two non-empty series.
      ...Array.from({ length: 5 }, () => ({
        Timestamp: ts,
        LogAttributes: { 'agentToServer.capabilities': 'capA' },
        ServiceName: 'svc1',
      })),
      ...Array.from({ length: 3 }, () => ({
        Timestamp: ts,
        LogAttributes: { 'agentToServer.capabilities': 'capB' },
        ServiceName: 'svc2',
      })),
      // Missing capability key (Map access -> '') for svc3 — largest by count,
      // but must be excluded by the per-column empty filter.
      ...Array.from({ length: 10 }, () => ({
        Timestamp: ts,
        LogAttributes: {},
        ServiceName: 'svc3',
      })),
    ];
    await client.insert({
      table: `${DATABASE}.${TABLE}`,
      values: rows,
      format: 'JSONEachRow',
    });

    try {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: DATABASE, tableName: TABLE },
        select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
        // Comma-separated string group-by — the shape that previously errored.
        groupBy: "LogAttributes['agentToServer.capabilities'],ServiceName",
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [
          new Date('2025-04-15T00:00:00Z'),
          new Date('2025-04-15T01:00:00Z'),
        ],
        granularity: '5 minute',
        seriesLimit: 5,
      };

      // The query must execute without a ClickHouse error (the original bug).
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });

      const services = new Set(
        (result.data as Array<{ ServiceName: string }>).map(r => r.ServiceName),
      );
      // svc3 only appears with an empty capability, so it is filtered out of the
      // ranking; only the two real series remain.
      expect([...services].sort()).toEqual(['svc1', 'svc2']);
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
      });
    }
  });
});
