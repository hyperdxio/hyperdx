import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  DisplayType,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import {
  buildAlertChartConfig,
  isSingleValueRawSqlConfig,
} from '@/components/alerts/AlertDetailChart';

const dateRange: [Date, Date] = [
  new Date('2026-05-01T00:00:00.000Z'),
  new Date('2026-05-02T00:00:00.000Z'),
];

// A partial source fixture. `value: any` (rather than an `as` cast) keeps this
// off the no-unsafe-type-assertion budget while still producing a value typed
// as TSource.
const asSource = (value: any): TSource => value;

const logSource = asSource({
  id: 'source-1',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  bodyExpression: 'Body',
  implicitColumnExpression: 'Body',
});

const builderConfig: SavedChartConfig = {
  name: 'Error rate',
  source: 'source-1',
  displayType: DisplayType.Line,
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  where: '',
};

const build = (
  savedConfig: SavedChartConfig | undefined,
  // An explicit `undefined` must mean "source hasn't resolved yet", so this
  // takes the whole options object rather than a defaulted positional arg.
  { source }: { source: TSource | undefined } = { source: logSource },
) =>
  buildAlertChartConfig({
    savedConfig,
    source,
    variables: [],
    dateRange,
    granularity: Granularity.FiveMinute,
  });

describe('buildAlertChartConfig', () => {
  it('resolves a builder config against its source', () => {
    expect(build(builderConfig)).toMatchObject({
      connection: 'conn-1',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      bodyExpression: 'Body',
      dateRange,
      granularity: Granularity.FiveMinute,
      displayType: DisplayType.Line,
    });
  });

  // The alert task evaluates a Number tile as a time series, and the
  // threshold-over-time view is what this chart is for.
  it('charts a Number config as a line', () => {
    expect(
      build({ ...builderConfig, displayType: DisplayType.Number })?.displayType,
    ).toBe(DisplayType.Line);
  });

  it('has nothing to chart until the source resolves', () => {
    expect(build(builderConfig, { source: undefined })).toBeUndefined();
  });

  it('has nothing to chart without a config', () => {
    expect(build(undefined)).toBeUndefined();
  });

  // PromQL charts cannot be alerted on at all.
  it('refuses a PromQL config', () => {
    expect(
      build({
        configType: 'promql',
        promqlExpression: 'up',
        connection: 'conn-1',
        displayType: DisplayType.Line,
      }),
    ).toBeUndefined();
  });

  describe('raw SQL', () => {
    const rawSqlConfig: SavedChartConfig = {
      configType: 'sql',
      name: 'Error rate',
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      source: 'source-1',
      displayType: DisplayType.Line,
    };

    it('attaches the source metadata the query needs', () => {
      expect(build(rawSqlConfig)).toMatchObject({
        configType: 'sql',
        sqlTemplate: 'SELECT 1',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        bodyExpression: 'Body',
        dateRange,
        granularity: Granularity.FiveMinute,
      });
    });

    // A source-less raw SQL config carries its own FROM, so it charts without
    // waiting on a source lookup.
    it('charts without a source when the config names none', () => {
      expect(
        build({ ...rawSqlConfig, source: undefined }, { source: undefined }),
      ).toMatchObject({ sqlTemplate: 'SELECT 1', dateRange });
    });

    // A raw SQL Number chart is a valid alert, but its SQL carries no interval
    // parameter to bucket by — the check-alerts task evaluates it as a single
    // value per window, so there is no series to chart. The caller says as
    // much rather than reporting it as unsupported.
    it('has no series to chart for a Number query', () => {
      const numberConfig = { ...rawSqlConfig, displayType: DisplayType.Number };

      expect(build(numberConfig)).toBeUndefined();
      expect(isSingleValueRawSqlConfig(numberConfig)).toBe(true);
    });

    it('refuses a non-time-series display type', () => {
      expect(
        build({ ...rawSqlConfig, displayType: DisplayType.Table }),
      ).toBeUndefined();
    });
  });
});

describe('isSingleValueRawSqlConfig', () => {
  // A builder Number config re-buckets into a line chart, so it does have a
  // series — only raw SQL is single-value.
  it('is false for a builder Number config', () => {
    expect(
      isSingleValueRawSqlConfig({
        ...builderConfig,
        displayType: DisplayType.Number,
      }),
    ).toBe(false);
  });

  it('is false for a raw SQL time series', () => {
    expect(
      isSingleValueRawSqlConfig({
        configType: 'sql',
        sqlTemplate: 'SELECT 1',
        connection: 'conn-1',
        displayType: DisplayType.Line,
      }),
    ).toBe(false);
  });

  it('is false without a config', () => {
    expect(isSingleValueRawSqlConfig(undefined)).toBe(false);
  });
});
