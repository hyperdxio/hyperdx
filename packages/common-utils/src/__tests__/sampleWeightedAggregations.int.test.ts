import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { parameterizedQueryToSql } from '@/clickhouse';
import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  QuerySettings,
} from '@/types';

import { renderChartConfig } from '../core/renderChartConfig';

describe('sample-weighted aggregations (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DB = 'default';
  const MAIN_TABLE = 'test_sample_weighted_main';
  const EDGE_TABLE = 'test_sample_weighted_edge';

  const querySettings: QuerySettings = [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '1' },
  ];

  const baseConfig: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Table,
    connection: 'test-connection',
    from: { databaseName: DB, tableName: MAIN_TABLE },
    select: [],
    where: '',
    whereLanguage: 'sql',
    timestampValueExpression: 'Timestamp',
    sampleWeightExpression: 'SampleRate',
    dateRange: [new Date('2025-01-01'), new Date('2025-12-31')],
  };

  async function executeChartConfig(
    config: ChartConfigWithOptDateRange,
  ): Promise<Record<string, string>> {
    const generatedSql = await renderChartConfig(
      config,
      metadata,
      querySettings,
    );
    const sql = parameterizedQueryToSql(generatedSql);
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    const rows = (await result.json()) as Record<string, string>[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    return rows[0]!;
  }

  async function executeChartConfigAllRows(
    config: ChartConfigWithOptDateRange,
  ): Promise<Record<string, string>[]> {
    const generatedSql = await renderChartConfig(
      config,
      metadata,
      querySettings,
    );
    const sql = parameterizedQueryToSql(generatedSql);
    const result = await client.query({ query: sql, format: 'JSONEachRow' });
    return (await result.json()) as Record<string, string>[];
  }

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${DB}.${MAIN_TABLE} (
          Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          Duration Float64,
          ServiceName LowCardinality(String),
          SampleRate UInt64
        )
        ENGINE = MergeTree()
        ORDER BY (Timestamp)
      `,
    });

    await client.command({
      query: `
        INSERT INTO ${DB}.${MAIN_TABLE}
          (Timestamp, Duration, ServiceName, SampleRate)
        VALUES
          ('2025-06-01 00:00:01', 100, 'api', 1),
          ('2025-06-01 00:00:02', 200, 'api', 5),
          ('2025-06-01 00:00:03', 150, 'api', 10),
          ('2025-06-01 00:00:04', 250, 'api', 1),
          ('2025-06-01 00:00:05', 80, 'api', 1),
          ('2025-06-01 00:00:06', 120, 'api', 5),
          ('2025-06-01 00:00:07', 300, 'web', 1),
          ('2025-06-01 00:00:08', 50, 'web', 5),
          ('2025-06-01 00:00:09', 175, 'web', 10),
          ('2025-06-01 00:00:10', 400, 'web', 1)
      `,
    });

    await client.command({
      query: `
        CREATE OR REPLACE TABLE ${DB}.${EDGE_TABLE} (
          Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
          Duration Float64,
          SampleRate UInt64,
          ServiceName LowCardinality(String),
          SpanAttributes Map(LowCardinality(String), String)
        )
        ENGINE = MergeTree()
        ORDER BY (Timestamp)
      `,
    });

    await client.command({
      query: `
        INSERT INTO ${DB}.${EDGE_TABLE}
          (Timestamp, Duration, SampleRate, ServiceName, SpanAttributes)
        VALUES
          ('2025-06-01 00:00:01', 100, 1, 'api', map('SampleRate', '1')),
          ('2025-06-01 00:00:02', 200, 1, 'api', map('SampleRate', '1')),
          ('2025-06-01 00:00:03', 300, 1, 'web', map('SampleRate', '1')),
          ('2025-06-01 00:00:04', 400, 1, 'web', map('SampleRate', 'abc')),
          ('2025-06-01 00:00:05', 50, 1000000, 'api', map('SampleRate', '1000000'))
      `,
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DB}.${EDGE_TABLE}`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${DB}.${MAIN_TABLE}`,
    });
    await hdxClient.close();
    await client.close();
  });

  it('weighted avg when no rows match aggCondition: NULL, not division error', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      select: [
        {
          aggFn: 'avg',
          valueExpression: 'Duration',
          aggCondition: "ServiceName = 'nonexistent'",
          aggConditionLanguage: 'sql',
          alias: 'weighted_avg',
        },
      ],
    });
    expect(rows).toHaveLength(1);
    const raw = rows[0]!['weighted_avg'];
    expect(
      raw === undefined ||
        raw === null ||
        raw === '' ||
        String(raw).toLowerCase() === 'null',
    ).toBe(true);
  });

  it('weighted sum when no rows match aggCondition: should return 0', async () => {
    const result = await executeChartConfig({
      ...baseConfig,
      select: [
        {
          aggFn: 'sum',
          valueExpression: 'Duration',
          aggCondition: "ServiceName = 'nonexistent'",
          aggConditionLanguage: 'sql',
          alias: 'weighted_sum',
        },
      ],
    });
    expect(Number(result['weighted_sum'])).toBe(0);
  });

  it('weighted count when no rows match aggCondition: should return 0', async () => {
    const result = await executeChartConfig({
      ...baseConfig,
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: "ServiceName = 'nonexistent'",
          aggConditionLanguage: 'sql',
          alias: 'weighted_count',
        },
      ],
    });
    expect(Number(result['weighted_count'])).toBe(0);
  });

  it('groupBy ServiceName: weighted count per group', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      groupBy: 'ServiceName',
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: '',
          alias: 'weighted_count',
        },
      ],
    });

    const byService = Object.fromEntries(
      rows.map(r => [r['ServiceName'] as string, Number(r['weighted_count'])]),
    );
    expect(byService['api']).toBe(23);
    expect(byService['web']).toBe(17);
  });

  it('groupBy ServiceName: weighted avg(Duration) per group', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      groupBy: 'ServiceName',
      select: [
        {
          aggFn: 'avg',
          valueExpression: 'Duration',
          aggCondition: '',
          alias: 'weighted_avg',
        },
      ],
    });

    const byService = Object.fromEntries(
      rows.map(r => [r['ServiceName'] as string, Number(r['weighted_avg'])]),
    );
    expect(byService['api']).toBeCloseTo(3530 / 23, 2);
    expect(byService['web']).toBeCloseTo(2700 / 17, 2);
  });

  it('groupBy ServiceName: weighted sum(Duration) per group', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      groupBy: 'ServiceName',
      select: [
        {
          aggFn: 'sum',
          valueExpression: 'Duration',
          aggCondition: '',
          alias: 'weighted_sum',
        },
      ],
    });

    const byService = Object.fromEntries(
      rows.map(r => [r['ServiceName'] as string, Number(r['weighted_sum'])]),
    );
    expect(byService['api']).toBe(3530);
    expect(byService['web']).toBe(2700);
  });

  it('time-series with granularity: weighted count per time bucket', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      displayType: DisplayType.Line,
      granularity: '1 minute',
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: '',
          alias: 'weighted_count',
        },
      ],
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const totalCount = rows.reduce(
      (acc, r) => acc + Number(r['weighted_count']),
      0,
    );
    expect(totalCount).toBe(40);
  });

  it('time-series with groupBy: weighted count per service per time bucket', async () => {
    const rows = await executeChartConfigAllRows({
      ...baseConfig,
      displayType: DisplayType.Line,
      granularity: '1 minute',
      groupBy: 'ServiceName',
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: '',
          alias: 'weighted_count',
        },
      ],
    });

    const byService = new Map<string, number>();
    for (const r of rows) {
      const svc = r['ServiceName'] as string;
      byService.set(
        svc,
        (byService.get(svc) ?? 0) + Number(r['weighted_count']),
      );
    }
    expect(byService.get('api')).toBe(23);
    expect(byService.get('web')).toBe(17);
  });

  describe('additional edge cases', () => {
    const edgeConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: { databaseName: DB, tableName: EDGE_TABLE },
      select: [],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'Timestamp',
      sampleWeightExpression: 'SampleRate',
      dateRange: [new Date('2025-01-01'), new Date('2025-12-31')],
    };

    it('all SampleRate=1: weighted results should equal unweighted results', async () => {
      const filterConfig = {
        ...edgeConfig,
        where: 'SampleRate = 1',
        whereLanguage: 'sql' as const,
      };

      const weightedResult = await executeChartConfig({
        ...filterConfig,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            alias: 'wcount',
          },
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'wavg',
          },
          {
            aggFn: 'sum',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'wsum',
          },
        ],
      });

      const unweightedResult = await executeChartConfig({
        ...filterConfig,
        sampleWeightExpression: undefined,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            alias: 'count',
          },
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'avg',
          },
          {
            aggFn: 'sum',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'sum',
          },
        ],
      });

      expect(Number(weightedResult['wcount'])).toBe(
        Number(unweightedResult['count']),
      );
      expect(Number(weightedResult['wavg'])).toBeCloseTo(
        Number(unweightedResult['avg']),
        5,
      );
      expect(Number(weightedResult['wsum'])).toBeCloseTo(
        Number(unweightedResult['sum']),
        5,
      );
    });

    it('non-numeric SampleRate in SpanAttributes: should clamp to weight 1', async () => {
      const result = await executeChartConfig({
        ...edgeConfig,
        sampleWeightExpression: "SpanAttributes['SampleRate']",
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: "ServiceName = 'web'",
            aggConditionLanguage: 'sql',
            alias: 'wcount',
          },
        ],
      });
      expect(Number(result['wcount'])).toBe(2);
    });

    it('very large SampleRate: should handle without overflow', async () => {
      const result = await executeChartConfig({
        ...edgeConfig,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            alias: 'wcount',
          },
          {
            aggFn: 'sum',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'wsum',
          },
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'wavg',
          },
        ],
      });

      expect(Number(result['wcount'])).toBe(1000004);
      expect(Number(result['wsum'])).toBe(50001000);
      expect(Number(result['wavg'])).toBeCloseTo(50001000 / 1000004, 2);
    });

    it('very large SampleRate: weighted avg dominated by high-weight row', async () => {
      const result = await executeChartConfig({
        ...edgeConfig,
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'wavg',
          },
        ],
      });
      const value = Number(result['wavg']);
      expect(value).toBeGreaterThan(49);
      expect(value).toBeLessThan(51);
    });
  });
});
