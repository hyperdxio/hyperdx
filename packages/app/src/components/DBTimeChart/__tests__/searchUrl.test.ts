import {
  type ChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { buildSeriesSearchUrl } from '@/components/DBTimeChart';

// The URL string itself is ChartUtils' concern and already covered there. What
// matters here is the branching this function does before delegating — which was
// previously locked inside a useCallback and untestable.
type SearchUrlArgs = {
  dateRange: [Date, Date];
  groupFilters: { column: string; value: string }[];
  valueRangeFilter?: { expression: string; value: number };
};

const mockBuildEventsSearchUrl = jest.fn<string, [SearchUrlArgs]>(
  () => '/search?mocked=1',
);
jest.mock('@/ChartUtils', () => ({
  ...jest.requireActual('@/ChartUtils'),
  buildEventsSearchUrl: (arg: SearchUrlArgs) => mockBuildEventsSearchUrl(arg),
}));

/** Args the function handed to buildEventsSearchUrl on its first call. */
const delegatedArgs = () => mockBuildEventsSearchUrl.mock.calls[0][0];

const source = {
  id: 'src-1',
  kind: SourceKind.Log,
  name: 'logs',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
} as unknown as TSource;

const clicked = new Date('2026-01-01T00:00:00Z');

const args = {
  clickedActiveLabelDate: clicked as Date | undefined,
  source: source as TSource | undefined,
  granularity: '1 minute',
  groupColumns: [] as string[],
  valueColumns: undefined as string[] | undefined,
  isSingleValueColumn: true as boolean | undefined,
};

const configWith = (
  select: { aggFn: string; valueExpression: string }[],
): ChartConfigWithDateRange =>
  ({
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'Timestamp',
    where: '',
    select,
    dateRange: [clicked, clicked],
  }) as ChartConfigWithDateRange;

const rawSqlConfig = {
  connection: 'conn-1',
  configType: 'sql',
  sqlTemplate: 'SELECT 1',
  dateRange: [clicked, clicked],
} satisfies Partial<ChartConfigWithDateRange> as ChartConfigWithDateRange;

const promqlConfig = {
  connection: 'conn-1',
  configType: 'promql',
  promqlExpression: 'up',
  dateRange: [clicked, clicked],
} satisfies Partial<ChartConfigWithDateRange> as ChartConfigWithDateRange;

beforeEach(() => jest.clearAllMocks());

describe('buildSeriesSearchUrl', () => {
  describe('returns null when drill-down cannot be supported', () => {
    it('with no clicked date', () => {
      expect(
        buildSeriesSearchUrl({
          ...args,
          clickedActiveLabelDate: undefined,
          config: configWith([{ aggFn: 'avg', valueExpression: 'Duration' }]),
        }),
      ).toBeNull();
      expect(mockBuildEventsSearchUrl).not.toHaveBeenCalled();
    });

    it('with no resolved source', () => {
      expect(
        buildSeriesSearchUrl({
          ...args,
          source: undefined,
          config: configWith([{ aggFn: 'avg', valueExpression: 'Duration' }]),
        }),
      ).toBeNull();
    });

    it('for a raw SQL chart', () => {
      // Raw SQL doesn't resolve to a single source, so there is nothing to search.
      expect(
        buildSeriesSearchUrl({
          ...args,
          config: rawSqlConfig,
        }),
      ).toBeNull();
    });

    it('for a PromQL chart', () => {
      // Same reason as raw SQL, and covered separately because the two share one
      // condition — without this, dropping the isPromqlChartConfig arm stays green.
      expect(
        buildSeriesSearchUrl({
          ...args,
          config: promqlConfig,
        }),
      ).toBeNull();
    });
  });

  it('ranges from the clicked bucket to one granularity later', () => {
    buildSeriesSearchUrl({
      ...args,
      config: configWith([{ aggFn: 'avg', valueExpression: 'Duration' }]),
    });
    const { dateRange } = delegatedArgs();
    expect(dateRange[0]).toEqual(clicked);
    expect(dateRange[1].getTime() - clicked.getTime()).toBe(60_000);
  });

  describe('value-range filter', () => {
    it('is added for an attributable aggregation', () => {
      buildSeriesSearchUrl({
        ...args,
        seriesValue: 250,
        config: configWith([{ aggFn: 'max', valueExpression: 'Duration' }]),
      });
      const { valueRangeFilter } = delegatedArgs();
      expect(valueRangeFilter).toEqual({
        expression: 'Duration',
        value: 250,
      });
    });

    it('is omitted for a non-attributable aggregation', () => {
      // A `count`/`sum` point is not attributable to any single event's value, so
      // filtering on it would return rows that never contributed to the point.
      buildSeriesSearchUrl({
        ...args,
        seriesValue: 250,
        config: configWith([{ aggFn: 'count', valueExpression: 'Duration' }]),
      });
      const { valueRangeFilter } = delegatedArgs();
      expect(valueRangeFilter).toBeUndefined();
    });

    it('is omitted when no series value was clicked', () => {
      buildSeriesSearchUrl({
        ...args,
        config: configWith([{ aggFn: 'max', valueExpression: 'Duration' }]),
      });
      const { valueRangeFilter } = delegatedArgs();
      expect(valueRangeFilter).toBeUndefined();
    });

    it('is added for a clicked value of zero', () => {
      // Zero is a real point — buildActiveClickSeries keeps it rather than
      // dropping it — so a truthiness guard here would silently widen the
      // drill-down to every event in the bucket.
      buildSeriesSearchUrl({
        ...args,
        seriesValue: 0,
        config: configWith([{ aggFn: 'max', valueExpression: 'Duration' }]),
      });
      const { valueRangeFilter } = delegatedArgs();
      expect(valueRangeFilter).toEqual({
        expression: 'Duration',
        value: 0,
      });
    });

    it('resolves the value column by series-key prefix on a multi-value chart', () => {
      // With more than one value column the series key is prefixed with the
      // column name, so the filter must follow that prefix to the right select
      // item rather than defaulting to select[0].
      buildSeriesSearchUrl({
        ...args,
        seriesKey: 'p95',
        seriesValue: 900,
        isSingleValueColumn: false,
        valueColumns: ['count', 'p95'],
        config: configWith([
          { aggFn: 'count', valueExpression: 'Body' },
          { aggFn: 'p95', valueExpression: 'Duration' },
        ]),
      });
      const { valueRangeFilter } = delegatedArgs();
      expect(valueRangeFilter).toEqual({ expression: 'Duration', value: 900 });
    });
  });

  it('passes decoded group filters through', () => {
    buildSeriesSearchUrl({
      ...args,
      seriesKey: 'api',
      groupColumns: ['ServiceName'],
      config: configWith([{ aggFn: 'avg', valueExpression: 'Duration' }]),
    });
    const { groupFilters } = delegatedArgs();
    expect(groupFilters).toEqual([{ column: 'ServiceName', value: 'api' }]);
  });
});
