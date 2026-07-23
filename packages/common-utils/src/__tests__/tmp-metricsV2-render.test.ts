import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

describe('tmp metrics v2 render', () => {
  let mockMetadata: jest.Mocked<Metadata>;
  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    const columns = [
      { name: 'TimeUnix', type: 'DateTime64(3)' },
      { name: 'Date', type: 'Date' },
      { name: 'Value', type: 'Float64' },
      { name: 'ServiceName', type: 'LowCardinality(String)' },
    ];
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue(columns),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
      getColumn: jest
        .fn()
        .mockImplementation(async ({ column }) =>
          columns.find(col => col.name === column),
        ),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'TimeUnix' }),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
      getMetricTemporality: jest.fn().mockResolvedValue(undefined),
      getMetricSeriesProfile: jest.fn().mockResolvedValue({}),
      getMetricSeriesCountEstimate: jest.fn().mockResolvedValue(undefined),
      getMetricScrapeIntervalEstimate: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockResolvedValue(new Map()),
      isSettingChangeable: jest.fn().mockResolvedValue(undefined),
      isClickHouseCloud: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<Metadata>;
  });

  // Raw-tier quantile shapes are capped at a 3h window (routing guard) —
  // quantile tests use this instead of the 24h base range.
  const quantileWindow: { dateRange: [Date, Date] } = {
    dateRange: [
      new Date('2025-02-12T00:00:00Z'),
      new Date('2025-02-12T02:00:00Z'),
    ],
  };

  // Legacy per-type keys are required by the inferred MetricTable type (the
  // zod reduce cast marks them non-optional); empty strings are ignored since
  // series+points routes everything through the v2 translator.
  const V2_TABLES = {
    gauge: '',
    histogram: '',
    sum: '',
    summary: '',
    'exponential histogram': '',
    series: 'otel_metrics_series',
    points: 'otel_metrics_points',
    histogramPoints: 'otel_metrics_histogram_points',
    families: 'otel_metrics_families',
  };

  // Loosely typed: each test spreads this and casts to ChartConfigWithOptDateRange
  const base = {
    displayType: DisplayType.Line,
    connection: 'test-connection',
    metricTables: V2_TABLES,
    from: { databaseName: 'default', tableName: '' },
    where: "Attributes['env'] = 'prod'",
    whereLanguage: 'sql',
    timestampValueExpression: 'TimeUnix',
    dateRange: [
      new Date('2025-02-12T00:00:00Z'),
      new Date('2025-02-13T00:00:00Z'),
    ],
    granularity: '1 minute',
    limit: { limit: 10 },
  };

  it('gauge avg', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.cpu',
            metricType: MetricsDataType.Gauge,
          },
        ],
        groupBy: "ResourceAttributes['host']",
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== GAUGE ===\n', parameterizedQueryToSql(sql));
  });

  it('sum increase with groupBy (TopGroups)', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        select: [
          {
            aggFn: 'increase',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.requests',
            metricType: MetricsDataType.Sum,
          },
        ],
        groupBy: 'ServiceName',
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== SUM INCREASE ===\n', parameterizedQueryToSql(sql));
  });

  it('sum no aggFn', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        select: [
          {
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.requests',
            metricType: MetricsDataType.Sum,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== SUM NO AGGFN ===\n', parameterizedQueryToSql(sql));
  });

  it('histogram quantile with groupBy', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        ...quantileWindow,
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
        groupBy: 'ServiceName',
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== HISTOGRAM QUANTILE ===\n', parameterizedQueryToSql(sql));
  });

  it('sum in raw sql template mode', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        dateRange: [new Date(0), new Date(0)],
        granularity: 'auto',
        isRenderingRawSqlTemplate: true,
        select: [
          {
            aggFn: 'sum',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.requests',
            metricType: MetricsDataType.Sum,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== SUM TEMPLATE MODE ===\n', parameterizedQueryToSql(sql));
  });

  it('histogram count', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== HISTOGRAM COUNT ===\n', parameterizedQueryToSql(sql));
  });

  it('exp histogram quantile', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        ...quantileWindow,
        metricTables: {
          ...base.metricTables,
          expHistogramPoints: 'otel_metrics_exp_histogram_points',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.exp.duration',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
        groupBy: 'ServiceName',
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log(
      '=== EXP HISTOGRAM QUANTILE ===\n',
      parameterizedQueryToSql(sql),
    );
  });

  it('exp histogram quantile branched (delta: no window pass; cumulative: tuple dedup)', async () => {
    const cfg = (temporality: 'delta' | 'cumulative') => {
      // temporality now flows from the series profile (the
      // getMetricTemporality fallback was removed — the profile is fetched
      // for every non-gauge panel)
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality,
        otherMetricTypes: [],
      });
      return {
        ...base,
        ...quantileWindow,
        metricTables: {
          ...base.metricTables,
          expHistogramPoints: 'otel_metrics_exp_histogram_points',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.exp.duration',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
      } as ChartConfigWithOptDateRange;
    };
    const delta = parameterizedQueryToSql(
      await renderChartConfig(cfg('delta'), mockMetadata, undefined),
    );
    // no per-point lag window (the ExpScaled tail's per-(series, bucket)
    // min-scale window is tiny and expected)
    expect(delta).not.toContain('PARTITION BY SeriesHash ORDER BY TimeUnix');
    expect(delta).not.toContain('pos_if_cum');
    expect(delta).toContain('bitAnd(Flags, 1) = 0'); // Rule 6 kept
    const cum = parameterizedQueryToSql(
      await renderChartConfig(cfg('cumulative'), mockMetadata, undefined),
    );
    expect(cum).toContain(
      'argMax((PositiveBucketCounts, PositiveOffset), Count)', // tuple state in the hot dedup
    );
    expect(cum).not.toContain('posMap_delta'); // no dead delta path
    expect(cum).toContain('bitAnd(Flags, 1) = 0');
  });

  it('whale guard: sub-5m buckets + long window + >100k series refuses; scoped or coarse-bucket runs', async () => {
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      850_000,
    );
    const cfg = (granularity: string) =>
      ({
        ...base, // 24h window
        granularity,
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'whale.metric',
            metricType: MetricsDataType.Gauge,
          },
        ],
      }) as ChartConfigWithOptDateRange;
    // 1-minute buckets on 850k series over 24h: refused
    await expect(
      renderChartConfig(cfg('1 minute'), mockMetadata, undefined),
    ).rejects.toThrow('too many series for this granularity');
    // scoped below the threshold: runs
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      40_000,
    );
    await expect(
      renderChartConfig(cfg('1 minute'), mockMetadata, undefined),
    ).resolves.toBeTruthy();
    // estimate unavailable: fails open
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      undefined,
    );
    await expect(
      renderChartConfig(cfg('1 minute'), mockMetadata, undefined),
    ).resolves.toBeTruthy();
    // coarse buckets never consult the estimate
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      850_000,
    );
    await expect(
      renderChartConfig(cfg('5 minute'), mockMetadata, undefined),
    ).resolves.toBeTruthy();
  });

  it('whole-metric fast path: no filters/group-by skips series resolution; scoped panels keep it', async () => {
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: true,
      otherMetricTypes: [],
    });
    const cfg = (extra: object) =>
      ({
        ...base,
        where: '',
        ...extra,
      }) as ChartConfigWithOptDateRange;
    const seriesCteRe = /[^a-zA-Z]Series AS \(/;
    // unfiltered gauge: joinless, no Series CTE, no SeriesHash IN
    const gauge = parameterizedQueryToSql(
      await renderChartConfig(
        cfg({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(gauge).not.toMatch(seriesCteRe);
    expect(gauge).not.toContain('SeriesHash IN');
    expect(gauge).toContain('bitAnd(Flags, 1) = 0'); // Rule 6 survives
    // unfiltered cumulative-monotonic sum: single-branch, joinless
    const sum = parameterizedQueryToSql(
      await renderChartConfig(
        cfg({
          select: [
            {
              aggFn: 'increase',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.requests',
              metricType: MetricsDataType.Sum,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(sum).not.toMatch(seriesCteRe);
    expect(sum).toContain('b.RateIfCumulative AS Increase');
    // the temporality pick is resolved at generation time (the per-point
    // reset-detection multiIf legitimately remains)
    expect(sum).not.toContain('multiIf(\n          s.Temporality');
    // a label filter keeps resolution
    const scoped = parameterizedQueryToSql(
      await renderChartConfig(
        cfg({
          where: "Attributes['env'] = 'prod'",
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(scoped).toMatch(seriesCteRe);
    // a cross-type name collision on the shared float table disables fast
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: true,
      otherMetricTypes: ['sum'],
    });
    const collided = parameterizedQueryToSql(
      await renderChartConfig(
        cfg({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.cpu',
              metricType: MetricsDataType.Gauge,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(collided).toMatch(seriesCteRe);
    // unresolvable profile falls back to resolution for sums
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({});
    const fallback = parameterizedQueryToSql(
      await renderChartConfig(
        cfg({
          select: [
            {
              aggFn: 'sum',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.requests',
              metricType: MetricsDataType.Sum,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(fallback).toMatch(seriesCteRe);
  });

  it('raw quantile window guard refuses >3h tier-less windows', async () => {
    await expect(
      renderChartConfig(
        {
          ...base, // 24h window
          metricTables: {
            ...base.metricTables,
            expHistogramPoints: 'otel_metrics_exp_histogram_points',
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.exp.duration',
              metricType: MetricsDataType.ExponentialHistogram,
            },
          ],
        } as ChartConfigWithOptDateRange,
        mockMetadata,
        undefined,
      ),
    ).rejects.toThrow('window too large for this metric type');
  });

  it('summary quantile', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        ...quantileWindow,
        metricTables: {
          ...base.metricTables,
          summaryPoints: 'otel_metrics_summary_points',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.99,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.summary',
            metricType: MetricsDataType.Summary,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    console.log('=== SUMMARY QUANTILE ===\n', parameterizedQueryToSql(sql));
  });

  it('sum increase routed to 1h rollup tier', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        metricTables: {
          ...base.metricTables,
          points5m: 'otel_metrics_points_5m',
          points1h: 'otel_metrics_points_1h',
        },
        granularity: '1 hour',
        select: [
          {
            aggFn: 'increase',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.requests',
            metricType: MetricsDataType.Sum,
          },
        ],
        groupBy: 'ServiceName',
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    const rendered = parameterizedQueryToSql(sql);
    expect(rendered).toContain('otel_metrics_points_1h');
    expect(rendered).toContain('argMaxMerge(Last)');
    console.log('=== SUM INCREASE (1H ROLLUP) ===\n', rendered);
  });

  it('gauge avg routed to 5m rollup tier', async () => {
    const sql = await renderChartConfig(
      {
        ...base,
        metricTables: {
          ...base.metricTables,
          points5m: 'otel_metrics_points_5m',
        },
        granularity: '15 minute',
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.cpu',
            metricType: MetricsDataType.Gauge,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    const rendered = parameterizedQueryToSql(sql);
    expect(rendered).toContain('otel_metrics_points_5m');
    console.log('=== GAUGE AVG (5M ROLLUP) ===\n', rendered);
  });

  it('exp histogram quantile routed to 5m rollup tier (long window, no cap)', async () => {
    (mockMetadata.getMetricTemporality as jest.Mock).mockResolvedValue(
      'cumulative',
    );
    const sql = await renderChartConfig(
      {
        ...base, // 24h window — no guard throw once tiers are configured
        metricTables: {
          ...base.metricTables,
          expHistogramPoints: 'otel_metrics_exp_histogram_points',
          expHistogramPoints5m: 'otel_metrics_exp_histogram_points_5m',
        },
        granularity: '30 minute',
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.exp.duration',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
      } as ChartConfigWithOptDateRange,
      mockMetadata,
      undefined,
    );
    const rendered = parameterizedQueryToSql(sql);
    expect(rendered).toContain('otel_metrics_exp_histogram_points_5m');
    expect(rendered).toContain('GROUP BY SeriesHash, TimeBucket, Scale'); // sharp edge #1
    expect(rendered).not.toContain('bitAnd(Flags, 1)'); // tiers are marker-free
    console.log('=== EXP QUANTILE (5M ROLLUP) ===\n', rendered);
  });

  // ---- round 2 ----

  const sumCfg = (over?: Record<string, unknown>) =>
    ({
      ...base,
      select: [
        {
          aggFn: 'sum',
          aggCondition: '',
          valueExpression: 'Value',
          metricName: 'test.requests',
          metricType: MetricsDataType.Sum,
        },
      ],
      ...over,
    }) as ChartConfigWithOptDateRange;

  it('rate lookback: raw cumulative scans look back max(2×scrape interval, 1 bucket); delta keeps ±1-bucket parity', async () => {
    // unknown temporality + known 60s interval → 120s lookback
    (
      mockMetadata.getMetricScrapeIntervalEstimate as jest.Mock
    ).mockResolvedValue(60);
    let rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).toContain('- INTERVAL 120 second');
    // the series Date bound derives from the padded scan start
    expect(rendered).toMatch(/Date >= toDate\(.*- INTERVAL 120 second/);

    // unknown interval → flat 5-minute Prometheus default
    (
      mockMetadata.getMetricScrapeIntervalEstimate as jest.Mock
    ).mockResolvedValue(undefined);
    rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).toContain('- INTERVAL 300 second');

    // delta-resolved: no previous sample needed → v1 ±1-bucket parity
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'delta',
      otherMetricTypes: [],
    });
    rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).not.toContain('second');
    expect(rendered).toContain('- INTERVAL 1 minute');
  });

  it('rollup chaining lookback: one TIER bucket, not one display bucket', async () => {
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: true,
      otherMetricTypes: [],
    });
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          metricTables: { ...base.metricTables, points1h: 'points_1h' },
          granularity: '1 day',
          dateRange: [
            new Date('2025-02-06T00:00:00Z'),
            new Date('2025-02-13T00:00:00Z'),
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(rendered).toContain('points_1h');
    // lookback = 3600s (one 1h tier bucket), NOT 1 day
    expect(rendered).toContain('- INTERVAL 3600 second');
    // upper bound keeps the +1-display-bucket ceiling (feeds the final bucket)
    expect(rendered).toContain('+ INTERVAL 1 day');
  });

  it('dead temporality branch dropped when the profile resolves (join kept)', async () => {
    // cumulative+monotonic: no delta running-sum window, static Rate pick
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: true,
      otherMetricTypes: [],
    });
    let rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).not.toContain('SumIfDelta');
    expect(rendered).not.toContain('RateIfCumulativeNonMonotonic');
    expect(rendered).not.toContain('multiIf(\n          s.Temporality');
    expect(rendered).toContain('lagInFrame'); // cumulative chain stays
    expect(rendered).toContain('INNER JOIN Series'); // filters present → join kept

    // delta: no lag window at all
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'delta',
      otherMetricTypes: [],
    });
    rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).not.toContain('lagInFrame');
    expect(rendered).not.toContain('RateIfCumulative');
    expect(rendered).toContain('INNER JOIN Series');
    // narrow resolution: the static branch never reads s.Temporality
    expect(rendered).not.toContain('Temporality');

    // unresolved: dual shape with the joined multiIf pick survives
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({});
    rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).toContain('SumIfDelta');
    expect(rendered).toContain('lagInFrame');
    expect(rendered).toContain("s.Temporality = 'delta'");
  });

  it('no no-op ORDER BY inside the Bucketed CTE', async () => {
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).not.toMatch(/ORDER BY AttributesHash/);
  });

  const summaryQuantileCfg = (windowHours: number) =>
    ({
      ...base,
      metricTables: {
        ...base.metricTables,
        summaryPoints: 'otel_metrics_summary_points',
      },
      // ≥5m buckets so the (orthogonal) sub-5m whale guard stays out of the
      // way — these tests exercise the summary COST gate.
      granularity: '10 minute',
      dateRange: [
        new Date('2025-02-12T00:00:00Z'),
        new Date(
          new Date('2025-02-12T00:00:00Z').getTime() + windowHours * 3600_000,
        ),
      ],
      select: [
        {
          aggFn: 'quantile',
          level: 0.99,
          aggCondition: '',
          valueExpression: 'Value',
          metricName: 'test.summary',
          metricType: MetricsDataType.Summary,
        },
      ],
    }) as ChartConfigWithOptDateRange;

  it('summary quantile cost gate: cheap 6h scans render, whale scans refuse, unknown estimate falls back to the flat cap', async () => {
    // 10k series × 6h ÷ 30s ≈ 7.2M rows — trivially allowed
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      10_000,
    );
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(summaryQuantileCfg(6), mockMetadata, undefined),
    );
    expect(rendered).toContain('SummPerSeries');

    // 5M series × 6h ÷ 30s ≈ 3.6B rows — over the 300M gate
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      5_000_000,
    );
    await expect(
      renderChartConfig(summaryQuantileCfg(6), mockMetadata, undefined),
    ).rejects.toThrow('summary quantile scan too large');

    // estimate unavailable → previous flat-cap behavior (fail closed)
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      undefined,
    );
    await expect(
      renderChartConfig(summaryQuantileCfg(6), mockMetadata, undefined),
    ).rejects.toThrow('window too large for this metric type');

    // ≤3h windows never consult the estimates (previous always-allowed zone)
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockClear();
    await renderChartConfig(summaryQuantileCfg(2), mockMetadata, undefined);
  });

  it('summary count panels are never gated on quantile semantics', async () => {
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      5_000_000,
    );
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(
        {
          ...summaryQuantileCfg(24),
          select: [
            {
              aggFn: 'count',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.summary',
              metricType: MetricsDataType.Summary,
            },
          ],
        } as ChartConfigWithOptDateRange,
        mockMetadata,
        undefined,
      ),
    );
    expect(rendered).toContain('CountPerSeries');
  });

  it('parallel replicas: gate is disabled — no override emitted, no gate estimate issued, even for whale scans', async () => {
    // PARALLEL_REPLICAS_GATE_ENABLED = false: treated as a server-level
    // setting for now. Even a big scan (850k series × 24h ÷ 300s tier ≈
    // 245M rows) with a writable setting must not emit the override.
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockResolvedValue(
      850_000,
    );
    (mockMetadata.isSettingChangeable as jest.Mock).mockResolvedValue(true);
    const bigCfg = sumCfg({
      metricTables: { ...base.metricTables, points5m: 'points_5m' },
      granularity: '5 minute',
    });
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockClear();
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(bigCfg, mockMetadata, undefined),
    );
    expect(rendered).not.toContain('enable_parallel_replicas');
    expect(mockMetadata.isSettingChangeable).not.toHaveBeenCalled();
    // the whale/summary guards don't apply here, so the disabled gate means
    // zero cost-estimate queries for this panel
    expect(mockMetadata.getMetricSeriesCountEstimate).not.toHaveBeenCalled();
  });

  it('counter Rate is per-second (display-bucket divisor) on raw and rollup paths; Increase stays per-interval', async () => {
    // raw path, 1-minute display buckets → divide by 60
    let rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    expect(rendered).toContain('Increase / 60 AS Rate');
    // rollup path with 1-DAY display buckets on the 1h tier → divide by the
    // DISPLAY width (86400), never the tier width (3600)
    rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          metricTables: { ...base.metricTables, points1h: 'points_1h' },
          granularity: '1 day',
          dateRange: [
            new Date('2025-02-06T00:00:00Z'),
            new Date('2025-02-13T00:00:00Z'),
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(rendered).toContain('Increase / 86400 AS Rate');
    // aggFn 'increase' keeps the per-interval quantity
    rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          select: [
            {
              aggFn: 'increase',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.requests',
              metricType: MetricsDataType.Sum,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(rendered).toMatch(/sum\(\s*Increase\s*\)/);
    // template mode late-binds the divisor to the dashboard interval
    rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          isRenderingRawSqlTemplate: true,
          dateRange: [new Date(0), new Date(0)],
          granularity: 'auto',
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(rendered).toContain('Increase / $__interval_s AS Rate');
  });

  it('UpDownCounters (IsMonotonic=false) read the LEVEL, not the per-second diff', async () => {
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: false,
      otherMetricTypes: [],
    });
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'system.memory.usage',
              metricType: MetricsDataType.Sum,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    // avg of per-series LEVELS (Bucketed.Sum = newest sample), never the diff
    expect(rendered).toMatch(/avg\(\s*Sum\s*\)/);
    expect(rendered).not.toMatch(/avg\(\s*Rate\s*\)/);

    // monotonic counters keep the per-second Rate
    (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
      temporality: 'cumulative',
      isMonotonic: true,
      otherMetricTypes: [],
    });
    const counter = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'system.network.io',
              metricType: MetricsDataType.Sum,
            },
          ],
        }),
        mockMetadata,
        undefined,
      ),
    );
    expect(counter).toMatch(/avg\(\s*Rate\s*\)/);
  });

  it('number/table tiles (no granularity): divisor matches the auto bucket and tiers still route', async () => {
    // 24h window, granularity undefined (number tile): the CTE buckets at
    // the auto width, so the Rate divisor must match it (previously fell
    // back to 1 → per-hour values labeled per-second) and the tier routing
    // must see the same interval (previously always raw).
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          granularity: undefined,
          metricTables: { ...base.metricTables, points5m: 'points_5m' },
        }),
        mockMetadata,
        undefined,
      ),
    );
    // 24h ÷ 60 buckets → 30 minute auto buckets (30m rung skipped → 1 hour)
    expect(rendered).toContain('Increase / 3600 AS Rate');
    expect(rendered).toContain('INTERVAL 1 hour');
    expect(rendered).toContain('points_5m'); // ≥5m buckets route to the tier
  });

  it('raw sql template mode: late-bound $__timeInterval bucket, no estimate queries, no baked lookback macros executed', async () => {
    (mockMetadata.getMetricSeriesCountEstimate as jest.Mock).mockClear();
    const rendered = parameterizedQueryToSql(
      await renderChartConfig(
        sumCfg({
          isRenderingRawSqlTemplate: true,
          dateRange: [new Date(0), new Date(0)],
          granularity: 'auto',
        }),
        mockMetadata,
        undefined,
      ),
    );
    // the bucket must late-bind to the dashboard interval, not bake the
    // sentinel-range 'auto' resolution
    expect(rendered).toContain('$__timeInterval');
    expect(rendered).not.toMatch(
      /toStartOfInterval\(toDateTime\(TimeUnix\), INTERVAL 15 second\)/,
    );
    // the estimate helpers must never execute $__ macro SQL
    expect(mockMetadata.getMetricSeriesCountEstimate).not.toHaveBeenCalled();
    expect(rendered).not.toContain('enable_parallel_replicas');
  });
});
