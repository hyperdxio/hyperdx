import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

// A point with OTLP FLAG_NO_RECORDED_VALUE (Flags bit 0) carries no value. The
// collector's prometheus receiver sends one as a staleness marker when a series
// goes away or a scrape fails, and the ClickHouse exporter stores it as zeros.
describe('metric points with no recorded value (integration)', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const GAUGE_TABLE = 'no_recorded_value_gauge_int_test';
  const SUM_TABLE = 'no_recorded_value_sum_int_test';
  const HIST_TABLE = 'no_recorded_value_histogram_int_test';
  const EXP_HIST_TABLE = 'no_recorded_value_exp_histogram_int_test';

  const NO_RECORDED_VALUE = 1;

  // Inserts are server-local strings; the CI ClickHouse runs in UTC.
  const insertTs = (minute: number) => `2025-04-15 10:0${minute}:00`;
  const bucket = (minute: number) => `2025-04-15T10:0${minute}:00Z`;

  // Columns of docker/otel-collector/schema/seed/00003_otel_metrics.sql that
  // every metric table shares.
  const COMMON_COLUMNS = `
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Flags UInt32`;
  const ENGINE = `ENGINE = MergeTree PARTITION BY toDate(TimeUnix)
    ORDER BY (ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`;

  const commonFields = (
    metricName: string,
    minute: number,
    service: string,
    flags = 0,
  ) => ({
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
    StartTimeUnix: insertTs(0),
    TimeUnix: insertTs(minute),
    Flags: flags,
  });

  const metricTables = {
    gauge: GAUGE_TABLE,
    sum: SUM_TABLE,
    histogram: HIST_TABLE,
    summary: 'unused',
    'exponential histogram': EXP_HIST_TABLE,
  };

  const runConfig = async (
    metricType: MetricsDataType,
    metricName: string,
    select: { aggFn: string; level?: number },
  ) => {
    const result = await hdxClient.queryChartConfig({
      config: {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables,
        from: { databaseName: DATABASE, tableName: '' },
        select: [
          {
            ...select,
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            alias: 'Value',
            metricName,
            metricType,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-04-14'), new Date('2025-04-16')],
        granularity: '1 minute',
      } as ChartConfigWithOptDateRange,
      metadata,
      querySettings: undefined,
    });
    return new Map(
      (result.data as Array<{ __hdx_time_bucket: string; Value: unknown }>).map(
        row => [row.__hdx_time_bucket, Number(row.Value)],
      ),
    );
  };

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${GAUGE_TABLE} (
        ${COMMON_COLUMNS},
        Value Float64
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${SUM_TABLE} (
        ${COMMON_COLUMNS},
        Value Float64,
        AggregationTemporality Int32,
        IsMonotonic Bool
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${HIST_TABLE} (
        ${COMMON_COLUMNS},
        Count UInt64,
        Sum Float64,
        BucketCounts Array(UInt64),
        ExplicitBounds Array(Float64),
        Min Float64,
        Max Float64,
        AggregationTemporality Int32
      ) ${ENGINE}`,
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${EXP_HIST_TABLE} (
        ${COMMON_COLUMNS},
        Count UInt64,
        Sum Float64,
        Scale Int32,
        ZeroCount UInt64,
        PositiveOffset Int32,
        PositiveBucketCounts Array(UInt64),
        NegativeOffset Int32,
        NegativeBucketCounts Array(UInt64),
        Min Float64,
        Max Float64,
        AggregationTemporality Int32
      ) ${ENGINE}`,
    });

    // Two series report 10 every minute; svc-b goes away after minute 4 and
    // leaves a marker at minute 5.
    const gaugeRow = (
      minute: number,
      service: string,
      value = 10,
      flags = 0,
    ) => ({
      ...commonFields('gauge.cpu', minute, service, flags),
      Value: value,
    });
    await client.insert({
      table: `${DATABASE}.${GAUGE_TABLE}`,
      values: [
        ...[0, 1, 2, 3, 4, 5].map(m => gaugeRow(m, 'svc-a')),
        ...[0, 1, 2, 3, 4].map(m => gaugeRow(m, 'svc-b')),
        gaugeRow(5, 'svc-b', 0, NO_RECORDED_VALUE),
      ],
      format: 'JSONEachRow',
    });

    const sumRow =
      (metricName: string) =>
      (minute: number, value: number, flags = 0) => ({
        ...commonFields(metricName, minute, 'svc-a', flags),
        Value: value,
        AggregationTemporality: 2,
        IsMonotonic: true,
      });
    // A cumulative counter that goes up by 10 a minute. One scrape fails at
    // minute 3, then the same series comes back.
    const requests = sumRow('sum.requests');
    // A counter that restarts behind a marker, and the same restart without
    // one.
    const restart = sumRow('sum.restart');
    const restartControl = sumRow('sum.restart.control');
    await client.insert({
      table: `${DATABASE}.${SUM_TABLE}`,
      values: [
        requests(0, 100),
        requests(1, 110),
        requests(2, 120),
        requests(3, 0, NO_RECORDED_VALUE),
        requests(4, 130),
        restart(0, 100),
        restart(1, 120),
        restart(2, 0, NO_RECORDED_VALUE),
        restart(3, 5),
        restartControl(0, 100),
        restartControl(1, 120),
        restartControl(3, 5),
      ],
      format: 'JSONEachRow',
    });

    // Cumulative histogram: 10 observations in (0, 10] by minute 1, a marker
    // at minute 2, then 5 new observations in (10, 30] by minute 3.
    const histRow = (minute: number, bucketCounts: number[], flags = 0) => ({
      ...commonFields('hist.latency', minute, 'svc-a', flags),
      Count: bucketCounts.reduce((a, b) => a + b, 0),
      Sum: 0,
      BucketCounts: bucketCounts,
      ExplicitBounds: [10, 30],
      Min: 0,
      Max: 0,
      AggregationTemporality: 2,
    });
    await client.insert({
      table: `${DATABASE}.${HIST_TABLE}`,
      values: [
        histRow(0, [0, 0, 0]),
        histRow(1, [10, 0, 0]),
        histRow(2, [0, 0, 0], NO_RECORDED_VALUE),
        histRow(3, [10, 5, 0]),
      ],
      format: 'JSONEachRow',
    });

    // Cumulative native histogram at scale 3, where bucket 8 is (2, 2.18] and
    // bucket 16 is (4, 4.36]: 10 observations in bucket 8 by minute 1, a
    // marker at minute 2, then 5 new observations in bucket 16 by minute 3.
    // The receiver writes a stale point with scale 0 and no buckets.
    const expHistRow = (minute: number, buckets: number[], flags = 0) => ({
      ...commonFields('exphist.latency', minute, 'svc-a', flags),
      Count: buckets.reduce((a, b) => a + b, 0),
      Sum: 0,
      Scale: flags ? 0 : 3,
      ZeroCount: 0,
      PositiveOffset: flags ? 0 : 8,
      PositiveBucketCounts: buckets,
      NegativeOffset: 0,
      NegativeBucketCounts: [],
      Min: 0,
      Max: 0,
      AggregationTemporality: 2,
    });
    await client.insert({
      table: `${DATABASE}.${EXP_HIST_TABLE}`,
      values: [
        expHistRow(0, []),
        expHistRow(1, [10]),
        expHistRow(2, [], NO_RECORDED_VALUE),
        expHistRow(3, [10, 0, 0, 0, 0, 0, 0, 0, 5]),
      ],
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    for (const table of [GAUGE_TABLE, SUM_TABLE, HIST_TABLE, EXP_HIST_TABLE]) {
      await client.command({
        query: `DROP TABLE IF EXISTS ${DATABASE}.${table}`,
      });
    }
    await hdxClient.close();
    await client.close();
  });

  it.each([
    ['min', 10],
    ['avg', 10],
    ['count', 1],
  ])('leaves a gauge marker out of %s', async (aggFn, expected) => {
    const values = await runConfig(MetricsDataType.Gauge, 'gauge.cpu', {
      aggFn,
    });
    expect(values.get(bucket(5))).toBe(expected);
  });

  it('keeps the gauge minute before the marker unchanged', async () => {
    const counts = await runConfig(MetricsDataType.Gauge, 'gauge.cpu', {
      aggFn: 'count',
    });
    expect(counts.get(bucket(4))).toBe(2);
  });

  it('does not count a counter from zero after a marker', async () => {
    const values = await runConfig(MetricsDataType.Sum, 'sum.requests', {
      aggFn: 'increase',
    });
    expect(values.get(bucket(4))).toBe(10);
    expect([...values.values()].reduce((a, b) => a + b, 0)).toBe(30);
  });

  // The Sum query clamps a counter decrease to 0, so the restart minute reads
  // 0 with and without the marker.
  it('treats a counter restart behind a marker like any other counter reset', async () => {
    const select = { aggFn: 'increase' };
    expect(await runConfig(MetricsDataType.Sum, 'sum.restart', select)).toEqual(
      await runConfig(MetricsDataType.Sum, 'sum.restart.control', select),
    );
  });

  it('does not count a histogram from zero after a marker', async () => {
    const counts = await runConfig(MetricsDataType.Histogram, 'hist.latency', {
      aggFn: 'count',
    });
    expect(counts.get(bucket(1))).toBe(10);
    expect(counts.get(bucket(3))).toBe(5);
  });

  it('computes histogram quantiles from the observations after a marker only', async () => {
    const p50 = await runConfig(MetricsDataType.Histogram, 'hist.latency', {
      aggFn: 'quantile',
      level: 0.5,
    });
    expect(p50.get(bucket(3))).toBeGreaterThan(10);
    expect(p50.get(bucket(3))).toBeLessThanOrEqual(30);
  });

  it('does not count an exponential histogram from zero after a marker', async () => {
    const counts = await runConfig(
      MetricsDataType.ExponentialHistogram,
      'exphist.latency',
      { aggFn: 'count' },
    );
    expect(counts.get(bucket(1))).toBe(10);
    expect(counts.get(bucket(3))).toBe(5);
  });

  it('computes exponential histogram quantiles at the series scale from the observations after a marker only', async () => {
    const p50 = await runConfig(
      MetricsDataType.ExponentialHistogram,
      'exphist.latency',
      { aggFn: 'quantile', level: 0.5 },
    );
    expect(p50.get(bucket(3))).toBeGreaterThan(4);
    expect(p50.get(bucket(3))).toBeLessThanOrEqual(2 ** (17 / 8));
  });
});
