import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  granularitySecondsToSQLInterval,
  metricMinDisplayBucketSeconds,
  snapDisplayGranularity,
} from '@/core/utils';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

describe('metrics v2 render', () => {
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
    // canonical first-sample rule: a series' first scanned sample emits an
    // EMPTY map/0 (its cumulative history is not an increase); only a
    // genuine reset (count decrease) credits the full current value. The
    // old merged branch injected a newly-born series' entire history into
    // one bucket.
    expect(cum).toContain("CAST(map(), 'Map(Int64, Int64)')");
    expect(cum).not.toContain('prev_total IS NULL OR');
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
    ).mockResolvedValue({
      intervalSeconds: 60,
      maxIntervalSeconds: 60,
      uncertain: false,
    });
    let rendered = parameterizedQueryToSql(
      await renderChartConfig(sumCfg(), mockMetadata, undefined),
    );
    // ceil(2×60)+1: the +1 jitter margin keeps a baseline sample at
    // start−120.3s (missed scrape + timestamp jitter) inside the scan —
    // a bare 120 has zero margin at the two-interval boundary (V1 parity
    // §2's "121s-class")
    expect(rendered).toContain('- INTERVAL 121 second');
    // the series Date bound derives from the padded scan start
    expect(rendered).toMatch(/Date >= toDate\(.*- INTERVAL 121 second/);

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

  describe('display-granularity snapping', () => {
    // 15m window → auto ladder floors at 1 minute
    const fifteenMin: { dateRange: [Date, Date] } = {
      dateRange: [
        new Date('2025-02-12T00:00:00Z'),
        new Date('2025-02-12T00:15:00Z'),
      ],
    };
    const setEstimate = (e: unknown) =>
      (
        mockMetadata.getMetricScrapeIntervalEstimate as jest.Mock
      ).mockResolvedValue(e);

    it('auto never goes below 1-minute buckets (static floor; divisor and lookback follow)', async () => {
      setEstimate({
        intervalSeconds: 60,
        maxIntervalSeconds: 60,
        uncertain: false,
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
          sumCfg({ ...fifteenMin, granularity: undefined }),
          mockMetadata,
          undefined,
        ),
      );
      expect(rendered).toContain('INTERVAL 1 minute');
      expect(rendered).not.toContain('INTERVAL 30 second');
      // per-second rate divisor tracks the display bucket
      expect(rendered).toContain('Increase / 60 AS Rate');
    });

    it('explicit granularity is never rewritten (forced sub-minute renders as asked)', async () => {
      setEstimate({
        intervalSeconds: 60,
        maxIntervalSeconds: 60,
        uncertain: false,
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
          sumCfg({ ...fifteenMin, granularity: '30 second' }),
          mockMetadata,
          undefined,
        ),
      );
      expect(rendered).toContain('INTERVAL 30 second');
      expect(rendered).not.toContain('INTERVAL 1 minute');
    });

    it('estimate-driven snap is DISABLED: a >60s-scraped metric keeps the plain ladder (no tier promotion)', async () => {
      // 1h window → ladder picks 1 minute; with the snap flag ON a
      // 5m-scraped metric would snap to 5-minute buckets and the 5m tier
      // (see SCRAPE_INTERVAL_GRANULARITY_SNAP_ENABLED)
      setEstimate({
        intervalSeconds: 300,
        maxIntervalSeconds: 300,
        uncertain: false,
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
          sumCfg({
            metricTables: { ...base.metricTables, points5m: 'points_5m' },
            granularity: undefined,
            dateRange: [
              new Date('2025-02-12T00:00:00Z'),
              new Date('2025-02-12T01:00:00Z'),
            ],
          }),
          mockMetadata,
          undefined,
        ),
      );
      expect(rendered).not.toContain('points_5m');
      expect(rendered).toContain('INTERVAL 1 minute');
      expect(rendered).toContain('Increase / 60 AS Rate');
    });

    it('metricMinDisplayBucketSeconds: clean-multiple round-up, 2× when uncertain, max spacing wins, 10m clamp', () => {
      const est = (
        intervalSeconds: number,
        maxIntervalSeconds = intervalSeconds,
        uncertain = false,
      ) => ({ intervalSeconds, maxIntervalSeconds, uncertain });
      expect(metricMinDisplayBucketSeconds(undefined)).toBeUndefined();
      expect(metricMinDisplayBucketSeconds(est(0))).toBeUndefined(); // tier-only sentinel
      expect(metricMinDisplayBucketSeconds(est(10))).toBe(10);
      expect(metricMinDisplayBucketSeconds(est(60))).toBe(60);
      // jitter tolerance: 59.4s ≈ 60s is a clean multiple of 1 minute
      expect(metricMinDisplayBucketSeconds(est(59.4))).toBe(60);
      // measured live: a clean 60s scrape reports max spacing 60.012s —
      // the epsilon must not skip the 60s step (snapped to 2m pre-fix)
      expect(metricMinDisplayBucketSeconds(est(59.9996, 60.0124))).toBe(60);
      // uncertain → 2× rule
      expect(metricMinDisplayBucketSeconds(est(60, 70, true))).toBe(120);
      // mixed-interval series: max observed spacing wins over 2×median
      expect(metricMinDisplayBucketSeconds(est(10, 300, true))).toBe(300);
      // no clean multiple exists (45s): smallest step ≥ target still clears
      // the bucket<interval hazard
      expect(metricMinDisplayBucketSeconds(est(45))).toBe(60);
      // outlier spacing clamps at 10 minutes — snapping chases scrape rates,
      // not gaps
      expect(metricMinDisplayBucketSeconds(est(30, 7200, true))).toBe(600);
    });

    it('explicit-hist raw cumulative quantile: first sample emits zeros, reset keeps full counts', async () => {
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        otherMetricTypes: [],
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
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
          } as ChartConfigWithOptDateRange,
          mockMetadata,
          undefined,
        ),
      );
      expect(rendered).toContain('arrayMap(x -> toInt64(0), counts)');
      // the split branch: first-sample is its own arm, no longer OR-merged
      // with the reset condition
      expect(rendered).toMatch(/length\(prev_counts\) = 0,/);
    });

    it('unsupported aggregates throw typed errors (the editor gates these lists — a stale selection must never reach the translator)', async () => {
      const cfgFor = (
        metricType: MetricsDataType,
        aggFn: string,
        tables: Record<string, string>,
      ) =>
        ({
          ...base,
          metricTables: { ...base.metricTables, ...tables },
          select: [
            {
              aggFn,
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.metric',
              metricType,
            },
          ],
        }) as ChartConfigWithOptDateRange;
      await expect(
        renderChartConfig(
          cfgFor(MetricsDataType.ExponentialHistogram, 'min', {
            expHistogramPoints: 'otel_metrics_exp_histogram_points',
          }),
          mockMetadata,
          undefined,
        ),
      ).rejects.toThrow('min is not supported for exponential histograms');
      await expect(
        renderChartConfig(
          cfgFor(MetricsDataType.Summary, 'avg', {
            summaryPoints: 'otel_metrics_summary_points',
          }),
          mockMetadata,
          undefined,
        ),
      ).rejects.toThrow('avg is not supported for summaries');
      await expect(
        renderChartConfig(
          cfgFor(MetricsDataType.Histogram, 'sum', {}),
          mockMetadata,
          undefined,
        ),
      ).rejects.toThrow('sum is not supported for histograms');
    });

    it('snapDisplayGranularity + granularitySecondsToSQLInterval', () => {
      const e60 = {
        intervalSeconds: 60,
        maxIntervalSeconds: 60,
        uncertain: false,
      };
      expect(snapDisplayGranularity('30 second', e60)).toBe('1 minute');
      expect(snapDisplayGranularity('5 minute', e60)).toBe('5 minute');
      expect(snapDisplayGranularity('30 second', undefined)).toBe('30 second');
      expect(granularitySecondsToSQLInterval(30)).toBe('30 second');
      expect(granularitySecondsToSQLInterval(120)).toBe('2 minute');
      expect(granularitySecondsToSQLInterval(600)).toBe('10 minute');
    });
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

  describe('parity-harness query-recipe fixes', () => {
    it('raw delta reads dedup same-(SeriesHash, TimeUnix) transport retries', async () => {
      // Scalar sum: per-ts max(Value), summed per bucket — never sum(Value),
      // which double-counts a re-delivered OTLP export (+25% measured).
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'delta',
        otherMetricTypes: [],
      });
      const sum = parameterizedQueryToSql(
        await renderChartConfig(sumCfg(), mockMetadata, undefined),
      );
      expect(sum).toContain('max(Value) AS ValueMax');
      expect(sum).toContain('sum(ValueMax) AS RateIfDelta');
      expect(sum).not.toContain('ValueSum');

      // Histogram quantile: per-ts argMax pick, not an additive sumForEach.
      const hist = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...base,
            ...quantileWindow,
            select: [
              {
                aggFn: 'quantile',
                level: 0.5,
                aggCondition: '',
                valueExpression: 'Value',
                metricName: 'test.duration',
                metricType: MetricsDataType.Histogram,
              },
            ],
          } as ChartConfigWithOptDateRange,
          mockMetadata,
          undefined,
        ),
      );
      expect(hist).toContain('argMax(BucketCounts, Count)');
      expect(hist).not.toContain('sumForEach(BucketCounts)');
    });

    it('tier chained-increase recovers mid-bucket resets via the stored Max', async () => {
      const cfg = () =>
        sumCfg({
          metricTables: { ...base.metricTables, points1h: 'points_1h' },
          granularity: '1 day',
          dateRange: [
            new Date('2025-02-06T00:00:00Z'),
            new Date('2025-02-13T00:00:00Z'),
          ],
        });
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        isMonotonic: true,
        otherMetricTypes: [],
      });
      const cum = parameterizedQueryToSql(
        await renderChartConfig(cfg(), mockMetadata, undefined),
      );
      expect(cum).toContain('max(Max) AS MaxV');
      // within-bucket reset: credit the pre-reset climb (Max-F) plus the
      // post-reset accumulation (L); detection keys on Max, not L < F
      expect(cum).toContain('IF(L >= MaxV, L - F, (MaxV - F) + L)');

      // delta tier reads are plain Sum-state sums — no Max chain
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'delta',
        otherMetricTypes: [],
      });
      const delta = parameterizedQueryToSql(
        await renderChartConfig(cfg(), mockMetadata, undefined),
      );
      expect(delta).not.toContain('MaxV');
    });

    it('exp raw cumulative diff rescales across a scale renegotiation', async () => {
      const cfg = () => ({
        ...base,
        ...quantileWindow,
        metricTables: {
          ...base.metricTables,
          expHistogramPoints: 'otel_metrics_exp_histogram_points',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.99,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.exp.duration',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
      });
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        otherMetricTypes: [],
      });
      const cum = parameterizedQueryToSql(
        await renderChartConfig(
          cfg() as ChartConfigWithOptDateRange,
          mockMetadata,
          undefined,
        ),
      );
      // both maps downscale to the pair's min scale before mapSubtract
      // (an SDK re-bucket preserves Count, so the reset branch cannot fire)
      expect(cum).toContain('least(Scale, prev_scale)');
      expect(cum).toContain('arrayReduce(');
      // diffs are keyed per eff_scale so maps are summed within ONE scale
      expect(cum).toContain(
        'GROUP BY SeriesHash, `__hdx_time_bucket`, eff_scale',
      );
      expect(cum).not.toContain('min(Scale) AS scale');

      // delta: per-ts retry dedup + per-scale grouping (mirrors the tier R1)
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'delta',
        otherMetricTypes: [],
      });
      const delta = parameterizedQueryToSql(
        await renderChartConfig(
          cfg() as ChartConfigWithOptDateRange,
          mockMetadata,
          undefined,
        ),
      );
      expect(delta).toContain('GROUP BY SeriesHash, TimeUnix');
      expect(delta).toContain(
        'GROUP BY SeriesHash, `__hdx_time_bucket`, Scale',
      );
      expect(delta).not.toContain('min(Scale) AS scale');
    });
  });

  describe('round-2 recipe fixes', () => {
    const expQuantileCfg = (temporality: 'delta' | 'cumulative') => {
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
            level: 0.5,
            aggCondition: '',
            valueExpression: 'Value',
            metricName: 'test.exp.duration',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
      } as ChartConfigWithOptDateRange;
    };

    it('exp quantiles walk the full signed distribution (negative buckets)', async () => {
      const cum = parameterizedQueryToSql(
        await renderChartConfig(
          expQuantileCfg('cumulative'),
          mockMetadata,
          undefined,
        ),
      );
      expect(cum).toContain('NegativeBucketCounts, NegativeOffset');
      expect(cum).toContain('neg_if_cum');
      expect(cum).toContain('chosenNegMap');
      // ascending-VALUE order over negative indices = descending index order
      expect(cum).toContain('arrayReverse(mergedNeg.1) AS nks');
      // rank inside the zero bucket resolves to 0
      expect(cum).toContain('rank <= negTotal + zeroTotal, 0.');
      // negative-side interpolation: the positive rule with negated bounds
      expect(cum).toContain(
        '-pow(base, nks[nidx] + 1) + (pow(base, nks[nidx] + 1) - pow(base, nks[nidx]))',
      );

      const delta = parameterizedQueryToSql(
        await renderChartConfig(
          expQuantileCfg('delta'),
          mockMetadata,
          undefined,
        ),
      );
      expect(delta).toContain('NegativeBucketCounts, NegativeOffset');
      expect(delta).toContain('chosenNegMap');
    });

    it('exp rollup quantiles carry the negative tier states', async () => {
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        otherMetricTypes: [],
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...base, // 24h window
            metricTables: {
              ...base.metricTables,
              expHistogramPoints: 'otel_metrics_exp_histogram_points',
              expHistogramPoints5m: 'otel_metrics_exp_histogram_points_5m',
              expHistogramPoints1h: 'otel_metrics_exp_histogram_points_1h',
            },
            granularity: '1 hour',
            select: [
              {
                aggFn: 'quantile',
                level: 0.9,
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
      );
      expect(rendered).toContain('otel_metrics_exp_histogram_points_1h');
      expect(rendered).toContain('sumMap(SumNegative)');
      expect(rendered).toContain("tupleElement(f, 'NegativeBuckets') AS fNeg");
      expect(rendered).toContain('neg_inc_cum');
    });

    it('histogram min/max read the stored extremes on raw and tier paths', async () => {
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        otherMetricTypes: [],
      });
      const histCfg = (aggFn: 'min' | 'max', over?: Record<string, unknown>) =>
        ({
          ...base,
          select: [
            {
              aggFn,
              aggCondition: '',
              valueExpression: 'Value',
              metricName: 'test.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          ...over,
        }) as ChartConfigWithOptDateRange;

      const raw = parameterizedQueryToSql(
        await renderChartConfig(histCfg('max'), mockMetadata, undefined),
      );
      expect(raw).toContain('max(Max) AS extreme');
      expect(raw).toContain('max(p.extreme)');
      // Rule 6: a marker row's zero extremes would poison min()/pin max()
      expect(raw).toContain('bitAnd(Flags, 1) = 0');
      // extremes are restart-insensitive: no reset chain, no window
      expect(raw).not.toContain('lagInFrame');

      const tier = parameterizedQueryToSql(
        await renderChartConfig(
          histCfg('min', {
            metricTables: {
              ...base.metricTables,
              histogramPoints5m: 'otel_metrics_histogram_points_5m',
            },
            granularity: '5 minute',
          }),
          mockMetadata,
          undefined,
        ),
      );
      expect(tier).toContain('otel_metrics_histogram_points_5m');
      expect(tier).toContain('min(Min) AS extreme');
      expect(tier).not.toContain('bitAnd(Flags, 1)'); // tiers are marker-free
    });

    it('exp avg renders the scalar Sum/Count recipe and never routes to tiers', async () => {
      (mockMetadata.getMetricSeriesProfile as jest.Mock).mockResolvedValue({
        temporality: 'cumulative',
        otherMetricTypes: [],
      });
      const rendered = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...base, // 24h window; 1h buckets would tier-route a quantile
            granularity: '1 hour',
            metricTables: {
              ...base.metricTables,
              expHistogramPoints: 'otel_metrics_exp_histogram_points',
              expHistogramPoints5m: 'otel_metrics_exp_histogram_points_5m',
              expHistogramPoints1h: 'otel_metrics_exp_histogram_points_1h',
            },
            select: [
              {
                aggFn: 'avg',
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
      );
      expect(rendered).toContain('otel_metrics_exp_histogram_points');
      expect(rendered).not.toContain('_5m');
      expect(rendered).not.toContain('_1h');
      expect(rendered).toContain('sum_inc_cum'); // Sum/Count increase ratio
    });
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
