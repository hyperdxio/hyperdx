import {
  BuilderChartConfigWithDateRange,
  ChartVariable,
  DisplayType,
  MetricsDataType,
  SourceKind,
  TLogSource,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import { buildEventsSearchUrl, buildTableRowSearchUrl } from '@/ChartUtils';

const dateRange: [Date, Date] = [
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-01-01T01:00:00.000Z'),
];

const logSource = {
  id: 'logs',
  name: 'Logs',
  kind: SourceKind.Log,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
} satisfies TLogSource;

const svc = (values: string[]): ChartVariable[] => [
  { name: 'svc', expression: 'ServiceName', values },
];

const builderConfig = {
  displayType: DisplayType.Line,
  connection: 'clickhouse',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: [
    {
      aggFn: 'count',
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: '',
    },
  ],
  where: '',
  whereLanguage: 'sql',
  filters: [],
  timestampValueExpression: 'Timestamp',
  dateRange,
} satisfies BuilderChartConfigWithDateRange;

const searchParams = (url: string | null) => {
  expect(url).not.toBeNull();
  return new URL(url ?? '', 'http://localhost').searchParams;
};

const buildUrl = (
  overrides: Partial<BuilderChartConfigWithDateRange>,
  extra?: Parameters<typeof buildEventsSearchUrl>[0]['valueRangeFilter'],
) =>
  buildEventsSearchUrl({
    source: logSource,
    config: { ...builderConfig, ...overrides },
    dateRange,
    valueRangeFilter: extra,
  });

describe('buildEventsSearchUrl variable expansion', () => {
  it('expands $__filter in a SQL where clause', () => {
    const url = buildUrl({
      where: '$__filter(ServiceName, $svc)',
      variables: svc(['api']),
    });

    expect(searchParams(url).get('where')).toBe("(ServiceName IN ('api'))");
    expect(url).not.toContain('$');
  });

  it('expands the one-argument $__filter form via the variable expression', () => {
    expect(
      searchParams(
        buildUrl({
          where: '$__filter($svc)',
          variables: svc(['api']),
        }),
      ).get('where'),
    ).toBe("(toString(ServiceName) IN ('api'))");
  });

  it('expands bare and braced references in a SQL where clause', () => {
    expect(
      searchParams(
        buildUrl({
          where: 'ServiceName IN ($svc)',
          variables: svc(['api', 'web']),
        }),
      ).get('where'),
    ).toBe("ServiceName IN ('api', 'web')");

    expect(
      searchParams(
        buildUrl({
          where: "hasAny(splitByChar(',', '${svc:csv}'), [ServiceName])",
          variables: svc(['api', 'web']),
        }),
      ).get('where'),
    ).toBe("hasAny(splitByChar(',', 'api,web'), [ServiceName])");
  });

  it('expands references in a Lucene where clause using the Lucene format', () => {
    const params = searchParams(
      buildUrl({
        where: 'ServiceName:$svc',
        whereLanguage: 'lucene',
        variables: svc(['api', 'web']),
      }),
    );

    expect(params.get('where')).toBe('ServiceName:("api" OR "web")');
    expect(params.get('whereLanguage')).toBe('lucene');
  });

  it('emits the empty-selection form rather than dropping the predicate', () => {
    expect(
      searchParams(
        buildUrl({
          where: '$__filter(ServiceName, $svc)',
          variables: svc([]),
        }),
      ).get('where'),
    ).toBe("(1=1 /** no values selected for variable 'svc' */)");

    expect(
      searchParams(
        buildUrl({
          where: 'ServiceName:$svc',
          whereLanguage: 'lucene',
          variables: svc([]),
        }),
      ).get('where'),
    ).toBe('ServiceName:("")');
  });

  it('expands a promoted single-series aggCondition in its own language', () => {
    const sqlSeries = searchParams(
      buildUrl({
        select: [
          {
            ...builderConfig.select[0],
            aggCondition: '$__filter(ServiceName, $svc)',
            aggConditionLanguage: 'sql',
          },
        ],
        variables: svc(['api']),
      }),
    );
    expect(sqlSeries.get('where')).toBe("(ServiceName IN ('api'))");
    expect(sqlSeries.get('whereLanguage')).toBe('sql');

    const luceneSeries = searchParams(
      buildUrl({
        select: [
          {
            ...builderConfig.select[0],
            aggCondition: 'ServiceName:$svc',
            aggConditionLanguage: 'lucene',
          },
        ],
        variables: svc(['api']),
      }),
    );
    expect(luceneSeries.get('where')).toBe('ServiceName:("api")');
    expect(luceneSeries.get('whereLanguage')).toBe('lucene');
  });

  it('leaves a config without variables untouched', () => {
    expect(
      buildUrl({ where: 'ServiceName = $svc', whereLanguage: 'sql' }),
    ).toBe(
      '/search?source=logs&where=ServiceName+%3D+%24svc&whereLanguage=sql&filters=%5B%5D&isLive=false&from=1767225600000&to=1767229200000',
    );
  });

  it('falls back to the clause as written when expansion fails', () => {
    expect(
      searchParams(
        buildUrl({
          where: '$__filter(ServiceName, $nope)',
          variables: svc(['api']),
        }),
      ).get('where'),
    ).toBe('$__filter(ServiceName, $nope)');
  });
});

describe('buildEventsSearchUrl metric drill-down', () => {
  const metricTables = {
    gauge: 'otel_metrics_gauge',
    histogram: 'otel_metrics_histogram',
    sum: 'otel_metrics_sum',
    summary: 'otel_metrics_summary',
    'exponential histogram': 'otel_metrics_exponential_histogram',
  };

  const metricSource = {
    id: 'metrics',
    name: 'Metrics',
    kind: SourceKind.Metric,
    connection: 'clickhouse',
    from: { databaseName: 'default', tableName: '' },
    timestampValueExpression: 'TimeUnix',
    metricTables,
    resourceAttributesExpression: 'ResourceAttributes',
    logSourceId: 'logs',
  } as unknown as TMetricSource;

  const metricConfig = {
    ...builderConfig,
    from: { databaseName: 'default', tableName: 'otel_metrics_gauge' },
    metricTables,
    where: "MetricName = 'k8s.pod.cpu'",
    whereLanguage: 'sql' as const,
    select: [
      {
        aggFn: 'avg' as const,
        aggCondition: '',
        aggConditionLanguage: 'sql' as const,
        valueExpression: 'Value',
        metricName: 'k8s.pod.cpu',
        metricType: MetricsDataType.Gauge,
      },
    ],
    timestampValueExpression: 'TimeUnix',
  } satisfies BuilderChartConfigWithDateRange;

  const logSourceWithAttributes = {
    ...logSource,
    resourceAttributesExpression: 'ResourceAttributes',
  } satisfies TLogSource;

  const drillDown = (targetSource?: TLogSource) =>
    searchParams(
      buildEventsSearchUrl({
        source: metricSource,
        config: metricConfig,
        dateRange,
        groupFilters: [
          {
            column: "ResourceAttributes['k8s.pod.name']",
            value: 'payment-7d9f4',
          },
        ],
        targetSource,
      }),
    );

  it('lands on the correlated log source, carrying the clicked series', () => {
    const params = drillDown(logSourceWithAttributes);

    expect(params.get('source')).toBe('logs');
    expect(JSON.parse(params.get('filters') ?? '')).toEqual([
      {
        type: 'sql',
        condition: "ResourceAttributes['k8s.pod.name'] IN ('payment-7d9f4')",
      },
    ]);
  });

  it("drops the metric's own where clause, which means nothing on log rows", () => {
    expect(drillDown(logSourceWithAttributes).get('where')).toBe('');
  });

  it('keeps the clicked bucket as the time range', () => {
    const params = drillDown(logSourceWithAttributes);

    expect(params.get('from')).toBe(dateRange[0].getTime().toString());
    expect(params.get('to')).toBe(dateRange[1].getTime().toString());
  });

  it('narrows by time alone when the target source is unknown', () => {
    expect(JSON.parse(drillDown(undefined).get('filters') ?? '')).toEqual([]);
  });

  it('stays on Explore when asked, in SQL rather than Lucene', () => {
    const url = buildEventsSearchUrl({
      source: metricSource,
      config: metricConfig,
      dateRange,
      groupFilters: [
        {
          column: "ResourceAttributes['k8s.pod.name']",
          value: 'payment-7d9f4',
        },
      ],
      targetSource: logSourceWithAttributes,
      basePath: '/explore',
    });

    expect(url?.startsWith('/explore?')).toBe(true);
    expect(searchParams(url).get('whereLanguage')).toBe('sql');
  });
});

describe('buildTableRowSearchUrl variable expansion', () => {
  const tableConfig = {
    ...builderConfig,
    displayType: DisplayType.Table,
    select: [
      {
        aggFn: 'avg' as const,
        aggCondition: '',
        aggConditionLanguage: 'lucene' as const,
        valueExpression: '${durCol:csv}',
      },
    ],
    groupBy: [{ valueExpression: '${groupCol:csv}' }],
    variables: [
      { name: 'groupCol', values: ['ServiceName'] },
      { name: 'durCol', values: ['Duration'] },
    ],
  } satisfies BuilderChartConfigWithDateRange;

  it('matches the expanded group-by column against the row key', () => {
    const params = searchParams(
      buildTableRowSearchUrl({
        row: { ServiceName: 'api', 'avg(Duration)': 100 },
        source: logSource,
        config: tableConfig,
        dateRange,
      }),
    );

    expect(JSON.parse(params.get('filters') ?? '')).toEqual([
      { type: 'sql', condition: "ServiceName IN ('api')" },
      { type: 'sql', condition: 'Duration BETWEEN 95 AND 105' },
    ]);
  });
});
