import { createClient } from '@clickhouse/client';
import { ClickHouseClient } from '@clickhouse/client';

import { convertCHDataTypeToJSType, JSDataType } from '@/clickhouse';
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

    // Mirror the OTel gauge schema (see
    // docker/otel-collector/schema/seed/00003_otel_metrics.sql) so
    // renderChartConfig can target it.
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
        MetricName LowCardinality(String) CODEC(ZSTD(1)),
        MetricDescription String CODEC(ZSTD(1)),
        MetricUnit String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        StartTimeUnix DateTime CODEC(Delta, ZSTD(1)),
        TimeUnix DateTime CODEC(Delta, ZSTD(1)),
        Value Float64 CODEC(ZSTD(1)),
        Flags UInt32 CODEC(ZSTD(1))
      )
      ENGINE = MergeTree
      PARTITION BY toDate(TimeUnix)
      ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`,
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

  // Regression baseline for the multi-series metric merge (HDX-5076).
  //
  // A metric chart with N select items renders one per-series query per item
  // and merges them back into one result set. These tests were written
  // against the original node-side merge (mergeResultSets) and pin its
  // OBSERVABLE CONTRACT end-to-end through queryChartConfig; the composed
  // single-query implementation (HDX-5077) must — and does — reproduce it:
  //
  //  - meta lists all value columns first, in select order (positional
  //    contract of useChartNumberFormats);
  //  - rows join on (time bucket [+ group-by values]); a bucket/group present
  //    in only one series still appears (full-outer semantics);
  //  - a series with no data at a joined row reads as a GAP — nullish or NaN,
  //    never 0. Both the current merge (absent key / JS NaN) and a SQL-side
  //    merge (JSON null) satisfy this, so gaps are asserted via expectGap
  //    rather than pinning the exact nullish representation;
  //  - value column types stay numeric per convertCHDataTypeToJSType (the
  //    exact ClickHouse type string may become a Nullable supertype when the
  //    merge moves into SQL, which consumers already handle);
  //  - ratio semantics (seriesReturnType 'ratio' with exactly two series):
  //    output column named "<numAlias>/<denomAlias>" replaces the operand
  //    columns; missing numerator counts as 0; missing or zero denominator is
  //    a gap; ratioMode 'share_of_total' divides by the per-bucket denominator
  //    total instead of the row's own denominator;
  //  - two series resolving to the same alias are disambiguated with a
  //    "__{splitIndex}" suffix;
  //  - gauge/sum series expose group-by dimensions as plain columns while
  //    histogram series expose a single Array column named "group", so grouped
  //    histogram rows never join with grouped gauge/sum rows.
  describe('multi-series metric merge (regression baseline)', () => {
    const GAUGE_TABLE = 'mm_baseline_gauge_int_test';
    const SUM_TABLE = 'mm_baseline_sum_int_test';
    const HIST_TABLE = 'mm_baseline_histogram_int_test';

    const metricTables = {
      gauge: GAUGE_TABLE,
      sum: SUM_TABLE,
      histogram: HIST_TABLE,
      summary: 'unused',
      'exponential histogram': 'unused',
    };

    // All timestamps land on exact minute boundaries so `1 minute` buckets
    // render as the raw timestamp. Inserts use server-local strings and the
    // CI ClickHouse runs in UTC (like every other fixture in this file);
    // the client sets date_time_output_format=iso, hence the Z format. The
    // dateRange is deliberately wide (± a day) to stay clear of boundaries.
    const insertTs = (minute: number) => `2025-04-15 10:0${minute}:00`;
    const bucket = (minute: number) => `2025-04-15T10:0${minute}:00Z`;
    const DATE_RANGE: [Date, Date] = [
      new Date('2025-04-14'),
      new Date('2025-04-16'),
    ];

    // Fixture tables mirror the OTel collector's metric table schemas from
    // docker/otel-collector/schema/seed/00003_otel_metrics.sql — same columns,
    // types, engine, partitioning, sorting key, and skip indexes. Only the
    // env-dependent TTL clause is omitted.
    const OTEL_COMMON_COLUMNS = `
      ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      ResourceSchemaUrl String CODEC(ZSTD(1)),
      ScopeName String CODEC(ZSTD(1)),
      ScopeVersion String CODEC(ZSTD(1)),
      ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
      ScopeSchemaUrl String CODEC(ZSTD(1)),
      ServiceName LowCardinality(String) CODEC(ZSTD(1)),
      MetricName LowCardinality(String) CODEC(ZSTD(1)),
      MetricDescription String CODEC(ZSTD(1)),
      MetricUnit String CODEC(ZSTD(1)),
      Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      StartTimeUnix DateTime CODEC(Delta, ZSTD(1)),
      TimeUnix DateTime CODEC(Delta, ZSTD(1))`;

    const OTEL_EXEMPLARS_COLUMNS = `
      \`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
      \`Exemplars.TimeUnix\` Array(DateTime) CODEC(ZSTD(1)),
      \`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
      \`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
      \`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1))`;

    const OTEL_INDEXES = `
      INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1`;

    const OTEL_ORDER_BY = `ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`;

    // The per-series key is cityHash64(ScopeAttributes, ResourceAttributes,
    // Attributes); give every service a distinct resource attribute so two
    // services never collapse into one attributes-hash series.
    const commonFields = (metricName: string, ts: string, service: string) => ({
      ResourceAttributes: { 'service.name': service },
      ResourceSchemaUrl: '',
      ScopeName: '',
      ScopeVersion: '',
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeSchemaUrl: '',
      ServiceName: service,
      MetricName: metricName,
      MetricDescription: '',
      MetricUnit: '',
      Attributes: {},
      StartTimeUnix: ts,
      TimeUnix: ts,
    });

    const gaugeRow = (
      metricName: string,
      ts: string,
      service: string,
      value: number,
    ) => ({
      ...commonFields(metricName, ts, service),
      Value: value,
      Flags: 0,
    });

    // Cumulative monotonic counter (the standard OTel counter shape).
    const sumRow = (
      metricName: string,
      ts: string,
      service: string,
      value: number,
    ) => ({
      ...commonFields(metricName, ts, service),
      Value: value,
      Flags: 0,
      AggregationTemporality: 2,
      IsMonotonic: true,
    });

    const histRow = (
      metricName: string,
      ts: string,
      service: string,
      bucketCounts: number[],
      explicitBounds: number[],
    ) => ({
      ...commonFields(metricName, ts, service),
      Count: bucketCounts.reduce((a, b) => a + b, 0),
      Sum: 0,
      BucketCounts: bucketCounts,
      ExplicitBounds: explicitBounds,
      Min: 0,
      Max: 0,
      Flags: 0,
      AggregationTemporality: 2,
    });

    type MetricSelect = {
      aggFn: 'avg' | 'sum' | 'quantile' | 'increase' | 'count';
      aggCondition: string;
      aggConditionLanguage: 'sql';
      valueExpression: string;
      metricName: string;
      metricType: MetricsDataType;
      level?: number;
    };

    const gaugeSelect = (
      metricName: string,
      overrides: Partial<MetricSelect> = {},
    ): MetricSelect => ({
      aggFn: 'avg',
      aggCondition: '',
      aggConditionLanguage: 'sql',
      valueExpression: 'Value',
      metricName,
      metricType: MetricsDataType.Gauge,
      ...overrides,
    });

    const increaseSelect = (metricName: string): MetricSelect => ({
      aggFn: 'increase',
      aggCondition: '',
      aggConditionLanguage: 'sql',
      valueExpression: 'Value',
      metricName,
      metricType: MetricsDataType.Sum,
    });

    const histQuantileSelect = (
      metricName: string,
      level: number,
    ): MetricSelect => ({
      aggFn: 'quantile',
      level,
      aggCondition: '',
      aggConditionLanguage: 'sql',
      valueExpression: 'Value',
      metricName,
      metricType: MetricsDataType.Histogram,
    });

    const histCountSelect = (metricName: string): MetricSelect => ({
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'sql',
      valueExpression: '',
      metricName,
      metricType: MetricsDataType.Histogram,
    });

    const baseConfig = (
      overrides: Partial<ChartConfigWithOptDateRange>,
    ): ChartConfigWithOptDateRange =>
      ({
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables,
        from: { databaseName: DATABASE, tableName: '' },
        select: [],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: DATE_RANGE,
        granularity: '1 minute',
        ...overrides,
      }) as ChartConfigWithOptDateRange;

    const runConfig = (config: ChartConfigWithOptDateRange) =>
      hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });

    type Row = Record<string, unknown>;

    /**
     * Column accessor for result rows keyed by rendered column name. Goes
     * through Object.entries so the security/detect-object-injection lint
     * rule doesn't flag every (test-local, literal) column lookup.
     */
    const col = (row: Row | undefined, name: string): unknown =>
      row == null ? undefined : new Map(Object.entries(row)).get(name);

    /** Index rows by their time bucket. Throws on duplicate buckets. */
    const rowsByBucket = (data: unknown): Map<string, Row> => {
      const map = new Map<string, Row>();
      for (const row of data as Row[]) {
        const key = String(col(row, '__hdx_time_bucket'));
        expect(map.has(key)).toBe(false);
        map.set(key, row);
      }
      return map;
    };

    /** Index grouped rows by (bucket, group value). Throws on duplicates. */
    const rowsByBucketAndGroup = (
      data: unknown,
      groupColumn: string,
    ): Map<string, Row> => {
      const map = new Map<string, Row>();
      for (const row of data as Row[]) {
        const key = `${String(col(row, '__hdx_time_bucket'))}|${String(col(row, groupColumn))}`;
        expect(map.has(key)).toBe(false);
        map.set(key, row);
      }
      return map;
    };

    /**
     * A series with no data at a joined row must read as a gap — nullish or
     * NaN, never 0 (or any other number). The current node-side merge leaves
     * the key absent (undefined) or computes JS NaN; a SQL-side merge yields
     * JSON null. All three are gaps to every consumer, so accept any of them.
     */
    const expectGap = (value: unknown) => {
      expect(value == null || Number.isNaN(Number(value))).toBe(true);
    };

    /** The value-column contract: numeric per convertCHDataTypeToJSType. */
    const expectNumericValueColumns = (
      meta: Array<{ name: string; type: string }> | undefined,
      expectedNames: string[],
    ) => {
      const names = meta?.map(m => m.name) ?? [];
      expect(names.slice(0, expectedNames.length)).toEqual(expectedNames);
      for (const name of expectedNames) {
        const column = meta?.find(m => m.name === name);
        expect(convertCHDataTypeToJSType(column?.type ?? '')).toBe(
          JSDataType.Number,
        );
      }
    };

    beforeAll(async () => {
      await client.command({
        query: `CREATE OR REPLACE TABLE ${DATABASE}.${GAUGE_TABLE} (
          ${OTEL_COMMON_COLUMNS},
          Value Float64 CODEC(ZSTD(1)),
          Flags UInt32 CODEC(ZSTD(1)),
          ${OTEL_EXEMPLARS_COLUMNS},
          ${OTEL_INDEXES}
        ) ENGINE = MergeTree PARTITION BY toDate(TimeUnix) ${OTEL_ORDER_BY}`,
      });
      await client.command({
        query: `CREATE OR REPLACE TABLE ${DATABASE}.${SUM_TABLE} (
          ${OTEL_COMMON_COLUMNS},
          Value Float64 CODEC(ZSTD(1)),
          Flags UInt32 CODEC(ZSTD(1)),
          ${OTEL_EXEMPLARS_COLUMNS},
          AggregationTemporality Int32 CODEC(ZSTD(1)),
          IsMonotonic Bool CODEC(ZSTD(1)),
          ${OTEL_INDEXES}
        ) ENGINE = MergeTree PARTITION BY toDate(TimeUnix) ${OTEL_ORDER_BY}`,
      });
      await client.command({
        query: `CREATE OR REPLACE TABLE ${DATABASE}.${HIST_TABLE} (
          ${OTEL_COMMON_COLUMNS},
          Count UInt64 CODEC(Delta(8), ZSTD(1)),
          Sum Float64 CODEC(ZSTD(1)),
          BucketCounts Array(UInt64) CODEC(ZSTD(1)),
          ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
          ${OTEL_EXEMPLARS_COLUMNS},
          Flags UInt32 CODEC(ZSTD(1)),
          Min Float64 CODEC(ZSTD(1)),
          Max Float64 CODEC(ZSTD(1)),
          AggregationTemporality Int32 CODEC(ZSTD(1)),
          ${OTEL_INDEXES}
        ) ENGINE = MergeTree PARTITION BY toDate(TimeUnix) ${OTEL_ORDER_BY}`,
      });

      await client.insert({
        table: `${DATABASE}.${GAUGE_TABLE}`,
        values: [
          // Gap semantics: gap.one covers buckets 0-1, gap.two covers 1-2.
          gaugeRow('gap.one', insertTs(0), 'svc-a', 10),
          gaugeRow('gap.one', insertTs(1), 'svc-a', 20),
          gaugeRow('gap.two', insertTs(1), 'svc-a', 200),
          gaugeRow('gap.two', insertTs(2), 'svc-a', 300),
          // Grouped merge: grp.one has svc-a/svc-b, grp.two has svc-a/svc-c.
          gaugeRow('grp.one', insertTs(0), 'svc-a', 1),
          gaugeRow('grp.one', insertTs(0), 'svc-b', 2),
          gaugeRow('grp.two', insertTs(0), 'svc-a', 10),
          gaugeRow('grp.two', insertTs(0), 'svc-c', 30),
          // Ungrouped ratio: err/total per bucket exercises every operand
          // combination — both present, numerator missing, denominator
          // missing, denominator zero.
          gaugeRow('ratio.err', insertTs(0), 'svc-a', 5),
          gaugeRow('ratio.total', insertTs(0), 'svc-a', 10),
          gaugeRow('ratio.total', insertTs(1), 'svc-a', 20),
          gaugeRow('ratio.err', insertTs(2), 'svc-a', 8),
          gaugeRow('ratio.err', insertTs(3), 'svc-a', 7),
          gaugeRow('ratio.total', insertTs(3), 'svc-a', 0),
          // Grouped ratio: per-group operand combinations at bucket 0, plus a
          // second bucket to prove share_of_total totals are per-bucket.
          gaugeRow('grpratio.err', insertTs(0), 'svc-a', 1),
          gaugeRow('grpratio.err', insertTs(0), 'svc-b', 6),
          gaugeRow('grpratio.total', insertTs(0), 'svc-a', 4),
          gaugeRow('grpratio.total', insertTs(0), 'svc-b', 12),
          gaugeRow('grpratio.total', insertTs(0), 'svc-c', 8),
          gaugeRow('grpratio.err', insertTs(0), 'svc-d', 5),
          gaugeRow('grpratio.err', insertTs(1), 'svc-a', 2),
          gaugeRow('grpratio.total', insertTs(1), 'svc-a', 5),
          // Alias collision: one metric, two services; the filtered split
          // averages svc-a only, the unfiltered split averages both.
          gaugeRow('col.one', insertTs(0), 'svc-a', 10),
          gaugeRow('col.one', insertTs(0), 'svc-b', 30),
          // Mixed gauge+sum: cpu gauge for svc-a with a gap at bucket 1.
          gaugeRow('mix.cpu', insertTs(0), 'svc-a', 1),
          gaugeRow('mix.cpu', insertTs(2), 'svc-a', 3),
          // Table/number shapes.
          gaugeRow('tbl.one', insertTs(0), 'svc-a', 10),
          gaugeRow('tbl.one', insertTs(0), 'svc-b', 20),
          gaugeRow('tbl.two', insertTs(0), 'svc-a', 100),
          // Formula motivating example:
          // success / (success + error + fsi) * 100. Bucket 0 has all three
          // operands; bucket 1 has only a zero success (zero denominator);
          // bucket 2 has only errors (missing numerator).
          gaugeRow('form.success', insertTs(0), 'svc-a', 90),
          gaugeRow('form.error', insertTs(0), 'svc-a', 8),
          gaugeRow('form.fsi', insertTs(0), 'svc-a', 2),
          gaugeRow('form.success', insertTs(1), 'svc-a', 0),
          gaugeRow('form.error', insertTs(2), 'svc-a', 5),
          // Grouped gauge+histogram mix.
          gaugeRow('grpmix.gauge', insertTs(1), 'svc-a', 42),
        ],
        format: 'JSONEachRow',
      });

      await client.insert({
        table: `${DATABASE}.${SUM_TABLE}`,
        values: [
          // Cumulative counters: svc-a increases by 5 then 10; svc-b by 4.
          sumRow('mix.requests', insertTs(0), 'svc-a', 10),
          sumRow('mix.requests', insertTs(1), 'svc-a', 15),
          sumRow('mix.requests', insertTs(2), 'svc-a', 25),
          sumRow('mix.requests', insertTs(0), 'svc-b', 100),
          sumRow('mix.requests', insertTs(1), 'svc-b', 104),
        ],
        format: 'JSONEachRow',
      });

      await client.insert({
        table: `${DATABASE}.${HIST_TABLE}`,
        values: [
          // Cumulative histogram: the first point is the zero baseline, the
          // second adds 10 observations in the (0, 10] bucket, so p50 at
          // bucket 1 interpolates to 5 and the all-zero bucket 0 emits no row.
          histRow('grpmix.latency', insertTs(0), 'svc-a', [0, 0, 0], [10, 30]),
          histRow('grpmix.latency', insertTs(1), 'svc-a', [10, 0, 0], [10, 30]),
        ],
        format: 'JSONEachRow',
      });
    });

    afterAll(async () => {
      for (const table of [GAUGE_TABLE, SUM_TABLE, HIST_TABLE]) {
        await client.command({
          query: `DROP TABLE IF EXISTS ${DATABASE}.${table}`,
        });
      }
    });

    it('joins series on the time bucket with full-outer semantics and gaps', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('gap.one'), gaugeSelect('gap.two')],
        }),
      );

      expectNumericValueColumns(result.meta, ['avg(gap.one)', 'avg(gap.two)']);

      // Buckets present in either series survive: 0 (gap.one only),
      // 1 (both), 2 (gap.two only).
      const rows = rowsByBucket(result.data);
      expect([...rows.keys()].sort()).toEqual([
        bucket(0),
        bucket(1),
        bucket(2),
      ]);

      expect(col(rows.get(bucket(0)), 'avg(gap.one)')).toBe(10);
      expectGap(col(rows.get(bucket(0)), 'avg(gap.two)'));

      expect(col(rows.get(bucket(1)), 'avg(gap.one)')).toBe(20);
      expect(col(rows.get(bucket(1)), 'avg(gap.two)')).toBe(200);

      expectGap(col(rows.get(bucket(2)), 'avg(gap.one)'));
      expect(col(rows.get(bucket(2)), 'avg(gap.two)')).toBe(300);
    });

    it('keys grouped rows by (bucket, group) and preserves one-sided groups', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      expectNumericValueColumns(result.meta, ['avg(grp.one)', 'avg(grp.two)']);

      // One row per (bucket, service); services from either series survive.
      const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
      expect([...rows.keys()].sort()).toEqual([
        `${bucket(0)}|svc-a`,
        `${bucket(0)}|svc-b`,
        `${bucket(0)}|svc-c`,
      ]);

      const svcA = rows.get(`${bucket(0)}|svc-a`);
      expect(col(svcA, 'avg(grp.one)')).toBe(1);
      expect(col(svcA, 'avg(grp.two)')).toBe(10);

      // svc-b only exists in grp.one, svc-c only in grp.two.
      const svcB = rows.get(`${bucket(0)}|svc-b`);
      expect(col(svcB, 'avg(grp.one)')).toBe(2);
      expectGap(col(svcB, 'avg(grp.two)'));

      const svcC = rows.get(`${bucket(0)}|svc-c`);
      expectGap(col(svcC, 'avg(grp.one)'));
      expect(col(svcC, 'avg(grp.two)')).toBe(30);
    });

    // Consumers read group columns by the exact name a single-series query
    // would produce — for an un-aliased map access that is ClickHouse's
    // DERIVED name (arrayElement(...)), not the expression text. The
    // Kubernetes dashboard (KubernetesDashboardPage.tsx) and external-API
    // clients both do row lookups like
    // row["arrayElement(ResourceAttributes, 'k8s.namespace.name')"], so the
    // merge must not rename these columns. Regression test for the k8s e2e
    // failure where the composed query re-aliased group columns to their
    // expression text and blanked the namespace/pod cells.
    it('preserves ClickHouse-derived column names for expression group-bys', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
          groupBy: [
            {
              aggCondition: '',
              valueExpression: "ResourceAttributes['service.name']",
            },
          ],
        }),
      );

      expectNumericValueColumns(result.meta, ['avg(grp.one)', 'avg(grp.two)']);
      const DERIVED_NAME = "arrayElement(ResourceAttributes, 'service.name')";
      expect(result.meta?.map(m => m.name)).toContain(DERIVED_NAME);

      // Same fixture as the ServiceName-grouped test above (the resource
      // attribute mirrors ServiceName), keyed by the derived column name.
      const rows = rowsByBucketAndGroup(result.data, DERIVED_NAME);
      expect([...rows.keys()].sort()).toEqual([
        `${bucket(0)}|svc-a`,
        `${bucket(0)}|svc-b`,
        `${bucket(0)}|svc-c`,
      ]);
      const svcA = rows.get(`${bucket(0)}|svc-a`);
      expect(col(svcA, 'avg(grp.one)')).toBe(1);
      expect(col(svcA, 'avg(grp.two)')).toBe(10);
      expect(col(rows.get(`${bucket(0)}|svc-b`), 'avg(grp.one)')).toBe(2);
      expectGap(col(rows.get(`${bucket(0)}|svc-b`), 'avg(grp.two)'));
    });

    it('keeps a user alias on an expression group-by as the column name', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
          groupBy: [
            {
              aggCondition: '',
              valueExpression: "ResourceAttributes['service.name']",
              alias: 'service',
            },
          ],
        }),
      );

      expect(result.meta?.map(m => m.name)).toContain('service');
      const rows = rowsByBucketAndGroup(result.data, 'service');
      expect(rows.size).toBe(3);
      expect(col(rows.get(`${bucket(0)}|svc-b`), 'avg(grp.one)')).toBe(2);
      expect(col(rows.get(`${bucket(0)}|svc-c`), 'avg(grp.two)')).toBe(30);
    });

    it('computes an ungrouped metric ratio with 0-for-missing-numerator and gap-for-missing-denominator', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('ratio.err'), gaugeSelect('ratio.total')],
          seriesReturnType: 'ratio',
        }),
      );

      const RATIO_COLUMN = 'avg(ratio.err)/avg(ratio.total)';

      // The ratio column replaces both operand columns and leads the meta.
      const metaNames = result.meta?.map(m => m.name) ?? [];
      expect(metaNames[0]).toBe(RATIO_COLUMN);
      expect(metaNames).not.toContain('avg(ratio.err)');
      expect(metaNames).not.toContain('avg(ratio.total)');

      const rows = rowsByBucket(result.data);
      expect(rows.size).toBe(4);

      // Both operands present: plain quotient.
      expect(Number(col(rows.get(bucket(0)), RATIO_COLUMN))).toBeCloseTo(
        0.5,
        5,
      );
      // Missing numerator counts as 0, not a gap.
      expect(Number(col(rows.get(bucket(1)), RATIO_COLUMN))).toBe(0);
      // Missing denominator is a gap.
      expectGap(col(rows.get(bucket(2)), RATIO_COLUMN));
      // Zero denominator is a gap.
      expectGap(col(rows.get(bucket(3)), RATIO_COLUMN));
    });

    it('computes a grouped metric ratio per group by default', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('grpratio.err'), gaugeSelect('grpratio.total')],
          seriesReturnType: 'ratio',
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      const RATIO_COLUMN = 'avg(grpratio.err)/avg(grpratio.total)';
      expect(result.meta?.map(m => m.name)[0]).toBe(RATIO_COLUMN);

      const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
      expect(rows.size).toBe(5);

      expect(
        Number(col(rows.get(`${bucket(0)}|svc-a`), RATIO_COLUMN)),
      ).toBeCloseTo(1 / 4, 5);
      expect(
        Number(col(rows.get(`${bucket(0)}|svc-b`), RATIO_COLUMN)),
      ).toBeCloseTo(6 / 12, 5);
      // svc-c has a denominator but no numerator: reads 0, not a gap.
      expect(Number(col(rows.get(`${bucket(0)}|svc-c`), RATIO_COLUMN))).toBe(0);
      // svc-d has a numerator but no denominator: a gap.
      expectGap(col(rows.get(`${bucket(0)}|svc-d`), RATIO_COLUMN));
      // Second bucket divides by its own denominator.
      expect(
        Number(col(rows.get(`${bucket(1)}|svc-a`), RATIO_COLUMN)),
      ).toBeCloseTo(2 / 5, 5);
    });

    it('divides by the per-bucket denominator total in share_of_total mode', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('grpratio.err'), gaugeSelect('grpratio.total')],
          seriesReturnType: 'ratio',
          ratioMode: 'share_of_total',
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      const RATIO_COLUMN = 'avg(grpratio.err)/avg(grpratio.total)';
      const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
      expect(rows.size).toBe(5);

      // Bucket 0 denominator total: 4 (svc-a) + 12 (svc-b) + 8 (svc-c) = 24.
      // svc-d contributes no denominator and is excluded from the total, but
      // its numerator still divides by the bucket total.
      expect(
        Number(col(rows.get(`${bucket(0)}|svc-a`), RATIO_COLUMN)),
      ).toBeCloseTo(1 / 24, 5);
      expect(
        Number(col(rows.get(`${bucket(0)}|svc-b`), RATIO_COLUMN)),
      ).toBeCloseTo(6 / 24, 5);
      expect(Number(col(rows.get(`${bucket(0)}|svc-c`), RATIO_COLUMN))).toBe(0);
      expect(
        Number(col(rows.get(`${bucket(0)}|svc-d`), RATIO_COLUMN)),
      ).toBeCloseTo(5 / 24, 5);
      // Bucket 1 has its own total (5), proving totals are per-bucket.
      expect(
        Number(col(rows.get(`${bucket(1)}|svc-a`), RATIO_COLUMN)),
      ).toBeCloseTo(2 / 5, 5);
    });

    it('disambiguates two series that resolve to the same alias', async () => {
      const result = await runConfig(
        baseConfig({
          select: [
            gaugeSelect('col.one', { aggCondition: "ServiceName = 'svc-a'" }),
            gaugeSelect('col.one'),
          ],
        }),
      );

      // Both selects alias to avg(col.one); the second is suffixed with its
      // split index so the two operands stay distinct columns.
      expectNumericValueColumns(result.meta, [
        'avg(col.one)',
        'avg(col.one)__1',
      ]);

      const rows = rowsByBucket(result.data);
      const row = rows.get(bucket(0));
      // Filtered split: avg over svc-a only. Unfiltered: avg over both.
      expect(col(row, 'avg(col.one)')).toBe(10);
      expect(col(row, 'avg(col.one)__1')).toBe(20);
    });

    it('strips the collision suffix from the ratio column label', async () => {
      const result = await runConfig(
        baseConfig({
          select: [
            gaugeSelect('col.one', { aggCondition: "ServiceName = 'svc-a'" }),
            gaugeSelect('col.one'),
          ],
          seriesReturnType: 'ratio',
        }),
      );

      // The denominator's __1 suffix is internal bookkeeping and must not
      // leak into the user-facing ratio label.
      const RATIO_COLUMN = 'avg(col.one)/avg(col.one)';
      expect(result.meta?.map(m => m.name)[0]).toBe(RATIO_COLUMN);

      const rows = rowsByBucket(result.data);
      expect(Number(col(rows.get(bucket(0)), RATIO_COLUMN))).toBeCloseTo(
        0.5,
        5,
      );
    });

    it('joins gauge and sum (increase) series from different tables on the bucket', async () => {
      const result = await runConfig(
        baseConfig({
          select: [gaugeSelect('mix.cpu'), increaseSelect('mix.requests')],
        }),
      );

      expectNumericValueColumns(result.meta, [
        'avg(mix.cpu)',
        'increase(mix.requests)',
      ]);

      const rows = rowsByBucket(result.data);
      expect([...rows.keys()].sort()).toEqual([
        bucket(0),
        bucket(1),
        bucket(2),
      ]);

      // The first counter point contributes no increase; later buckets sum
      // the per-service deltas: 5 + 4 at bucket 1, 10 at bucket 2.
      expect(col(rows.get(bucket(0)), 'avg(mix.cpu)')).toBe(1);
      expect(Number(col(rows.get(bucket(0)), 'increase(mix.requests)'))).toBe(
        0,
      );

      expectGap(col(rows.get(bucket(1)), 'avg(mix.cpu)'));
      expect(Number(col(rows.get(bucket(1)), 'increase(mix.requests)'))).toBe(
        9,
      );

      expect(col(rows.get(bucket(2)), 'avg(mix.cpu)')).toBe(3);
      expect(Number(col(rows.get(bucket(2)), 'increase(mix.requests)'))).toBe(
        10,
      );
    });

    it('joins grouped gauge and sum (increase) series on (bucket, group)', async () => {
      const result = await runConfig(
        baseConfig({
          select: [increaseSelect('mix.requests'), gaugeSelect('mix.cpu')],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      expectNumericValueColumns(result.meta, [
        'increase(mix.requests)',
        'avg(mix.cpu)',
      ]);

      const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
      expect([...rows.keys()].sort()).toEqual([
        `${bucket(0)}|svc-a`,
        `${bucket(0)}|svc-b`,
        `${bucket(1)}|svc-a`,
        `${bucket(1)}|svc-b`,
        `${bucket(2)}|svc-a`,
      ]);

      expect(
        Number(col(rows.get(`${bucket(1)}|svc-a`), 'increase(mix.requests)')),
      ).toBe(5);
      expect(
        Number(col(rows.get(`${bucket(1)}|svc-b`), 'increase(mix.requests)')),
      ).toBe(4);
      expect(
        Number(col(rows.get(`${bucket(2)}|svc-a`), 'increase(mix.requests)')),
      ).toBe(10);

      // The gauge only reports svc-a at buckets 0 and 2.
      expect(col(rows.get(`${bucket(0)}|svc-a`), 'avg(mix.cpu)')).toBe(1);
      expect(col(rows.get(`${bucket(2)}|svc-a`), 'avg(mix.cpu)')).toBe(3);
      expectGap(col(rows.get(`${bucket(1)}|svc-a`), 'avg(mix.cpu)'));
      expectGap(col(rows.get(`${bucket(0)}|svc-b`), 'avg(mix.cpu)'));
      expectGap(col(rows.get(`${bucket(1)}|svc-b`), 'avg(mix.cpu)'));
    });

    it('keeps grouped histogram rows separate from gauge rows (Array "group" column)', async () => {
      const result = await runConfig(
        baseConfig({
          select: [
            gaugeSelect('grpmix.gauge'),
            {
              aggFn: 'quantile',
              level: 0.5,
              aggCondition: '',
              aggConditionLanguage: 'sql',
              valueExpression: 'Value',
              metricName: 'grpmix.latency',
              metricType: MetricsDataType.Histogram,
            },
          ],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      expectNumericValueColumns(result.meta, [
        'avg(grpmix.gauge)',
        'quantile(grpmix.latency)',
      ]);

      // Gauge series group into a plain ServiceName column; histogram series
      // group into a single Array column named "group". The two shapes never
      // share a merge key, so the rows stay separate even though both are for
      // svc-a at bucket 1.
      const metaNames = result.meta?.map(m => m.name) ?? [];
      expect(metaNames).toContain('ServiceName');
      expect(metaNames).toContain('group');

      const data = result.data as Row[];
      expect(data).toHaveLength(2);

      const gaugeRowOut = data.find(r => col(r, 'avg(grpmix.gauge)') != null);
      expect(col(gaugeRowOut, 'avg(grpmix.gauge)')).toBe(42);
      expect(col(gaugeRowOut, 'ServiceName')).toBe('svc-a');
      expect(String(col(gaugeRowOut, '__hdx_time_bucket'))).toBe(bucket(1));
      expectGap(col(gaugeRowOut, 'quantile(grpmix.latency)'));

      const histRowOut = data.find(
        r => col(r, 'quantile(grpmix.latency)') != null,
      );
      // 10 observations in the (0, 10] bucket: p50 interpolates to 5.
      expect(Number(col(histRowOut, 'quantile(grpmix.latency)'))).toBeCloseTo(
        5,
        5,
      );
      expect(col(histRowOut, 'group')).toEqual(['svc-a']);
      expect(String(col(histRowOut, '__hdx_time_bucket'))).toBe(bucket(1));
      expectGap(col(histRowOut, 'avg(grpmix.gauge)'));
    });

    // Regression (HDX-5077 follow-up): series whose native value types have
    // no least supertype — histogram quantile (Float64) vs histogram count
    // (Int64) / scalar count (UInt64) — must still merge. Without per-branch
    // Float64 normalization the UNION ALL either fails with NO_COMMON_TYPE
    // (use_variant_as_common_type = 0) or produces Variant(Float64, Int64)
    // columns (the modern default) that consumers don't classify as numeric.
    // The meta assertions pin the normalized type directly (not just
    // convertCHDataTypeToJSType, which also tolerates numeric Variants as a
    // defensive layer) because a Variant here would break servers running
    // with use_variant_as_common_type = 0 before any JS ever sees it.
    const expectFloat64ValueColumns = (
      meta: Array<{ name: string; type: string }> | undefined,
      expectedNames: string[],
    ) => {
      expectNumericValueColumns(meta, expectedNames);
      for (const name of expectedNames) {
        const column = meta?.find(m => m.name === name);
        expect(['Float64', 'Nullable(Float64)']).toContain(column?.type);
      }
    };

    it('merges histogram quantile (Float64) with histogram count (Int64)', async () => {
      const result = await runConfig(
        baseConfig({
          select: [
            histQuantileSelect('grpmix.latency', 0.5),
            histCountSelect('grpmix.latency'),
          ],
        }),
      );

      expectFloat64ValueColumns(result.meta, [
        'quantile(grpmix.latency)',
        'count(grpmix.latency)',
      ]);

      const rows = rowsByBucket(result.data);
      expect([...rows.keys()].sort()).toEqual([bucket(0), bucket(1)]);

      // Bucket 0 is the cumulative zero baseline: the count series emits a
      // 0 delta row while the all-zero quantile emits no row (a gap).
      expectGap(col(rows.get(bucket(0)), 'quantile(grpmix.latency)'));
      expect(Number(col(rows.get(bucket(0)), 'count(grpmix.latency)'))).toBe(0);

      // Bucket 1 adds 10 observations in the (0, 10] bucket: p50
      // interpolates to 5 and the count delta is 10.
      expect(
        Number(col(rows.get(bucket(1)), 'quantile(grpmix.latency)')),
      ).toBeCloseTo(5, 5);
      expect(Number(col(rows.get(bucket(1)), 'count(grpmix.latency)'))).toBe(
        10,
      );
    });

    it('merges gauge avg (Float64) with histogram count (Int64)', async () => {
      const result = await runConfig(
        baseConfig({
          select: [
            gaugeSelect('grpmix.gauge'),
            histCountSelect('grpmix.latency'),
          ],
        }),
      );

      expectFloat64ValueColumns(result.meta, [
        'avg(grpmix.gauge)',
        'count(grpmix.latency)',
      ]);

      const rows = rowsByBucket(result.data);
      expect([...rows.keys()].sort()).toEqual([bucket(0), bucket(1)]);

      expectGap(col(rows.get(bucket(0)), 'avg(grpmix.gauge)'));
      expect(Number(col(rows.get(bucket(0)), 'count(grpmix.latency)'))).toBe(0);

      expect(col(rows.get(bucket(1)), 'avg(grpmix.gauge)')).toBe(42);
      expect(Number(col(rows.get(bucket(1)), 'count(grpmix.latency)'))).toBe(
        10,
      );
    });

    it('merges grouped non-timeseries (table) rows on the group values', async () => {
      const result = await runConfig(
        baseConfig({
          displayType: DisplayType.Table,
          granularity: undefined,
          select: [gaugeSelect('tbl.one'), gaugeSelect('tbl.two')],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        }),
      );

      expectNumericValueColumns(result.meta, ['avg(tbl.one)', 'avg(tbl.two)']);

      const data = result.data as Row[];
      expect(data).toHaveLength(2);
      const byService = new Map(data.map(r => [col(r, 'ServiceName'), r]));

      const svcA = byService.get('svc-a');
      expect(col(svcA, 'avg(tbl.one)')).toBe(10);
      expect(col(svcA, 'avg(tbl.two)')).toBe(100);

      const svcB = byService.get('svc-b');
      expect(col(svcB, 'avg(tbl.one)')).toBe(20);
      expectGap(col(svcB, 'avg(tbl.two)'));
    });

    it('merges ungrouped number-shape results into a single row', async () => {
      const result = await runConfig(
        baseConfig({
          displayType: DisplayType.Number,
          granularity: undefined,
          select: [gaugeSelect('tbl.one'), gaugeSelect('tbl.two')],
        }),
      );

      expectNumericValueColumns(result.meta, ['avg(tbl.one)', 'avg(tbl.two)']);

      const data = result.data as Row[];
      expect(data).toHaveLength(1);
      expect(col(data[0], 'avg(tbl.one)')).toBe(15);
      expect(col(data[0], 'avg(tbl.two)')).toBe(100);
    });

    // Formulas compile into the composed query's final projection, reusing
    // the same fixtures as the merge baseline above.
    describe('formulas', () => {
      it('computes the motivating success-rate example: A / (A + B + C) * 100', async () => {
        const result = await runConfig(
          baseConfig({
            select: [
              gaugeSelect('form.success'),
              gaugeSelect('form.error'),
              gaugeSelect('form.fsi'),
            ],
            formulas: [
              { expression: 'A / (A + B + C) * 100', alias: 'Success rate' },
            ],
          }),
        );

        // Meta contract: operand value columns first, in select order, then
        // the formula column — all numeric — ahead of the bucket column.
        expectNumericValueColumns(result.meta, [
          'avg(form.success)',
          'avg(form.error)',
          'avg(form.fsi)',
          'Success rate',
        ]);

        const rows = rowsByBucket(result.data);
        expect([...rows.keys()].sort()).toEqual([
          bucket(0),
          bucket(1),
          bucket(2),
        ]);

        // All operands present: 90 / (90 + 8 + 2) * 100.
        expect(Number(col(rows.get(bucket(0)), 'Success rate'))).toBeCloseTo(
          90,
          5,
        );
        // Zero success and nothing else: denominator 0 -> gap, not 0 or error.
        expectGap(col(rows.get(bucket(1)), 'Success rate'));
        // Missing success counts as 0: 0 / (0 + 5 + 0) * 100 = 0.
        expect(Number(col(rows.get(bucket(2)), 'Success rate'))).toBe(0);
      });

      it('matches the ratio projection semantics for A / B (0-for-missing-numerator, gap-for-zero/missing-denominator)', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('ratio.err'), gaugeSelect('ratio.total')],
            formulas: [{ expression: 'A / B', alias: 'err rate' }],
            showOperandSeries: false,
          }),
        );

        const rows = rowsByBucket(result.data);
        expect(rows.size).toBe(4);

        // Same fixture and expectations as the seriesReturnType: 'ratio'
        // test above — the formula path must be drop-in consistent.
        expect(Number(col(rows.get(bucket(0)), 'err rate'))).toBeCloseTo(
          0.5,
          5,
        );
        expect(Number(col(rows.get(bucket(1)), 'err rate'))).toBe(0);
        expectGap(col(rows.get(bucket(2)), 'err rate'));
        expectGap(col(rows.get(bucket(3)), 'err rate'));
      });

      it('computes a formula over mixed gauge and sum (increase) operands', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('mix.cpu'), increaseSelect('mix.requests')],
            formulas: [{ expression: 'A + B', alias: 'combined' }],
          }),
        );

        expectNumericValueColumns(result.meta, [
          'avg(mix.cpu)',
          'increase(mix.requests)',
          'combined',
        ]);

        const rows = rowsByBucket(result.data);
        // Gauge 1 + increase 0 at bucket 0; missing gauge counts as 0 at
        // bucket 1; both present at bucket 2.
        expect(Number(col(rows.get(bucket(0)), 'combined'))).toBe(1);
        expect(Number(col(rows.get(bucket(1)), 'combined'))).toBe(9);
        expect(Number(col(rows.get(bucket(2)), 'combined'))).toBe(13);
      });

      it('computes a grouped formula per (bucket, group) row', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
            formulas: [{ expression: 'A + B', alias: 'both' }],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
          }),
        );

        expectNumericValueColumns(result.meta, [
          'avg(grp.one)',
          'avg(grp.two)',
          'both',
        ]);

        const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
        expect(rows.size).toBe(3);
        expect(Number(col(rows.get(`${bucket(0)}|svc-a`), 'both'))).toBe(11);
        // One-sided groups: the missing operand contributes 0.
        expect(Number(col(rows.get(`${bucket(0)}|svc-b`), 'both'))).toBe(2);
        expect(Number(col(rows.get(`${bucket(0)}|svc-c`), 'both'))).toBe(30);
      });

      it('drops the operand columns from meta and rows when showOperandSeries is false', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
            formulas: [{ expression: 'A + B', alias: 'both' }],
            showOperandSeries: false,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
          }),
        );

        // The formula column leads the meta; the operands are gone but the
        // group/bucket passthrough columns survive.
        expectNumericValueColumns(result.meta, ['both']);
        const metaNames = result.meta?.map(m => m.name) ?? [];
        expect(metaNames).not.toContain('avg(grp.one)');
        expect(metaNames).not.toContain('avg(grp.two)');
        expect(metaNames).toContain('ServiceName');

        const rows = rowsByBucketAndGroup(result.data, 'ServiceName');
        expect(rows.size).toBe(3);
        expect(Number(col(rows.get(`${bucket(0)}|svc-a`), 'both'))).toBe(11);
      });

      it('computes a single-series formula (composed path with one branch)', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('gap.one')],
            formulas: [{ expression: 'A * 100', alias: 'pct' }],
          }),
        );

        expectNumericValueColumns(result.meta, ['avg(gap.one)', 'pct']);

        const rows = rowsByBucket(result.data);
        expect(rows.size).toBe(2);
        expect(Number(col(rows.get(bucket(0)), 'pct'))).toBe(1000);
        expect(Number(col(rows.get(bucket(1)), 'pct'))).toBe(2000);
      });

      it('computes formulas for number-shape (ungrouped, no time bucket) charts', async () => {
        const result = await runConfig(
          baseConfig({
            displayType: DisplayType.Number,
            granularity: undefined,
            select: [gaugeSelect('tbl.one'), gaugeSelect('tbl.two')],
            formulas: [{ expression: 'A / B * 100', alias: 'pct' }],
            showOperandSeries: false,
          }),
        );

        expectNumericValueColumns(result.meta, ['pct']);
        const data = result.data as Row[];
        expect(data).toHaveLength(1);
        // avg(tbl.one) = 15, avg(tbl.two) = 100.
        expect(Number(col(data[0], 'pct'))).toBeCloseTo(15, 5);
      });

      it('computes formulas for grouped table-shape charts', async () => {
        const result = await runConfig(
          baseConfig({
            displayType: DisplayType.Table,
            granularity: undefined,
            select: [gaugeSelect('tbl.one'), gaugeSelect('tbl.two')],
            formulas: [{ expression: 'B / A', alias: 'ratio' }],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
          }),
        );

        expectNumericValueColumns(result.meta, [
          'avg(tbl.one)',
          'avg(tbl.two)',
          'ratio',
        ]);

        const data = result.data as Row[];
        const byService = new Map(data.map(r => [col(r, 'ServiceName'), r]));
        expect(Number(col(byService.get('svc-a'), 'ratio'))).toBeCloseTo(10, 5);
        // svc-b has no tbl.two rows: 0 / 20 = 0.
        expect(Number(col(byService.get('svc-b'), 'ratio'))).toBe(0);
      });
    });

    // HAVING / ORDER BY / LIMIT apply to the final joined result and
    // reference its output columns (HDX-5126) — not each per-series branch,
    // where the output names don't exist and each series would be
    // filtered/ordered/truncated independently.
    //
    // Fixture recap (grpratio.* grouped by ServiceName, table shape):
    //   avg(grpratio.err):   svc-a 1.5, svc-b 6, svc-d 5,   svc-c gap
    //   avg(grpratio.total): svc-a 4.5, svc-b 12, svc-c 8,  svc-d gap
    describe('outer HAVING / ORDER BY / LIMIT (HDX-5126)', () => {
      const grpRatioTable = (overrides: Partial<ChartConfigWithOptDateRange>) =>
        baseConfig({
          displayType: DisplayType.Table,
          granularity: undefined,
          select: [gaugeSelect('grpratio.err'), gaugeSelect('grpratio.total')],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
          ...overrides,
        });

      const services = (data: unknown) =>
        (data as Row[]).map(r => col(r, 'ServiceName'));

      it('filters the joined rows with HAVING on an operand output column', async () => {
        const result = await runConfig(
          grpRatioTable({
            having: '"avg(grpratio.total)" > 5',
            havingLanguage: 'sql',
          }),
        );

        // svc-a (4.5) fails the predicate; svc-d has err data but a NULL
        // total, and NULL > 5 filters out. A per-branch HAVING could never
        // drop svc-d — its err branch has no total column to inspect.
        expect(services(result.data).sort()).toEqual(['svc-b', 'svc-c']);
      });

      it('filters with HAVING on a formula output column', async () => {
        const result = await runConfig(
          grpRatioTable({
            formulas: [{ expression: 'A / B', alias: 'err rate' }],
            having: '"err rate" >= 0.5',
            havingLanguage: 'sql',
          }),
        );

        // Rates: svc-a 1.5/4.5≈0.33, svc-b 0.5, svc-c 0/8=0, svc-d gap.
        expect(services(result.data)).toEqual(['svc-b']);
        expect(Number(col((result.data as Row[])[0], 'err rate'))).toBeCloseTo(
          0.5,
          5,
        );
      });

      it('orders by a plain group column across the joined result', async () => {
        const result = await runConfig(
          grpRatioTable({
            orderBy: [{ valueExpression: 'ServiceName', ordering: 'DESC' }],
          }),
        );

        expect(services(result.data)).toEqual([
          'svc-d',
          'svc-c',
          'svc-b',
          'svc-a',
        ]);
      });

      it('orders by an output value column and paginates the joined result with LIMIT/OFFSET', async () => {
        const orderBy = [
          {
            valueExpression: '"avg(grpratio.total)"',
            ordering: 'DESC' as const,
          },
        ];

        // Full order: svc-b (12), svc-c (8), svc-a (4.5), svc-d (NULL —
        // ClickHouse sorts NULLS LAST by default).
        const page1 = await runConfig(
          grpRatioTable({ orderBy, limit: { limit: 2 } }),
        );
        expect(services(page1.data)).toEqual(['svc-b', 'svc-c']);

        // The second page continues the SAME joined ordering — page windows
        // are disjoint and the group universe is consistent across series.
        // (A per-branch LIMIT truncated each series to its own arbitrary
        // groups before the join, so pages neither aligned nor partitioned.)
        const page2 = await runConfig(
          grpRatioTable({ orderBy, limit: { limit: 2, offset: 2 } }),
        );
        expect(services(page2.data)).toEqual(['svc-a', 'svc-d']);

        // The joined row is intact on every page: svc-d keeps its err value
        // and its total gap.
        const svcD = (page2.data as Row[])[1];
        expect(Number(col(svcD, 'avg(grpratio.err)'))).toBe(5);
        expectGap(col(svcD, 'avg(grpratio.total)'));
      });

      it('orders time-series rows by bucket first, user sort second', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            orderBy: [{ valueExpression: 'ServiceName', ordering: 'DESC' }],
          }),
        );

        // All rows share bucket 0; the user sort breaks the tie in reverse
        // service order.
        expect(services(result.data)).toEqual(['svc-c', 'svc-b', 'svc-a']);
      });

      it('resolves an expression group-by in ORDER BY via its derived output name', async () => {
        // The passthrough column for an expression group-by keeps its
        // ClickHouse-derived name. The contract for referencing it from
        // ORDER BY/HAVING is the (quoted) output name — the raw map-access
        // expression is not resolvable in the outer scope, where the source
        // columns no longer exist.
        const result = await runConfig(
          grpRatioTable({
            groupBy: [
              {
                aggCondition: '',
                valueExpression: "ResourceAttributes['service.name']",
              },
            ],
            orderBy: [
              {
                valueExpression: `"arrayElement(ResourceAttributes, 'service.name')"`,
                ordering: 'DESC',
              },
            ],
          }),
        );

        const DERIVED_NAME = "arrayElement(ResourceAttributes, 'service.name')";
        expect((result.data as Row[]).map(r => col(r, DERIVED_NAME))).toEqual([
          'svc-d',
          'svc-c',
          'svc-b',
          'svc-a',
        ]);
      });

      it('orders by an aliased expression group-by through the alias', async () => {
        const result = await runConfig(
          grpRatioTable({
            groupBy: [
              {
                aggCondition: '',
                valueExpression: "ResourceAttributes['service.name']",
                alias: 'service',
              },
            ],
            orderBy: [{ valueExpression: 'service', ordering: 'ASC' }],
          }),
        );

        expect((result.data as Row[]).map(r => col(r, 'service'))).toEqual([
          'svc-a',
          'svc-b',
          'svc-c',
          'svc-d',
        ]);
      });

      it('filters and orders the ratio output column', async () => {
        const result = await runConfig(
          grpRatioTable({
            seriesReturnType: 'ratio',
            having: '"avg(grpratio.err)/avg(grpratio.total)" >= 0.3',
            havingLanguage: 'sql',
            orderBy: [
              {
                valueExpression: '"avg(grpratio.err)/avg(grpratio.total)"',
                ordering: 'DESC',
              },
            ],
          }),
        );

        // Rates: svc-a ≈0.33, svc-b 0.5, svc-c 0, svc-d gap (NULL fails the
        // predicate).
        expect(services(result.data)).toEqual(['svc-b', 'svc-a']);
      });

      it('filters a share_of_total ratio after its window function evaluates', async () => {
        // share_of_total is built on sum(...) OVER (...), which ClickHouse
        // prohibits inside HAVING — the filter runs as WHERE on a wrapper
        // around the joined result instead.
        const RATIO = 'avg(grpratio.err)/avg(grpratio.total)';
        const result = await runConfig(
          grpRatioTable({
            seriesReturnType: 'ratio',
            ratioMode: 'share_of_total',
            having: `"${RATIO}" >= 0.15`,
            havingLanguage: 'sql',
            orderBy: [{ valueExpression: `"${RATIO}"`, ordering: 'DESC' }],
          }),
        );

        // Denominator total across ALL groups (gauge reads the last value
        // per series on the ungrouped-time table shape, so svc-a's total is
        // 5): 5 + 12 + 8 = 25. Shares: svc-a 2/25 = 0.08, svc-b 6/25 = 0.24,
        // svc-c 0, svc-d 5/25 = 0.2 — so >= 0.15 keeps b and d.
        expect(services(result.data)).toEqual(['svc-b', 'svc-d']);
        // The share divides by the pre-filter total (25), proving the window
        // evaluated over the full joined result before the filter.
        const rows = result.data as Row[];
        expect(Number(col(rows[0], RATIO))).toBeCloseTo(6 / 25, 5);
        expect(Number(col(rows[1], RATIO))).toBeCloseTo(5 / 25, 5);
      });

      it('partitions the share_of_total window per bucket on a time series, then filters', async () => {
        const RATIO = 'avg(grpratio.err)/avg(grpratio.total)';
        const result = await runConfig(
          baseConfig({
            select: [
              gaugeSelect('grpratio.err'),
              gaugeSelect('grpratio.total'),
            ],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            seriesReturnType: 'ratio',
            ratioMode: 'share_of_total',
            having: `"${RATIO}" >= 0.2`,
            havingLanguage: 'sql',
            orderBy: [{ valueExpression: `"${RATIO}"`, ordering: 'DESC' }],
          }),
        );

        // Per-bucket totals: bucket 0 = 4 + 12 + 8 = 24 (shares a 1/24,
        // b 0.25, c 0, d 5/24); bucket 1 = 5 (share a 2/5 = 0.4). The
        // >= 0.2 filter keeps (b0, b), (b0, d) and (b1, a); rows stay
        // bucket-ordered first (outermost ORDER BY, outside the wrapper),
        // share-descending within the bucket.
        const rows = result.data as Row[];
        expect(
          rows.map(r => [
            String(col(r, '__hdx_time_bucket')),
            col(r, 'ServiceName'),
          ]),
        ).toEqual([
          [bucket(0), 'svc-b'],
          [bucket(0), 'svc-d'],
          [bucket(1), 'svc-a'],
        ]);
        expect(Number(col(rows[0], RATIO))).toBeCloseTo(6 / 24, 5);
        expect(Number(col(rows[1], RATIO))).toBeCloseTo(5 / 24, 5);
        expect(Number(col(rows[2], RATIO))).toBeCloseTo(2 / 5, 5);
      });

      it('filters number-shape results with HAVING (no GROUP BY)', async () => {
        const numberConfig = (having: string) =>
          baseConfig({
            displayType: DisplayType.Number,
            granularity: undefined,
            select: [gaugeSelect('tbl.one'), gaugeSelect('tbl.two')],
            having,
            havingLanguage: 'sql',
          });

        // The number shape has no passthrough columns, so the outer query is
        // one implicit global aggregation — HAVING filters its single row.
        // Values: avg(tbl.one) = 15, avg(tbl.two) = 100.
        const kept = await runConfig(numberConfig('"avg(tbl.two)" > 50'));
        expect(kept.data as Row[]).toHaveLength(1);
        expect(col((kept.data as Row[])[0], 'avg(tbl.one)')).toBe(15);

        const dropped = await runConfig(numberConfig('"avg(tbl.two)" > 200'));
        expect(dropped.data as Row[]).toHaveLength(0);
      });

      it('filters time-series (bucket, group) rows with HAVING', async () => {
        const result = await runConfig(
          baseConfig({
            select: [gaugeSelect('grp.one'), gaugeSelect('grp.two')],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            having: '"avg(grp.one)" >= 2',
            havingLanguage: 'sql',
          }),
        );

        // Joined bucket-0 rows: svc-a (grp.one 1), svc-b (grp.one 2),
        // svc-c (grp.one NULL — grp.two only). Only svc-b passes; NULL fails
        // the predicate like any SQL comparison.
        const rows = result.data as Row[];
        expect(rows).toHaveLength(1);
        expect(col(rows[0], 'ServiceName')).toBe('svc-b');
        expect(String(col(rows[0], '__hdx_time_bucket'))).toBe(bucket(0));
        expect(col(rows[0], 'avg(grp.one)')).toBe(2);
      });

      it('applies HAVING across heterogeneous branch classes (gauge + histogram)', async () => {
        const result = await runConfig(
          baseConfig({
            select: [
              gaugeSelect('grpmix.gauge'),
              histQuantileSelect('grpmix.latency', 0.5),
            ],
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            having: '"avg(grpmix.gauge)" >= 0',
            havingLanguage: 'sql',
          }),
        );

        // Gauge and histogram rows never share a merge key (plain vs Array
        // group columns), so the histogram row carries a NULL gauge value
        // and the HAVING on the gauge column drops it.
        const rows = result.data as Row[];
        expect(rows).toHaveLength(1);
        expect(col(rows[0], 'ServiceName')).toBe('svc-a');
        expect(col(rows[0], 'avg(grpmix.gauge)')).toBe(42);
        expectGap(col(rows[0], 'quantile(grpmix.latency)'));
      });

      it('orders by a formula output column', async () => {
        const result = await runConfig(
          grpRatioTable({
            formulas: [{ expression: 'A / B', alias: 'err rate' }],
            orderBy: [{ valueExpression: '"err rate"', ordering: 'DESC' }],
            limit: { limit: 2 },
          }),
        );

        // Rates (last-value gauge semantics on the table shape): svc-a
        // 2/5 = 0.4, svc-b 0.5, svc-c 0, svc-d gap (NULL sorts last).
        expect(services(result.data)).toEqual(['svc-b', 'svc-a']);
        expect(Number(col((result.data as Row[])[0], 'err rate'))).toBeCloseTo(
          0.5,
          5,
        );
      });

      it('rejects HAVING on an operand hidden by showOperandSeries: false', async () => {
        // The contract is "reference what the result outputs": with the
        // operand series dropped from the projection, their names are not
        // resolvable — the query fails instead of silently filtering on a
        // column the chart doesn't show.
        await expect(
          runConfig(
            grpRatioTable({
              formulas: [{ expression: 'A / B', alias: 'err rate' }],
              showOperandSeries: false,
              having: '"avg(grpratio.err)" > 1',
              havingLanguage: 'sql',
            }),
          ),
        ).rejects.toThrow();
      });
    });
  });
});
