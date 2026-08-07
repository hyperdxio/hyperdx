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

  // The cap ranks on the value the chart plots. For seriesReturnType 'ratio'
  // that is divide(select[0], select[1]) — ranking on the bare numerator would
  // drop a low-volume group with a high ratio in favour of a high-volume group
  // with a low one.
  //
  // These share one fixture (rather than a table per test, as above) because
  // every case needs the same six groups: the set is built so that the ordering
  // by ratio and the ordering by numerator disagree, which is what makes the
  // assertions behavioral instead of coincidental.
  describe('ratio series under seriesLimit', () => {
    const RATIO_TABLE = 'logs_ratio_series_limit_int_test';

    // All rows share one midday timestamp so they always land in a single
    // `1 day` bucket regardless of the ClickHouse server timezone.
    const ROW_TIMESTAMP = '2025-04-15 12:00:00';

    // ServiceName -> [Errors, Total]; ratio = sum(Errors) / sum(Total).
    // Region is a second grouping key, used only by the two-column group-by
    // case; one row per service keeps every (service, region) pair unique so
    // the ranking is identical whether one or both columns are grouped on.
    const FIXTURE: Record<string, [number, number]> = {
      inf_group: [5, 0], // 5/0   = +inf, a real spike
      broken: [2, 2], // 2/2   = 1.00
      flaky: [3, 4], // 3/4   = 0.75
      mild: [1, 2], // 1/2   = 0.50, smallest numerator
      noisy: [6, 60], // 6/60  = 0.10, largest numerator
      zero_group: [0, 0], // 0/0   = NaN, meaningless
    };
    const regionOf = (service: string) => `region-${service}`;

    const sumOf = (column: string) => ({
      aggFn: 'sum' as const,
      aggCondition: '',
      aggConditionLanguage: 'sql' as const,
      valueExpression: column,
    });

    const ratioSelect = [sumOf('Errors'), sumOf('Total')];

    const baseRatioConfig = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: DATABASE, tableName: RATIO_TABLE },
      where: '',
      whereLanguage: 'sql' as const,
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-04-14'), new Date('2025-04-17')] as [
        Date,
        Date,
      ],
      granularity: '1 day' as const,
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
    };

    async function runRatioConfig(config: ChartConfigWithOptDateRange) {
      return await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
        // Without this ClickHouse serializes both NaN and inf as JSON null,
        // making the two indistinguishable — and telling them apart is exactly
        // what the ordering assertions below check.
        opts: {
          clickhouse_settings: { output_format_json_quote_denormals: 1 },
        },
      });
    }

    const servicesOf = (result: { data: unknown }) =>
      [
        ...new Set(
          (result.data as Array<{ ServiceName: string }>).map(
            r => r.ServiceName,
          ),
        ),
      ].sort();

    /** The ratio column, which renders as an unaliased `divide(...)`. */
    const ratioFor = (result: { data: unknown }, service: string) => {
      const row = (result.data as Array<Record<string, string>>).find(
        r => r['ServiceName'] === service,
      );
      return Object.entries(row ?? {}).find(([key]) =>
        key.startsWith('divide('),
      )?.[1];
    };

    /**
     * `0.0 / 0.0` may set the NaN sign bit depending on the platform's
     * floating-point unit, so ClickHouse prints either `nan` or `-nan`. The sign
     * carries no meaning here (unlike `inf` vs `-inf`) and does not affect
     * ordering, so accept both.
     */
    const isNanLiteral = (value: string | undefined) =>
      value === 'nan' || value === '-nan';

    beforeAll(async () => {
      await client.command({
        query: `CREATE OR REPLACE TABLE ${DATABASE}.${RATIO_TABLE} (
          Timestamp DateTime CODEC(ZSTD(1)),
          ServiceName String CODEC(ZSTD(1)),
          Region String CODEC(ZSTD(1)),
          Errors UInt32 CODEC(ZSTD(1)),
          Total UInt32 CODEC(ZSTD(1))
        ) ENGINE = MergeTree ORDER BY (ServiceName, Timestamp)`,
      });

      await client.insert({
        table: `${DATABASE}.${RATIO_TABLE}`,
        values: Object.entries(FIXTURE).map(([service, [errors, total]]) => ({
          Timestamp: ROW_TIMESTAMP,
          ServiceName: service,
          Region: regionOf(service),
          Errors: errors,
          Total: total,
        })),
        format: 'JSONEachRow',
      });
    });

    afterAll(async () => {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${RATIO_TABLE}`,
      });
    });

    it('keeps the highest-ratio groups, not the highest-numerator ones', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: ratioSelect,
        seriesReturnType: 'ratio',
        seriesLimit: 2,
      });

      // broken (1.00) and flaky (0.75) are the two highest *finite* ratios.
      // Ranking on the numerator would have returned ['inf_group', 'noisy'],
      // since noisy has the largest numerator (6) and the smallest ratio.
      expect(servicesOf(result)).toEqual(['broken', 'flaky']);
    });

    it('ranks non-finite ratios below every finite one', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: ratioSelect,
        seriesReturnType: 'ratio',
        seriesLimit: 4,
      });

      // Six groups, room for four. inf_group (x/0) and zero_group (0/0) are the
      // two dropped: neither value can be compared or even plotted (the app
      // queries without quoted denormals, so both arrive as JSON null and
      // render as a gap), and ClickHouse would otherwise sort inf above every
      // real number. The four finite ratios take the slots instead.
      expect(servicesOf(result)).toEqual(['broken', 'flaky', 'mild', 'noisy']);
    });

    it('keeps a NaN-ratio group when the limit exceeds the group count', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: ratioSelect,
        seriesReturnType: 'ratio',
        seriesLimit: 10,
      });

      // Non-finite ratios are only deprioritized, never filtered out: with room
      // for everyone, inf_group and zero_group still come back.
      expect(servicesOf(result)).toEqual([
        'broken',
        'flaky',
        'inf_group',
        'mild',
        'noisy',
        'zero_group',
      ]);
      expect(isNanLiteral(ratioFor(result, 'zero_group'))).toBe(true);
      expect(ratioFor(result, 'inf_group')).toBe('inf');
    });

    // Regression: with an aggCondition on every select, renderWhere ORs them
    // into the WHERE, so a (group, bucket) row exists as soon as *either* side
    // matched — buckets with a numerator and no denominator are routine, not
    // exceptional. Each such bucket is +inf, ClickHouse sorts inf above every
    // real number, and the resulting ties are broken alphabetically, so the cap
    // used to fill up with arbitrary sparse groups and drop the steady
    // high-ratio series.
    it('does not let sparse zero-denominator buckets crowd out a real series', async () => {
      const TABLE = 'logs_ratio_sparse_denominator_int_test';
      await client.command({
        query: `CREATE OR REPLACE TABLE ${DATABASE}.${TABLE} (
          Timestamp DateTime CODEC(ZSTD(1)),
          ServiceName String CODEC(ZSTD(1)),
          Level String CODEC(ZSTD(1))
        ) ENGINE = MergeTree ORDER BY (ServiceName, Timestamp)`,
      });

      const rows: Array<Record<string, string>> = [];
      const push = (ts: string, service: string, level: string, n: number) => {
        for (let i = 0; i < n; i++) {
          rows.push({ Timestamp: ts, ServiceName: service, Level: level });
        }
      };
      // Four noisy groups: one error and NO warn in the first bucket (ratio
      // +inf), then a boring 1/100 in the second.
      for (const service of ['n1', 'n2', 'n3', 'n4']) {
        push('2025-04-15 00:30:00', service, 'error', 1);
        push('2025-04-15 01:30:00', service, 'error', 1);
        push('2025-04-15 01:30:00', service, 'warn', 100);
      }
      // One genuinely high, always-finite ratio: 90/100 = 0.9 in both buckets.
      // Named last alphabetically so it loses any tie-break.
      for (const ts of ['2025-04-15 00:30:00', '2025-04-15 01:30:00']) {
        push(ts, 'zz_genuine', 'error', 90);
        push(ts, 'zz_genuine', 'warn', 100);
      }
      await client.insert({
        table: `${DATABASE}.${TABLE}`,
        values: rows,
        format: 'JSONEachRow',
      });

      try {
        const countOfLevel = (level: string) => ({
          aggFn: 'count' as const,
          aggCondition: `Level = '${level}'`,
          aggConditionLanguage: 'sql' as const,
          valueExpression: '',
        });

        const result = await runRatioConfig({
          ...baseRatioConfig,
          from: { databaseName: DATABASE, tableName: TABLE },
          select: [countOfLevel('error'), countOfLevel('warn')],
          seriesReturnType: 'ratio',
          dateRange: [
            new Date('2025-04-15T00:00:00Z'),
            new Date('2025-04-15T02:00:00Z'),
          ],
          granularity: '1 hour',
          seriesLimit: 2,
        });

        // zz_genuine (a steady 0.9) must take a slot. Ranking on the raw max
        // would give ['n1', 'n2'] — the two alphabetically-first of the four
        // groups tied at +inf.
        expect(servicesOf(result)).toContain('zz_genuine');
        expect(servicesOf(result)).toHaveLength(2);
      } finally {
        await client.command({
          query: `DROP TABLE IF EXISTS ${DATABASE}.${TABLE}`,
        });
      }
    });

    it('ranks a two-select non-ratio config by its first select only', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: [sumOf('Errors'), sumOf('Total')],
        seriesLimit: 2,
      });

      // Without seriesReturnType 'ratio' the pair must not collapse into a
      // divide(). Top 2 by sum(Errors) is [inf_group (5), noisy (6)]; ranking
      // by the second select would give [flaky, noisy] and a ratio collapse
      // would give [broken, inf_group].
      expect(servicesOf(result)).toEqual(['inf_group', 'noisy']);
    });

    // Regression: ratio mode merges exactly two SELECT items into divide(a, b),
    // and that merge used to be inferred from the length of whatever list was
    // being rendered. A groupBy of exactly two columns therefore rendered
    // `divide(ServiceName, Region)` into the SELECT, GROUP BY and the cap's
    // tuple predicate, and ClickHouse rejected the whole query with
    // "Illegal types String and String of arguments of function divide".
    it('groups by two columns without merging them into a ratio', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: ratioSelect,
        seriesReturnType: 'ratio',
        groupBy: [
          { aggCondition: '', valueExpression: 'ServiceName' },
          { aggCondition: '', valueExpression: 'Region' },
        ],
        seriesLimit: 2,
      });

      // Both grouping keys survive as their own output columns...
      expect(result.meta?.map(m => m.name)).toEqual(
        expect.arrayContaining(['ServiceName', 'Region']),
      );
      // ...and the ratio ranking still picks the top two by finite ratio.
      expect(servicesOf(result)).toEqual(['broken', 'flaky']);
      expect(
        (result.data as Array<{ Region: string }>).map(r => r.Region).sort(),
      ).toEqual([regionOf('broken'), regionOf('flaky')]);
    });

    it('ranks by the first select when ratio mode has other than two selects', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        select: [
          sumOf('Errors'),
          sumOf('Total'),
          { aggFn: 'max' as const, aggCondition: '', valueExpression: 'Total' },
        ],
        seriesReturnType: 'ratio',
        seriesLimit: 2,
      });

      // A ratio needs exactly two selects, so a third falls back to plain
      // multi-series rendering and the rank stays sum(Errors). Had the first
      // two collapsed into a ratio this would be ['broken', 'inf_group'].
      expect(servicesOf(result)).toEqual(['inf_group', 'noisy']);
    });

    it('aggregates every row when there is no group-by to cap', async () => {
      const result = await runRatioConfig({
        ...baseRatioConfig,
        groupBy: undefined,
        select: ratioSelect,
        seriesReturnType: 'ratio',
        seriesLimit: 2,
      });

      // The cap is gated on a non-empty group-by, so building the rank from the
      // whole select list must not leak into the ungrouped path: every row
      // still contributes, giving Errors 17 / Total 68. A limit applied here
      // would drop rows and change this number.
      expect(result.data).toHaveLength(1);
      const ratio = Object.entries(
        result.data[0] as Record<string, string>,
      ).find(([key]) => key.startsWith('divide('))?.[1];
      expect(Number(ratio)).toBeCloseTo(17 / 68, 5);
    });
  });
});
