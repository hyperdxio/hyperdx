import {
  validateRawSqlChartConfig,
  validateRawSqlForAlert,
} from '@/core/utils';
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

  it('stays silent on the console while a macro is half-typed', () => {
    // The editor revalidates on every keystroke, so an unterminated argument
    // list is the expected path, not a bug. Logging it would put a stack trace
    // in the console on each debounce tick.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      for (const sqlTemplate of [
        'SELECT * FROM $__sourceTable(',
        'SELECT * WHERE $__filters(',
        'SELECT $__sourceTable( FROM logs',
      ]) {
        validateRawSqlChartConfig(config({ sqlTemplate }), {
          isDashboardTile: true,
        });
      }
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
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

  describe('an empty SQL template', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '  \n  '],
    ])('reports nothing when the editor is %s', (_label, sqlTemplate) => {
      expect(
        validateRawSqlChartConfig(
          config({ sqlTemplate, displayType: DisplayType.Line }),
          { isDashboardTile: true },
        ),
      ).toEqual({ errors: [], warnings: [] });
    });

    it('is still rejected for an alert', () => {
      // The quiet-while-empty rule above is for the editor banner only.
      // `validateRawSqlForAlert` also backs `validateAlertInput` on the API,
      // where an empty template must not be allowed to save an alert on a
      // tile that can never produce a series.
      const { errors } = validateRawSqlForAlert(
        config({ sqlTemplate: '', displayType: DisplayType.Line }),
      );
      expect(errors).toContain(
        'SQL used for alerts must include an interval parameter or macro.',
      );
    });
  });

  describe('macro expansion failures', () => {
    it('surfaces an unresolvable metric type, which no other check covers', () => {
      const { errors } = validateRawSqlChartConfig(
        config({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable(bogus) WHERE $__timeFilter(ts)',
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
        "Macro '$__sourceTable(metricType)' invalid argument 'bogus'. Expected a valid metrics data type (gauge, histogram, sum, summary, exponential histogram).",
      );
    });

    it('stays silent on an unterminated argument list, which is what half-typed SQL looks like', () => {
      const { errors } = validateRawSqlChartConfig(
        config({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(',
        }),
      );
      expect(errors).toEqual([]);
    });

    it('does not repeat a $__sourceTable failure the source checks already describe', () => {
      const { errors } = validateRawSqlChartConfig(
        config({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable(gauge) WHERE $__timeFilter(ts)',
          metricTables: undefined,
        }),
      );
      expect(errors).toEqual([
        'SQL uses $__sourceTable(<metricType>) but the selected source is not a metrics source — use a bare $__sourceTable instead.',
      ]);
    });
  });

  describe('variable references', () => {
    const withVariables = (sqlTemplate: string) =>
      config({
        sqlTemplate,
        variables: [
          { name: 'service', values: ['api'], expression: 'ServiceName' },
          { name: 'env', values: [], expression: 'Env' },
        ],
      });

    it('errors on a macro naming a variable the dashboard does not have', () => {
      const { errors } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $nope)',
        ),
      );
      expect(errors).toContain(
        "Macro '$__filter' references unknown variable 'nope'. Available variables: service, env.",
      );
    });

    it('errors once on a macro whose variable argument is missing its $', () => {
      // Both the variable checks and macro resolution expand this template, so
      // the same message can be reached twice.
      const { errors } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, service)',
        ),
      );
      expect(
        errors.filter(error =>
          error.includes('requires its variable argument'),
        ),
      ).toEqual([
        "Macro '$__filter' requires its variable argument to be written as a " +
          "reference, as in $__filter(<expression>, $service) — got 'service'.",
      ]);
    });

    it('warns on a bare reference the dashboard does not have', () => {
      const { warnings } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE ServiceName IN ($nope)',
        ),
      );
      expect(warnings).toContain(
        'SQL references unknown variable $nope. Available variables: service, env.',
      );
    });

    it('errors on a resolved reference wrapped in quotes, which always produces invalid SQL', () => {
      const { errors } = validateRawSqlChartConfig(
        withVariables(
          "SELECT count() FROM $__sourceTable WHERE ServiceName = '$service'",
        ),
      );
      expect(errors).toContain(
        '$service is wrapped in quotes, but the default sqlstring format already quotes each value. Did you mean to use $__filter(<expression>, $service) or ${service:csv} instead?',
      );
    });

    it('warns that a bare reference has no valid empty state', () => {
      const { warnings } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE ServiceName IN ($service)',
        ),
      );
      expect(warnings).toContain(
        '$service has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, $service) or $__conditionalAll(<condition>, $service) so the query stays valid when no values are selected.',
      );
    });

    it('leaves an explicitly formatted reference alone', () => {
      // A non-default format is a deliberate choice, and the empty-selection
      // warning below is specific to how sqlstring renders.
      const { errors, warnings } = validateRawSqlChartConfig(
        withVariables(
          "SELECT count() FROM $__sourceTable WHERE ServiceName IN ('${service:csv}') AND $__timeFilter(ts)",
        ),
      );
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('does not call a reference unguarded when the enclosing macro guards that same variable', () => {
      const { errors, warnings } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE $__conditionalAll(ServiceName NOT IN ($service), $service) AND $__timeFilter(ts)',
        ),
      );
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('still warns when the enclosing macro guards a different variable', () => {
      const { warnings } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE $__conditionalAll(Env IN ($env), $service) AND $__timeFilter(ts)',
        ),
      );
      expect(warnings).toContain(
        '$env has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, $env) or $__conditionalAll(<condition>, $env) so the query stays valid when no values are selected.',
      );
    });

    it('leaves a correct $__filter usage alone', () => {
      const { errors, warnings } = validateRawSqlChartConfig(
        withVariables(
          'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $service) AND $__timeFilter(ts)',
        ),
      );
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it('reports each unknown name once however many times it is written', () => {
      const { warnings } = validateRawSqlChartConfig(
        withVariables('SELECT $nope FROM $__sourceTable WHERE x = $nope'),
      );
      expect(warnings.filter(w => w.includes('unknown variable'))).toHaveLength(
        1,
      );
    });

    it('says "(none)" when the dashboard exposes no variables at all', () => {
      const { warnings } = validateRawSqlChartConfig(
        config({
          sqlTemplate: 'SELECT count() FROM $__sourceTable WHERE x = $nope',
          variables: [],
        }),
      );
      expect(warnings).toContain(
        'SQL references unknown variable $nope. Available variables: (none).',
      );
    });

    describe('with no variable context (chart explorer, or the feature disabled)', () => {
      it('errors on the macro forms, which are always invalid SQL there', () => {
        const { errors } = validateRawSqlChartConfig(
          config({
            sqlTemplate:
              'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $service)',
          }),
        );
        expect(errors).toContain(
          'SQL uses $__filter, but no variables are available here.',
        );
      });

      it('warns on a bare reference, which may well be a literal', () => {
        const { warnings } = validateRawSqlChartConfig(
          config({
            sqlTemplate:
              'SELECT count() FROM $__sourceTable WHERE x IN ($service)',
          }),
        );
        expect(warnings).toContain(
          'SQL references $service, but no variables are available here.',
        );
      });
    });
  });

  describe('the $__filters recommendation', () => {
    it('is made for a dashboard tile that filters nothing', () => {
      const { warnings } = validateRawSqlChartConfig(
        config({ sqlTemplate: 'SELECT count() FROM $__sourceTable' }),
        { isDashboardTile: true },
      );
      expect(warnings).toContain(
        'SQL should include the $__filters macro so dashboard filters apply to this tile.',
      );
    });

    it('is withheld from a tile that already filters per-variable', () => {
      const { warnings } = validateRawSqlChartConfig(
        config({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__filter(ServiceName, $service)',
          variables: [
            { name: 'service', values: ['api'], expression: 'ServiceName' },
          ],
        }),
        { isDashboardTile: true },
      );
      expect(warnings).not.toContain(
        'SQL should include the $__filters macro so dashboard filters apply to this tile.',
      );
    });
  });
});
