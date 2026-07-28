import { validateRawSqlChartConfig } from '@/core/utils';
import { DisplayType, RawSqlChartConfig } from '@/types';

function config(overrides: Partial<RawSqlChartConfig>): RawSqlChartConfig {
  return {
    configType: 'sql',
    sqlTemplate: 'SELECT count() FROM $__sourceTable',
    connection: 'test-connection',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    displayType: DisplayType.Table,
    ...overrides,
  } as RawSqlChartConfig;
}

describe('validateRawSqlChartConfig', () => {
  it('errors when a time-series display type is missing an interval param/macro', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Line,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      }),
    );
    expect(errors).toEqual([
      'SQL must include an interval parameter or macro (e.g. $__interval_s) for this display type.',
    ]);
  });

  it('does not require an interval param/macro for non-time-series display types', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Table,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      }),
    );
    expect(errors).toEqual([]);
  });

  it('does not error when a time-series display type includes an interval macro', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Line,
        sqlTemplate:
          'SELECT $__timeInterval(ts), count() FROM $__sourceTable WHERE $__timeFilter(ts) GROUP BY 1',
      }),
    );
    expect(errors).toEqual([]);
  });

  it('warns when start/end date params or macros are missing', () => {
    const { warnings } = validateRawSqlChartConfig(
      config({ sqlTemplate: 'SELECT count() FROM $__sourceTable' }),
    );
    expect(warnings).toContain(
      'SQL should include start and end date parameters or macros (e.g. $__timeFilter) so this chart respects the selected time range.',
    );
  });

  it('does not warn about the date range when a time-range macro is present', () => {
    const { warnings } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      }),
    );
    expect(warnings).not.toContain(
      'SQL should include start and end date parameters or macros (e.g. $__timeFilter) so this chart respects the selected time range.',
    );
  });

  it('does not warn about missing $__filters/$__sourceTable when requireSourceMacros is false', () => {
    const { warnings } = validateRawSqlChartConfig(
      config({
        sqlTemplate: 'SELECT count() FROM logs WHERE $__timeFilter(ts)',
      }),
      { isDashboardTile: false },
    );
    expect(warnings).not.toContain(
      'SQL should include the $__sourceTable macro so this tile queries its configured source.',
    );
    expect(warnings).not.toContain(
      'SQL should include the $__filters macro so dashboard filters apply to this tile.',
    );
  });

  it('warns about missing $__filters/$__sourceTable when requireSourceMacros is true', () => {
    const { warnings } = validateRawSqlChartConfig(
      config({
        sqlTemplate: 'SELECT count() FROM logs WHERE $__timeFilter(ts)',
      }),
      { isDashboardTile: true },
    );
    expect(warnings).toContain(
      'SQL should include the $__sourceTable macro so this tile queries its configured source.',
    );
    expect(warnings).toContain(
      'SQL should include the $__filters macro so dashboard filters apply to this tile.',
    );
  });

  it('does not warn about missing source macros when they are present', () => {
    const { warnings } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts) AND $__filters',
      }),
      { isDashboardTile: true },
    );
    expect(warnings).not.toContain(
      'SQL should include the $__sourceTable macro so this tile queries its configured source.',
    );
    expect(warnings).not.toContain(
      'SQL should include the $__filters macro so dashboard filters apply to this tile.',
    );
  });

  it('errors when $__sourceTable is used but no source is selected', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        from: undefined,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      }),
    );
    expect(errors).toContain(
      'SQL uses $__sourceTable but no source is selected — select a source so this macro can resolve correctly.',
    );
  });

  it('errors naming both macros when $__filters and $__sourceTable are both used without a source', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        from: undefined,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts) AND $__filters',
      }),
    );
    expect(errors).toContain(
      'SQL uses $__filters and $__sourceTable but no source is selected — select a source so these macros can resolve correctly.',
    );
  });

  it('does not error about a missing source when no source-dependent macros are used', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        from: undefined,
        sqlTemplate: 'SELECT count() FROM logs WHERE $__timeFilter(ts)',
      }),
    );
    expect(errors.some(e => e.includes('no source is selected'))).toBe(false);
  });

  it('does not error about a missing source when a source is selected', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        from: { databaseName: 'default', tableName: 'otel_logs' },
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      }),
    );
    expect(errors.some(e => e.includes('no source is selected'))).toBe(false);
  });

  it('does not throw when $__sourceTable( has an unmatched paren', () => {
    expect(() =>
      validateRawSqlChartConfig(
        config({
          displayType: DisplayType.Line,
          sqlTemplate: 'SELECT * FROM $__sourceTable(',
        }),
        { isDashboardTile: true },
      ),
    ).not.toThrow();
  });

  it('does not throw when $__filters( has an unmatched paren', () => {
    expect(() =>
      validateRawSqlChartConfig(
        config({
          displayType: DisplayType.Line,
          sqlTemplate: 'SELECT * WHERE $__filters(',
        }),
        { isDashboardTile: true },
      ),
    ).not.toThrow();
  });

  it('degrades to no errors/warnings (instead of throwing) when the sqlTemplate is unparseable', () => {
    const result = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Line,
        sqlTemplate: 'SELECT $__sourceTable( FROM logs',
      }),
      { isDashboardTile: true },
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('does not throw when $__sourceTable( has an unmatched paren and no source is selected', () => {
    expect(() =>
      validateRawSqlChartConfig(
        config({
          from: undefined,
          sqlTemplate: 'SELECT * FROM $__sourceTable(',
        }),
      ),
    ).not.toThrow();
  });

  it('reports the missing-interval error for a metric $__sourceTable(type) macro when metricTables is provided', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Line,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
      }),
    );
    // With metricTables, replaceMacros can resolve $__sourceTable(gauge), so
    // getRawSqlTimeRangeStatus succeeds and correctly reports the interval
    // macro that this Line-chart query is missing, instead of silently
    // skipping the check.
    expect(errors).toEqual([
      'SQL must include an interval parameter or macro (e.g. $__interval_s) for this display type.',
    ]);
  });

  it('silently skips that same interval error when metricTables is missing, but still reports the source-type mismatch', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        displayType: DisplayType.Line,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
        metricTables: undefined,
      }),
    );
    // Same query as above, minus metricTables: replaceMacros now throws
    // resolving $__sourceTable(gauge), so getRawSqlTimeRangeStatus returns
    // null and the missing-interval error is NOT reported, even though the
    // interval macro is equally missing here. The source-type mismatch
    // check doesn't depend on macro resolution, so it still fires.
    expect(errors).toEqual([
      'SQL uses $__sourceTable(<metricType>) but the selected source is not a metrics source — use a bare $__sourceTable instead.',
    ]);
    expect(errors).not.toContain(
      'SQL must include an interval parameter or macro (e.g. $__interval_s) for this display type.',
    );
  });

  it('errors when a non-metrics source uses $__sourceTable(<metricType>)', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
        metricTables: undefined,
      }),
    );
    expect(errors).toContain(
      'SQL uses $__sourceTable(<metricType>) but the selected source is not a metrics source — use a bare $__sourceTable instead.',
    );
  });

  it('errors when a metrics source uses a bare $__sourceTable', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
      }),
    );
    expect(errors).toContain(
      'SQL uses a bare $__sourceTable but the selected source is a metrics source — specify a metric type, e.g. $__sourceTable(gauge).',
    );
  });

  it('does not error when a non-metrics source uses a bare $__sourceTable', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
        metricTables: undefined,
      }),
    );
    expect(errors.some(e => e.includes('is not a metrics source'))).toBe(false);
  });

  it('does not error when a metrics source uses $__sourceTable(<metricType>)', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
      }),
    );
    expect(errors.some(e => e.includes('specify a metric type'))).toBe(false);
  });

  it('does not report a source-type mismatch when no source is selected', () => {
    const { errors } = validateRawSqlChartConfig(
      config({
        from: undefined,
        sqlTemplate:
          'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
        metricTables: undefined,
      }),
    );
    expect(errors.some(e => e.includes('is not a metrics source'))).toBe(false);
    // The "no source selected" check takes over instead.
    expect(errors).toContain(
      'SQL uses $__sourceTable but no source is selected — select a source so this macro can resolve correctly.',
    );
  });

  it('returns no errors/warnings for a non-raw-sql config', () => {
    const result = validateRawSqlChartConfig({
      configType: 'metric',
    } as unknown as RawSqlChartConfig);
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});
