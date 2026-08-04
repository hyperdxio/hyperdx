import type { ClickHouseClient } from '@clickhouse/client';
import { createClient } from '@clickhouse/client';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
} from '@/types';

describe('ratioChartConfig Integration Tests', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;
  let metadata: Metadata;

  const DATABASE = 'default';
  const GAUGE_TABLE = 'otel_metrics_gauge_ratio_int_test';
  const SUM_TABLE = 'otel_metrics_sum_ratio_int_test';
  const HISTOGRAM_TABLE = 'otel_metrics_histogram_ratio_int_test';
  const EXP_HISTOGRAM_TABLE =
    'otel_metrics_exponential_histogram_ratio_int_test';

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';

    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });

    // 1. Gauge Table
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${GAUGE_TABLE} (
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        MetricName String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Value Float64 CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
    });

    // 2. Sum Table
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${SUM_TABLE} (
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        MetricName String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Value Float64 CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
    });

    // 3. Histogram Table
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${HISTOGRAM_TABLE} (
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        MetricName String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Count UInt64 CODEC(ZSTD(1)),
        Sum Float64 CODEC(ZSTD(1)),
        BucketCounts Array(UInt64) CODEC(ZSTD(1)),
        ExplicitBounds Array(Float64) CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
    });

    // 4. Exponential Histogram Table
    await client.command({
      query: `CREATE OR REPLACE TABLE ${DATABASE}.${EXP_HISTOGRAM_TABLE} (
        ServiceName LowCardinality(String) CODEC(ZSTD(1)),
        MetricName String CODEC(ZSTD(1)),
        Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
        Count UInt64 CODEC(ZSTD(1)),
        Sum Float64 CODEC(ZSTD(1)),
        Scale Int32 CODEC(ZSTD(1)),
        ZeroCount UInt64 CODEC(ZSTD(1)),
        PositiveOffset Int32 CODEC(ZSTD(1)),
        PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
        NegativeOffset Int32 CODEC(ZSTD(1)),
        NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1))
      ) ENGINE = MergeTree ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
    });

    // Seed Gauge Data
    // ratio = sum(metric.alpha) / sum(metric.beta)
    // svc-a: alpha=20, beta=10 -> ratio=2
    // svc-b: alpha=30, beta=60 -> ratio=0.5
    // svc-c: alpha=0, beta=10 -> ratio=0
    // svc-d: alpha=10, beta=0 -> ratio=null (or Infinity depending on handling)
    const ts = '2025-04-15 10:00:00';
    await client.insert({
      table: `${DATABASE}.${GAUGE_TABLE}`,
      values: [
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.alpha',
          Attributes: { env: 'prod', 'http.flavor': '1.1' },
          TimeUnix: ts,
          Value: 20,
        },
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.beta',
          Attributes: { env: 'prod', 'http.flavor': '1.1' },
          TimeUnix: ts,
          Value: 10,
        },
        {
          ServiceName: 'svc-b',
          MetricName: 'metric.alpha',
          Attributes: { env: 'dev', 'http.flavor': '2.0' },
          TimeUnix: ts,
          Value: 30,
        },
        {
          ServiceName: 'svc-b',
          MetricName: 'metric.beta',
          Attributes: { env: 'dev', 'http.flavor': '2.0' },
          TimeUnix: ts,
          Value: 60,
        },
        {
          ServiceName: 'svc-c',
          MetricName: 'metric.beta',
          Attributes: { env: 'prod' },
          TimeUnix: ts,
          Value: 10,
        },
        {
          ServiceName: 'svc-d',
          MetricName: 'metric.alpha',
          Attributes: { env: 'prod' },
          TimeUnix: ts,
          Value: 10,
        },
      ],
      format: 'JSONEachRow',
    });

    // Seed Sum Data (delta sums)
    // ratio = sum(metric.req_errors) / sum(metric.req_total)
    // svc-a: err=5, total=100 -> ratio=0.05
    await client.insert({
      table: `${DATABASE}.${SUM_TABLE}`,
      values: [
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.req_errors',
          Attributes: { env: 'prod' },
          TimeUnix: ts,
          Value: 5,
        },
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.req_total',
          Attributes: { env: 'prod' },
          TimeUnix: ts,
          Value: 100,
        },
      ],
      format: 'JSONEachRow',
    });

    // Seed Histogram Data
    // ratio = histogram_sum(metric.hist_alpha) / histogram_sum(metric.hist_beta)
    // svc-a: alpha sum=50, beta sum=100 -> ratio=0.5
    await client.insert({
      table: `${DATABASE}.${HISTOGRAM_TABLE}`,
      values: [
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.hist_alpha',
          Attributes: {},
          TimeUnix: ts,
          Count: 2,
          Sum: 50,
          BucketCounts: [1, 1],
          ExplicitBounds: [10],
        },
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.hist_beta',
          Attributes: {},
          TimeUnix: ts,
          Count: 4,
          Sum: 100,
          BucketCounts: [2, 2],
          ExplicitBounds: [10],
        },
      ],
      format: 'JSONEachRow',
    });

    // Seed Exponential Histogram Data
    // ratio = histogram_sum(metric.exp_alpha) / histogram_sum(metric.exp_beta)
    // svc-a: alpha sum=100, beta sum=25 -> ratio=4
    await client.insert({
      table: `${DATABASE}.${EXP_HISTOGRAM_TABLE}`,
      values: [
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.exp_alpha',
          Attributes: {},
          TimeUnix: ts,
          Count: 2,
          Sum: 100,
          Scale: 0,
          ZeroCount: 0,
          PositiveOffset: 0,
          PositiveBucketCounts: [2],
          NegativeOffset: 0,
          NegativeBucketCounts: [],
        },
        {
          ServiceName: 'svc-a',
          MetricName: 'metric.exp_beta',
          Attributes: {},
          TimeUnix: ts,
          Count: 1,
          Sum: 25,
          Scale: 0,
          ZeroCount: 0,
          PositiveOffset: 0,
          PositiveBucketCounts: [1],
          NegativeOffset: 0,
          NegativeBucketCounts: [],
        },
      ],
      format: 'JSONEachRow',
    });
  });

  beforeEach(() => {
    metadata = new Metadata(hdxClient, new MetadataCache());
  });

  afterAll(async () => {
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${GAUGE_TABLE}`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${SUM_TABLE}`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${HISTOGRAM_TABLE}`,
    });
    await client.command({
      query: `DROP TABLE IF EXISTS ${DATABASE}.${EXP_HISTOGRAM_TABLE}`,
    });
  });

  const getBaseConfig = (): ChartConfigWithOptDateRange => ({
    displayType: DisplayType.Line,
    connection: 'test-connection',
    from: { databaseName: DATABASE, tableName: '' },
    seriesReturnType: 'ratio',
    where: '',
    whereLanguage: 'sql',
    timestampValueExpression: 'TimeUnix',
    dateRange: [new Date('2025-04-14'), new Date('2025-04-16')],
    granularity: '1 minute',
    limit: { limit: 100 },
    select: [],
  });

  // GAUGE TESTS
  describe('Gauge', () => {
    it('computes ratio with no group-by', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: GAUGE_TABLE },
        metricTables: { [MetricsDataType.Gauge]: GAUGE_TABLE } as any,
        select: [
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.alpha',
            metricType: MetricsDataType.Gauge,
          },
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.beta',
            metricType: MetricsDataType.Gauge,
          },
        ],
        groupBy: undefined,
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];
      // total alpha = 20 + 30 + 0 + 10 = 60
      // total beta = 10 + 60 + 10 + 0 = 80
      // ratio = 60 / 80 = 0.75
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]['sum(metric.alpha)/sum(metric.beta)']).toBeCloseTo(0.75);
    });

    it('computes ratio grouped by column (ServiceName)', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: GAUGE_TABLE },
        metricTables: { [MetricsDataType.Gauge]: GAUGE_TABLE } as any,
        select: [
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.alpha',
            metricType: MetricsDataType.Gauge,
          },
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.beta',
            metricType: MetricsDataType.Gauge,
          },
        ],
        groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];

      const svcA = data.find(d => d.ServiceName === 'svc-a');
      const svcB = data.find(d => d.ServiceName === 'svc-b');
      const svcC = data.find(d => d.ServiceName === 'svc-c');

      expect(svcA['sum(metric.alpha)/sum(metric.beta)']).toBe(2); // 20 / 10
      expect(svcB['sum(metric.alpha)/sum(metric.beta)']).toBe(0.5); // 30 / 60
      expect(svcC['sum(metric.alpha)/sum(metric.beta)']).toBe(0); // 0 / 10
    });

    it('computes ratio grouped by Attributes map', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: GAUGE_TABLE },
        metricTables: { [MetricsDataType.Gauge]: GAUGE_TABLE } as any,
        select: [
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.alpha',
            metricType: MetricsDataType.Gauge,
          },
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.beta',
            metricType: MetricsDataType.Gauge,
          },
        ],
        groupBy: [
          { aggCondition: '', valueExpression: "Attributes['http.flavor']" },
        ],
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];

      const flavor1 = data.find(d => d["Attributes['http.flavor']"] === '1.1');
      const flavor2 = data.find(d => d["Attributes['http.flavor']"] === '2.0');

      expect(flavor1['sum(metric.alpha)/sum(metric.beta)']).toBe(2);
      expect(flavor2['sum(metric.alpha)/sum(metric.beta)']).toBe(0.5);
    });
  });

  // SUM TESTS
  describe('Sum', () => {
    it('computes ratio with multi-column group-by', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: SUM_TABLE },
        metricTables: { [MetricsDataType.Sum]: SUM_TABLE } as any,
        select: [
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.req_errors',
            metricType: MetricsDataType.Sum,
            isDelta: true,
          },
          {
            aggFn: 'sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.req_total',
            metricType: MetricsDataType.Sum,
            isDelta: true,
          },
        ],
        groupBy: [
          { aggCondition: '', valueExpression: 'ServiceName' },
          { aggCondition: '', valueExpression: "Attributes['env']" },
        ],
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];

      const svcA = data.find(
        d => d.ServiceName === 'svc-a' && d["Attributes['env']"] === 'prod',
      );
      expect(
        svcA['sum(delta(metric.req_errors))/sum(delta(metric.req_total))'],
      ).toBe(0.05);
    });
  });

  // HISTOGRAM TESTS
  describe('Histogram', () => {
    it('computes ratio of histogram_sum', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: HISTOGRAM_TABLE },
        metricTables: { [MetricsDataType.Histogram]: HISTOGRAM_TABLE } as any,
        select: [
          {
            aggFn: 'histogram_sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.hist_alpha',
            metricType: MetricsDataType.Histogram,
          },
          {
            aggFn: 'histogram_sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.hist_beta',
            metricType: MetricsDataType.Histogram,
          },
        ],
        groupBy: undefined,
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];
      expect(
        data[0][
          'histogram_sum(metric.hist_alpha)/histogram_sum(metric.hist_beta)'
        ],
      ).toBe(0.5);
    });
  });

  // EXPONENTIAL HISTOGRAM TESTS
  describe('Exponential Histogram', () => {
    it('computes ratio of histogram_sum', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...getBaseConfig(),
        from: { databaseName: DATABASE, tableName: EXP_HISTOGRAM_TABLE },
        metricTables: {
          [MetricsDataType.ExponentialHistogram]: EXP_HISTOGRAM_TABLE,
        } as any,
        select: [
          {
            aggFn: 'histogram_sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.exp_alpha',
            metricType: MetricsDataType.ExponentialHistogram,
          },
          {
            aggFn: 'histogram_sum',
            aggCondition: '',
            aggConditionLanguage: 'sql',
            valueExpression: 'Value',
            metricName: 'metric.exp_beta',
            metricType: MetricsDataType.ExponentialHistogram,
          },
        ],
        groupBy: undefined,
      };
      const result = await hdxClient.queryChartConfig({
        config,
        metadata,
        querySettings: undefined,
      });
      const data = result.data as any[];
      expect(
        data[0][
          'histogram_sum(metric.exp_alpha)/histogram_sum(metric.exp_beta)'
        ],
      ).toBe(4);
    });
  });
});
