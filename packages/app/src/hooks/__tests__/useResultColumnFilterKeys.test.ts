import {
  BuilderChartConfig,
  MetricsDataType,
} from '@hyperdx/common-utils/dist/types';

import {
  getBuilderFilterKeys,
  getPromqlFilterKeys,
  getRawSqlFilterKeys,
} from '@/hooks/useResultColumnFilterKeys';

const meta = (...columns: [string, string][]) =>
  columns.map(([name, type]) => ({ name, type }));

describe('getBuilderFilterKeys', () => {
  const builder = (
    overrides: Partial<BuilderChartConfig>,
  ): BuilderChartConfig => ({
    select: [{ aggFn: 'count', valueExpression: '' }],
    from: { databaseName: 'default', tableName: 'logs' },
    where: '',
    timestampValueExpression: 'Timestamp',
    connection: 'local',
    ...overrides,
  });

  it('keys each group-by column by its expression, without the alias', () => {
    const keys = getBuilderFilterKeys(
      builder({ groupBy: "ServiceName, LogAttributes['k'] AS k" }),
      meta(
        ['count()', 'UInt64'],
        ['ServiceName', 'String'],
        ['k', 'String'],
        ['__hdx_time_bucket', 'DateTime'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({
      ServiceName: 'ServiceName',
      k: "LogAttributes['k']",
    });
  });

  it('uses the value expression of a structured group-by', () => {
    const keys = getBuilderFilterKeys(
      builder({
        groupBy: [{ valueExpression: 'lower(ServiceName)', alias: 'svc' }],
      }),
      meta(['count()', 'UInt64'], ['svc', 'String']),
    );
    expect(Object.fromEntries(keys)).toEqual({ svc: 'lower(ServiceName)' });
  });

  it('keys a renamed column by its result name', () => {
    const keys = getBuilderFilterKeys(
      builder({ groupBy: "LogAttributes['k']" }),
      meta(
        ['count()', 'UInt64'],
        ["arrayElement(LogAttributes, 'k')", 'String'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({
      "arrayElement(LogAttributes, 'k')": "LogAttributes['k']",
    });
  });

  it('counts every value column ahead of the group-by', () => {
    const keys = getBuilderFilterKeys(
      builder({
        select: [
          { aggFn: 'count', valueExpression: '' },
          { aggFn: 'max', valueExpression: 'Duration' },
        ],
        groupBy: 'ServiceName',
      }),
      meta(
        ['count()', 'UInt64'],
        ['max(Duration)', 'Float64'],
        ['ServiceName', 'String'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ ServiceName: 'ServiceName' });
  });

  it('expands variables in the group-by', () => {
    const keys = getBuilderFilterKeys(
      builder({
        groupBy: 'LogAttributes[$attr]',
        variables: [{ name: 'attr', values: ['region'] }],
      }),
      meta(['count()', 'UInt64'], ["LogAttributes['region']", 'String']),
    );
    expect(Object.fromEntries(keys)).toEqual({
      "LogAttributes['region']": "LogAttributes['region']",
    });
  });

  it('leaves out DateTime group-by columns', () => {
    const keys = getBuilderFilterKeys(
      builder({ groupBy: 'toStartOfHour(Timestamp) AS hour, ServiceName' }),
      meta(
        ['count()', 'UInt64'],
        ['hour', 'DateTime'],
        ['ServiceName', 'String'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ ServiceName: 'ServiceName' });
  });

  it('has no keys for histograms, which pack their group-by into one column', () => {
    const keys = getBuilderFilterKeys(
      builder({
        select: [
          {
            aggFn: 'quantile',
            level: 0.5,
            valueExpression: 'Value',
            metricName: 'latency',
            metricType: MetricsDataType.Histogram,
          },
        ],
        groupBy: 'ServiceName',
      }),
      meta(['group', 'Array(String)'], ['quantile(latency)', 'Float64']),
    );
    expect(keys.size).toBe(0);
  });

  it('keys the group-by columns of histograms mixed with other metrics', () => {
    const keys = getBuilderFilterKeys(
      builder({
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'Value',
            metricName: 'cpu',
            metricType: MetricsDataType.Gauge,
          },
          {
            aggFn: 'quantile',
            level: 0.5,
            valueExpression: 'Value',
            metricName: 'latency',
            metricType: MetricsDataType.Histogram,
          },
        ],
        groupBy: 'ServiceName',
      }),
      meta(
        ['avg(cpu)', 'Float64'],
        ['quantile(latency)', 'Float64'],
        ['ServiceName', 'String'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ ServiceName: 'ServiceName' });
  });

  it('has no keys without a group-by', () => {
    expect(
      getBuilderFilterKeys(builder({}), meta(['count()', 'UInt64'])).size,
    ).toBe(0);
  });
});

describe('getRawSqlFilterKeys', () => {
  it('keys grouped columns by the expression behind them, leaving out aggregates', () => {
    const keys = getRawSqlFilterKeys(
      {
        sql: 'SELECT ServiceName AS svc, StatusCode, any(Body) AS body, count() FROM logs GROUP BY svc, StatusCode',
        params: {},
      },
      meta(
        ['svc', 'String'],
        ['StatusCode', 'UInt16'],
        ['body', 'String'],
        ['count()', 'UInt64'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({
      svc: 'ServiceName',
      StatusCode: 'StatusCode',
    });
  });

  it('leaves out DateTime group-by columns', () => {
    const keys = getRawSqlFilterKeys(
      {
        sql: 'SELECT toStartOfHour(Timestamp) AS hour, ServiceName, count() FROM logs GROUP BY hour, ServiceName',
        params: {},
      },
      meta(
        ['hour', 'DateTime'],
        ['ServiceName', 'String'],
        ['count()', 'UInt64'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ ServiceName: 'ServiceName' });
  });

  it('falls back to string columns when the query has no GROUP BY', () => {
    const keys = getRawSqlFilterKeys(
      {
        sql: 'SELECT ServiceName AS svc, Timestamp, Duration FROM logs',
        params: {},
      },
      meta(
        ['svc', 'String'],
        ['Timestamp', 'DateTime64(9)'],
        ['Duration', 'UInt64'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ svc: 'ServiceName' });
  });

  it('falls back when the SELECT list does not line up with the result columns', () => {
    const keys = getRawSqlFilterKeys(
      {
        sql: 'SELECT ServiceName AS svc, count() FROM logs GROUP BY svc',
        params: {},
      },
      meta(['svc', 'String'], ['extra', 'String'], ['count()', 'UInt64']),
    );
    expect(Object.fromEntries(keys)).toEqual({
      svc: 'ServiceName',
      extra: 'extra',
    });
  });

  it('quotes fallback column names that need it', () => {
    const keys = getRawSqlFilterKeys(
      { sql: 'SELECT * FROM logs', params: {} },
      meta(['x-host', 'String'], ['count', 'UInt64']),
    );
    expect(Object.fromEntries(keys)).toEqual({ 'x-host': '`x-host`' });
  });

  it('leaves out fallback columns holding DateTimes', () => {
    const keys = getRawSqlFilterKeys(
      { sql: 'SELECT * FROM logs', params: {} },
      meta(
        ['ServiceName', 'String'],
        ['times', 'Array(DateTime64(9))'],
        ['firstSeen', 'Map(String, DateTime)'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({ ServiceName: 'ServiceName' });
  });
});

describe('getPromqlFilterKeys', () => {
  it('keys each label column by its label, leaving out the time column', () => {
    const keys = getPromqlFilterKeys(
      meta(
        ['Timestamp', 'DateTime64(3)'],
        ['job', 'String'],
        ['instance', 'String'],
        ['Value', 'Float64'],
      ),
    );
    expect(Object.fromEntries(keys)).toEqual({
      job: 'job',
      instance: 'instance',
    });
  });
});
