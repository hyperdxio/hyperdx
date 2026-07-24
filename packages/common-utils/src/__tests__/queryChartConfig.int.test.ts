import { createClient } from '@clickhouse/client';
import { ClickHouseClient } from '@clickhouse/client';

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

  // End-to-end: the cap CTE is valid SQL and restricts a high-cardinality
  // group-by to the top N by max value in any bucket.
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

  it('computes ratio via native CTE when seriesReturnType is "ratio"', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: DATABASE, tableName: TABLE_NAME },
      metricTables: { [MetricsDataType.Gauge]: TABLE_NAME } as any,
      seriesReturnType: 'ratio',
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'sql',
          valueExpression: 'Value',
          metricName: 'metric.alpha',
          metricType: MetricsDataType.Gauge,
          alias: 'avg(metric.alpha)',
        },
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'sql',
          valueExpression: 'Value',
          metricName: 'metric.beta',
          metricType: MetricsDataType.Gauge,
          alias: 'avg(metric.beta)',
        },
      ],
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
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

    // Check that the ratio is the first column
    expect(metaNames[0]).toBe('avg(metric.alpha)/avg(metric.beta)');
    expect(metaNames).toContain('__hdx_time_bucket');
    expect(metaNames).toContain('ServiceName');

    const data = result.data as any[];
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row['avg(metric.alpha)/avg(metric.beta)']).toBeDefined();
      // It might be a number or string depending on ClickHouse formatting for JSON, usually number for Float64
      expect(
        Number.isNaN(Number(row['avg(metric.alpha)/avg(metric.beta)'])),
      ).toBe(false);
    }
  });

  // Regression: a comma-separated string group-by (with a Map access) must split
  // per-column (not emit toString(col1, col2)); empty-string groups are kept.
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
      // Missing capability key (Map access -> '') for svc3 — largest by count.
      // Empty-string groups are kept, so this ranks #1 and survives the cap.
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
        // Cap to 2 so the ranking is observable: by count svc3 (10) > svc1 (5)
        // > svc2 (3), so the top 2 are svc3 and svc1; svc2 is dropped.
        seriesLimit: 2,
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
      // svc3 (empty capability) is kept and ranks #1; the cap drops svc2.
      expect([...services].sort()).toEqual(['svc1', 'svc3']);
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
      });
    }
  });

  // NULL group components are dropped from the ranking; otherwise a NULL group
  // could take a slot the NULL-unsafe outer `tuple() IN (...)` can never fill.
  it('excludes NULL group components from the series cap', async () => {
    const TABLE = 'logs_nullable_gb_int_test';
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE} (
        Timestamp DateTime CODEC(ZSTD(1)),
        Region Nullable(String) CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (Timestamp)`,
    });

    const ts = '2025-04-15 00:10:00';
    const rows = [
      // 'us' has 5 rows; the NULL-region group has 10 (the largest by count).
      ...Array.from({ length: 5 }, () => ({ Timestamp: ts, Region: 'us' })),
      ...Array.from({ length: 10 }, () => ({ Timestamp: ts, Region: null })),
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
        groupBy: [{ aggCondition: '', valueExpression: 'Region' }],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [
          new Date('2025-04-15T00:00:00Z'),
          new Date('2025-04-15T01:00:00Z'),
        ],
        granularity: '5 minute',
        // Only one slot: without the NULL filter the (larger) NULL group would
        // claim it and then match nothing, yielding an empty chart.
        seriesLimit: 1,
      };

      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });

      const regions = (result.data as Array<{ Region: string | null }>).map(
        r => r.Region,
      );
      // 'us' (top non-null) takes the slot; the NULL group is excluded.
      expect(new Set(regions)).toEqual(new Set(['us']));
      expect(regions).not.toContain(null);
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
      });
    }
  });

  // Multi-column array group-by with an alias: the 2-column tuple()/IN executes
  // (alias stripped in the CTE — a leaked `AS "reg"` there is a syntax error)
  // and the alias is preserved as the output column.
  it('handles a multi-column array group-by with an alias under seriesLimit', async () => {
    const TABLE = 'logs_array_alias_gb_int_test';
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE} (
        Timestamp DateTime CODEC(ZSTD(1)),
        Region String CODEC(ZSTD(1)),
        ServiceName String CODEC(ZSTD(1)),
        Value Float64 CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (Timestamp)`,
    });

    const ts = '2025-04-15 00:10:00';
    const rows = [
      { Timestamp: ts, Region: 'us', ServiceName: 'svc1', Value: 10 },
      { Timestamp: ts, Region: 'eu', ServiceName: 'svc2', Value: 5 },
      { Timestamp: ts, Region: 'ap', ServiceName: 'svc3', Value: 1 },
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
        select: [
          {
            aggFn: 'max',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
          },
        ],
        groupBy: [
          { aggCondition: '', valueExpression: 'Region', alias: 'reg' },
          { aggCondition: '', valueExpression: 'ServiceName' },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [
          new Date('2025-04-15T00:00:00Z'),
          new Date('2025-04-15T01:00:00Z'),
        ],
        granularity: '5 minute',
        // Top 2 by max(Value): (us,svc1)=10 and (eu,svc2)=5; (ap,svc3)=1 dropped.
        seriesLimit: 2,
      };

      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });

      const services = new Set(
        (result.data as Array<{ ServiceName: string }>).map(r => r.ServiceName),
      );
      expect(services).toEqual(new Set(['svc1', 'svc2']));
      // The alias survives in the output even though it is stripped in the CTE.
      expect(result.meta?.some(m => m.name === 'reg')).toBe(true);
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
      });
    }
  });

  // Chunked fetches narrow dateRange per window; seriesLimitDateRange pins the
  // top-N ranking to one shared range (the newest window) so every chunk keeps
  // the SAME group set — otherwise the union of per-window top-N sets exceeds
  // the limit.
  it('keeps a consistent top-N group set across chunked windows via seriesLimitDateRange', async () => {
    const TABLE = 'logs_chunked_series_limit_int_test';
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE} (
        Timestamp DateTime CODEC(ZSTD(1)),
        ServiceName String CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, Timestamp)`,
    });

    // Older window (00:00-00:30): svcA dominates. Newest window (00:30-01:00):
    // svcB dominates — the ranking is pinned to the newest window, so svcB
    // must win in BOTH chunks even though svcA's older peak is larger.
    const rows = [
      ...Array.from({ length: 100 }, () => ({
        Timestamp: '2025-04-15 00:10:00',
        ServiceName: 'svcA',
      })),
      { Timestamp: '2025-04-15 00:10:00', ServiceName: 'svcB' },
      { Timestamp: '2025-04-15 00:40:00', ServiceName: 'svcA' },
      ...Array.from({ length: 50 }, () => ({
        Timestamp: '2025-04-15 00:40:00',
        ServiceName: 'svcB',
      })),
    ];
    await client.insert({
      table: `${DATABASE}.${TABLE}`,
      values: rows,
      format: 'JSONEachRow',
    });

    try {
      const newestWindow: [Date, Date] = [
        new Date('2025-04-15T00:30:00Z'),
        new Date('2025-04-15T01:00:00Z'),
      ];
      const windows: Array<{
        dateRange: [Date, Date];
        dateRangeEndInclusive: boolean;
      }> = [
        {
          dateRange: newestWindow,
          dateRangeEndInclusive: true,
        },
        {
          dateRange: [new Date('2025-04-15T00:00:00Z'), newestWindow[0]],
          dateRangeEndInclusive: false,
        },
      ];

      const groupsPerWindow = await Promise.all(
        windows.map(async window => {
          const config: ChartConfigWithOptDateRange = {
            displayType: DisplayType.Line,
            connection: 'test-connection',
            from: { databaseName: DATABASE, tableName: TABLE },
            select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            where: '',
            whereLanguage: 'sql',
            timestampValueExpression: 'Timestamp',
            granularity: '5 minute',
            seriesLimit: 1,
            ...window,
            seriesLimitDateRange: newestWindow,
          };
          const result = await hdxClient.queryChartConfig({
            config,
            metadata,
            querySettings: undefined,
          });
          return new Set(
            (result.data as Array<{ ServiceName: string }>).map(
              r => r.ServiceName,
            ),
          );
        }),
      );

      // Both windows keep the newest-window winner only — without the pinned
      // range, the older window would keep svcA (its local top-1) and the
      // union would be 2.
      expect(groupsPerWindow[0]).toEqual(new Set(['svcB']));
      expect(groupsPerWindow[1]).toEqual(new Set(['svcB']));
    } finally {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
      });
    }
  });
});
