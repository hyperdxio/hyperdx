import {
  BuilderChartConfigWithDateRange,
  ChartVariable,
  DisplayType,
  Filter,
  SourceKind,
  TLogSource,
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

describe('buildEventsSearchUrl series conditions', () => {
  const series = (aggCondition: string) => ({
    ...builderConfig.select[0],
    aggCondition,
  });

  const buildWithSeriesCondition = (
    overrides: Partial<BuilderChartConfigWithDateRange>,
    seriesCondition: Filter,
  ) =>
    buildEventsSearchUrl({
      source: logSource,
      config: { ...builderConfig, ...overrides },
      dateRange,
      seriesCondition,
    });

  const filtersOf = (url: string | null) =>
    JSON.parse(searchParams(url).get('filters') ?? '');

  it('applies the clicked series condition on a multi-series chart', () => {
    const url = buildWithSeriesCondition(
      { select: [series("ServiceName:'foo'"), series("ServiceName:'bar'")] },
      { type: 'lucene', condition: "ServiceName:'foo'" },
    );

    expect(searchParams(url).get('where')).toBe('');
    expect(filtersOf(url)).toEqual([
      { type: 'lucene', condition: "ServiceName:'foo'" },
    ]);
  });

  it('ANDs the series condition with the chart-level where and filters', () => {
    const url = buildWithSeriesCondition(
      {
        select: [series("ServiceName:'foo'"), series("ServiceName:'bar'")],
        where: "Env = 'prod'",
        whereLanguage: 'sql',
        filters: [{ type: 'sql', condition: "Region = 'us-east-1'" }],
      },
      { type: 'lucene', condition: "ServiceName:'foo'" },
    );

    const params = searchParams(url);
    expect(params.get('where')).toBe("Env = 'prod'");
    expect(params.get('whereLanguage')).toBe('sql');
    expect(filtersOf(url)).toEqual([
      { type: 'sql', condition: "Region = 'us-east-1'" },
      { type: 'lucene', condition: "ServiceName:'foo'" },
    ]);
  });

  // A single series' condition already lands in `where`; adding it again as a
  // filter would show the user the same predicate twice.
  it('does not duplicate a single series condition promoted into where', () => {
    const url = buildWithSeriesCondition(
      { select: [series("ServiceName:'foo'")] },
      { type: 'lucene', condition: "ServiceName:'foo'" },
    );

    expect(searchParams(url).get('where')).toBe("ServiceName:'foo'");
    expect(filtersOf(url)).toEqual([]);
  });

  // Promotion is skipped when the chart has its own `where`, so the series
  // condition would otherwise be dropped entirely.
  it('keeps a single series condition that cannot be promoted', () => {
    const url = buildWithSeriesCondition(
      {
        select: [series("ServiceName:'foo'")],
        where: "Env = 'prod'",
        whereLanguage: 'sql',
      },
      { type: 'lucene', condition: "ServiceName:'foo'" },
    );

    expect(searchParams(url).get('where')).toBe("Env = 'prod'");
    expect(filtersOf(url)).toEqual([
      { type: 'lucene', condition: "ServiceName:'foo'" },
    ]);
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
