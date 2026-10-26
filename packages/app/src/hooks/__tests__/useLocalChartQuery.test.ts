import {
  BuilderChartConfigWithOptTimestamp,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  buildLocalChartSql,
  getLocalTransform,
} from '@/hooks/useLocalChartQuery';

const config: BuilderChartConfigWithOptTimestamp = {
  dateRange: [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ],
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  connection: 'conn',
  where: '',
  granularity: 'auto',
  select: [
    { aggFn: 'count', valueExpression: '', aggCondition: '' },
    { aggFn: 'max', valueExpression: 'Duration', aggCondition: '' },
  ],
  groupBy: 'ServiceName',
};

const meta = [
  { name: 'count()', type: 'UInt64' },
  { name: 'max(Duration)', type: 'Float64' },
  { name: 'ServiceName', type: 'LowCardinality(String)' },
  { name: '__hdx_time_bucket', type: 'DateTime' },
];

const FROM =
  "FROM file('rows.jsonl', 'JSONEachRow', '`count()` UInt64, `max(Duration)` Float64, `ServiceName` LowCardinality(String), `__hdx_time_bucket` DateTime')";

describe('getLocalTransform', () => {
  it('re-aggregates additive functions from the time chart query', () => {
    const transform = getLocalTransform(config);
    expect(transform?.reaggregateFns).toEqual(['sum', 'max']);
    expect(transform?.timeConfig.granularity).toBe('1 minute');
  });

  it('queries the same time chart for every display type', () => {
    const table = getLocalTransform({
      ...config,
      displayType: DisplayType.Table,
      orderBy: 'ServiceName DESC',
      having: '',
    });
    const number = getLocalTransform({
      ...config,
      displayType: DisplayType.Number,
    });
    expect(table?.timeConfig).toEqual(number?.timeConfig);
    expect(table?.timeConfig).not.toHaveProperty('displayType');
  });

  it.each<[string, Partial<BuilderChartConfigWithOptTimestamp>]>([
    [
      'avg',
      {
        select: [
          { aggFn: 'avg', valueExpression: 'Duration', aggCondition: '' },
        ],
      },
    ],
    [
      'quantile',
      {
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            valueExpression: 'Duration',
            aggCondition: '',
          },
        ],
      },
    ],
    [
      'count distinct',
      {
        select: [
          { aggFn: 'count_distinct', valueExpression: 'Id', aggCondition: '' },
        ],
      },
    ],
    ['ratio', { seriesReturnType: 'ratio' }],
    ['having', { having: 'count() > 10' }],
    ['series limit with group by', { seriesLimit: 5 }],
    ['no timestamp', { timestampValueExpression: undefined }],
  ])('queries remotely with %s', (_, override) => {
    expect(getLocalTransform({ ...config, ...override })).toBeUndefined();
  });
});

describe('buildLocalChartSql', () => {
  const reaggregateFns = ['sum', 'max'];

  it('collapses buckets per group for a table, ordered by group', () => {
    expect(
      buildLocalChartSql({
        file: 'rows.jsonl',
        meta,
        reaggregateFns,
        kind: 'table',
      }),
    ).toBe(
      `SELECT sum(\`count()\`) AS \`count()\`, max(\`max(Duration)\`) AS \`max(Duration)\`, \`ServiceName\` ${FROM} GROUP BY \`ServiceName\` ORDER BY \`ServiceName\``,
    );
  });

  it('collapses everything into one row for a number', () => {
    expect(
      buildLocalChartSql({
        file: 'rows.jsonl',
        meta,
        reaggregateFns,
        kind: 'number',
      }),
    ).toBe(
      `SELECT sum(\`count()\`) AS \`count()\`, max(\`max(Duration)\`) AS \`max(Duration)\` ${FROM}`,
    );
  });

  it('orders categorical results by value and applies the limit', () => {
    expect(
      buildLocalChartSql({
        file: 'rows.jsonl',
        meta,
        reaggregateFns,
        kind: 'categorical',
        limit: 10,
      }),
    ).toContain('ORDER BY `count()` DESC, `ServiceName` LIMIT 10');
  });

  it.each([
    ['a string', '"count()" desc, ServiceName'],
    [
      'sort specifications',
      [
        { valueExpression: 'count()', ordering: 'DESC' as const },
        { valueExpression: 'ServiceName', ordering: 'ASC' as const },
      ],
    ],
  ])('orders by result columns from %s', (_, orderBy) => {
    expect(
      buildLocalChartSql({
        file: 'rows.jsonl',
        meta,
        reaggregateFns,
        kind: 'table',
        orderBy,
      }),
    ).toContain('ORDER BY `count()` DESC, `ServiceName` ASC');
  });

  it('rejects an ORDER BY that is not a result column', () => {
    expect(() =>
      buildLocalChartSql({
        file: 'rows.jsonl',
        meta,
        reaggregateFns,
        kind: 'table',
        orderBy: 'count() / 2 DESC',
      }),
    ).toThrow("Can't order the local result by count() / 2");
  });

  it('quotes identifiers and escapes the structure literal', () => {
    const sql = buildLocalChartSql({
      file: 'rows.jsonl',
      meta: [
        { name: 'count()', type: 'UInt64' },
        { name: "Attrs['a`b']", type: "DateTime('UTC')" },
      ],
      reaggregateFns: ['sum'],
      kind: 'table',
    });
    expect(sql).toContain("GROUP BY `Attrs['a\\`b']`");
    expect(sql).toContain("`Attrs[''a\\\\`b'']` DateTime(''UTC'')");
  });
});
