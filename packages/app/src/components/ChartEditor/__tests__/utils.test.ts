import type {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  RawSqlSavedChartConfig,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  MetricsDataType,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

import type { ChartEditorFormState } from '../types';
import {
  convertFormStateToChartConfig,
  convertFormStateToSavedChartConfig,
  convertSavedChartConfigToFormState,
  validateChartForm,
} from '../utils';

jest.mock('../../SearchInput', () => ({
  getStoredLanguage: jest.fn().mockReturnValue('lucene'),
}));

const dateRange: [Date, Date] = [
  new Date('2024-01-01'),
  new Date('2024-01-02'),
];

const logSource: TSource = {
  id: 'source-log',
  name: 'Log Source',
  kind: SourceKind.Log,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Body, SeverityText',
  implicitColumnExpression: 'Body',
};

const metricSource: TMetricSource = {
  id: 'source-metric',
  name: 'Metric Source',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: { gauge: 'gauge_table' } as TMetricSource['metricTables'],
  resourceAttributesExpression: 'ResourceAttributes',
};

const seriesItem = {
  aggFn: 'count' as const,
  valueExpression: '*',
  aggCondition: '',
  aggConditionLanguage: 'lucene' as const,
};

describe('convertFormStateToSavedChartConfig', () => {
  it('returns undefined when no source and configType is not sql', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
    };
    expect(convertFormStateToSavedChartConfig(form, undefined)).toBeUndefined();
  });

  it('returns RawSqlSavedChartConfig for sql+table config', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Table,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      name: 'My Chart',
      series: [],
    };
    const result = convertFormStateToSavedChartConfig(form, undefined);
    expect(result).toEqual({
      configType: 'sql',
      displayType: DisplayType.Table,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      name: 'My Chart',
    });
  });

  it('returns a raw SQL config for Line displayType', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Line,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      series: [],
    };
    const result = convertFormStateToSavedChartConfig(form, undefined);
    expect(result).toEqual({
      configType: 'sql',
      displayType: DisplayType.Line,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
    });
  });

  it('returns undefined for sql config with an unsupported displayType', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Markdown,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
      series: [],
    };
    expect(convertFormStateToSavedChartConfig(form, undefined)).toBeUndefined();
  });

  it('uses sqlTemplate empty string as default when undefined', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Table,
      series: [],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      undefined,
    ) as RawSqlSavedChartConfig;
    expect(result.sqlTemplate).toBe('');
    expect(result.connection).toBe('');
  });

  it('maps series to select for builder config', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      where: 'status = 200',
      series: [seriesItem],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(result.select).toEqual([seriesItem]);
    expect('series' in result).toBe(false);
    expect(result.source).toBe('source-log');
  });

  it('uses form.select string for Search displayType', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Search,
      select: 'Body, SeverityText',
      series: [seriesItem],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(result.select).toBe('Body, SeverityText');
    expect('series' in result).toBe(false);
  });

  it('uses empty string for Search displayType when select is not a string', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Search,
      select: [seriesItem],
      series: [],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(result.select).toBe('');
    expect('series' in result).toBe(false);
  });

  it('strips metricName and metricType from select for non-metric source', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [
        {
          ...seriesItem,
          metricName: 'cpu.usage',
          metricType: 'gauge' as any,
        },
      ],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    const select = result.select as (typeof seriesItem)[];
    expect(select[0]).not.toHaveProperty('metricName');
    expect(select[0]).not.toHaveProperty('metricType');
  });

  it('preserves form metricTables for metric source', () => {
    const formMetricTables = {
      gauge: 'gauge_table',
    } as BuilderSavedChartConfig['metricTables'];
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
      metricTables: formMetricTables,
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      metricSource,
    ) as BuilderSavedChartConfig;
    expect(result.metricTables).toEqual(formMetricTables);
  });

  it('strips metricTables for non-metric source', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
      metricTables: { gauge: 'gauge_table' } as any,
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(result.metricTables).toBeUndefined();
  });

  it('preserves having and orderBy only for Table displayType', () => {
    const having = 'count > 5';
    const orderBy = [
      {
        aggFn: 'count',
        valueExpression: '*',
        aggCondition: '',
        ordering: 'DESC' as const,
      },
    ];
    const form: ChartEditorFormState = {
      displayType: DisplayType.Table,
      series: [seriesItem],
      having,
      orderBy,
    };
    const tableResult = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(tableResult.having).toBe(having);
    expect(tableResult.orderBy).toEqual(orderBy);

    const lineResult = convertFormStateToSavedChartConfig(
      { ...form, displayType: DisplayType.Line },
      logSource,
    ) as BuilderSavedChartConfig;
    expect(lineResult.having).toBeUndefined();
    expect(lineResult.orderBy).toBeUndefined();
  });

  it('defaults where to empty string when undefined', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
    };
    const result = convertFormStateToSavedChartConfig(
      form,
      logSource,
    ) as BuilderSavedChartConfig;
    expect(result.where).toBe('');
  });
});

describe('convertFormStateToChartConfig', () => {
  it('returns undefined when no source and configType is not sql', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
    };
    expect(
      convertFormStateToChartConfig(form, dateRange, undefined),
    ).toBeUndefined();
  });

  it('returns RawSqlChartConfig with dateRange for sql config', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Table,
      sqlTemplate: 'SELECT now()',
      connection: 'conn-1',
      series: [],
    };
    const result = convertFormStateToChartConfig(form, dateRange, undefined);
    expect(result).toMatchObject({
      configType: 'sql',
      sqlTemplate: 'SELECT now()',
      connection: 'conn-1',
      displayType: DisplayType.Table,
      dateRange,
    });
  });

  it('returns builder config with source fields merged', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      where: 'status = 200',
      series: [seriesItem],
    };
    const result = convertFormStateToChartConfig(form, dateRange, logSource);
    expect(result).toMatchObject({
      from: logSource.from,
      timestampValueExpression: logSource.timestampValueExpression,
      connection: logSource.connection,
      implicitColumnExpression: logSource.implicitColumnExpression,
      dateRange,
      where: 'status = 200',
    });
  });

  it('falls back to defaultTableSelectExpression when series is empty', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [],
    };
    const result = convertFormStateToChartConfig(
      form,
      dateRange,
      logSource,
    ) as BuilderChartConfig;
    expect(result?.select).toBe(logSource.defaultTableSelectExpression);
  });

  it('uses series as select for non-Search displayType', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Line,
      series: [seriesItem],
    };
    const result = convertFormStateToChartConfig(
      form,
      dateRange,
      logSource,
    ) as BuilderChartConfig;
    expect(result?.select).toEqual([seriesItem]);
  });

  it('uses form.select for Search displayType', () => {
    const form: ChartEditorFormState = {
      displayType: DisplayType.Search,
      select: 'Body',
      series: [],
    };
    const result = convertFormStateToChartConfig(
      form,
      dateRange,
      logSource,
    ) as BuilderChartConfig;
    expect(result?.select).toBe('Body');
  });
});

describe('convertSavedChartConfigToFormState', () => {
  it('sets configType to sql for RawSqlSavedChartConfig', () => {
    const config: RawSqlSavedChartConfig = {
      configType: 'sql',
      displayType: DisplayType.Table,
      sqlTemplate: 'SELECT 1',
      connection: 'conn-1',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.configType).toBe('sql');
    expect(result.series).toEqual([]);
  });

  it('sets configType to builder for BuilderSavedChartConfig', () => {
    const config: BuilderSavedChartConfig = {
      source: 'source-1',
      displayType: DisplayType.Line,
      select: [seriesItem],
      where: '',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.configType).toBe('builder');
  });

  it('maps array select to series with aggConditionLanguage defaulted', () => {
    const selectItem = {
      aggFn: 'count' as const,
      valueExpression: '*',
      aggCondition: '',
    };
    const config: BuilderSavedChartConfig = {
      source: 'source-1',
      select: [selectItem],
      where: '',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].aggConditionLanguage).toBe('lucene');
  });

  it('preserves existing aggConditionLanguage when already set', () => {
    const config: BuilderSavedChartConfig = {
      source: 'source-1',
      select: [{ ...seriesItem, aggConditionLanguage: 'sql' as const }],
      where: '',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.series[0].aggConditionLanguage).toBe('sql');
  });

  it('sets series to empty array when select is a string', () => {
    const config: BuilderSavedChartConfig = {
      source: 'source-1',
      select: 'Body, SeverityText',
      where: '',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.series).toEqual([]);
  });

  it('preserves other config fields in the form state', () => {
    const config: BuilderSavedChartConfig = {
      source: 'source-1',
      name: 'My Chart',
      displayType: DisplayType.Table,
      select: [seriesItem],
      where: 'status = 200',
    };
    const result = convertSavedChartConfigToFormState(config);
    expect(result.name).toBe('My Chart');
    expect(result.displayType).toBe(DisplayType.Table);
    expect(result.where).toBe('status = 200');
  });
});

describe('validateChartForm', () => {
  const metricSeriesItem = {
    ...seriesItem,
    metricType: MetricsDataType.Gauge,
    metricName: 'cpu.usage',
  };

  const makeForm = (
    overrides: Partial<ChartEditorFormState>,
  ): ChartEditorFormState => ({
    displayType: DisplayType.Line,
    series: [seriesItem],
    ...overrides,
  });

  // ── Valid forms (no errors) ──────────────────────────────────────────

  it('returns no errors for a valid builder chart with a source', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({ source: 'source-log' }),
      logSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for a valid raw SQL chart', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Table,
        sqlTemplate: 'SELECT 1',
        connection: 'conn-1',
      }),
      undefined,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for a Markdown chart without source', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({ displayType: DisplayType.Markdown }),
      undefined,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for a Number chart with exactly one series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Number,
        source: 'source-log',
        series: [seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for a Pie chart with exactly one series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Pie,
        source: 'source-log',
        series: [seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for a Search chart (skips series validation)', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Search,
        source: 'source-log',
        series: [],
      }),
      logSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for count aggFn without valueExpression', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        source: 'source-log',
        series: [{ ...seriesItem, aggFn: 'count', valueExpression: '' }],
      }),
      logSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns no errors for metric series where all items have metricName', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({ source: 'source-metric', series: [metricSeriesItem] }),
      metricSource,
      setError,
    );
    expect(errors).toHaveLength(0);
    expect(setError).not.toHaveBeenCalled();
  });

  // ── Raw SQL validation ───────────────────────────────────────────────

  it('errors when raw SQL chart is missing connection', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Table,
        sqlTemplate: 'SELECT 1',
        connection: '',
      }),
      undefined,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'connection' }),
    );
    expect(setError).toHaveBeenCalledWith('connection', {
      type: 'manual',
      message: 'Connection is required',
    });
  });

  it('errors when raw SQL chart is missing sqlTemplate', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Line,
        sqlTemplate: '',
        connection: 'conn-1',
      }),
      undefined,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'sqlTemplate' }),
    );
    expect(setError).toHaveBeenCalledWith('sqlTemplate', {
      type: 'manual',
      message: 'SQL query is required',
    });
  });

  it('does not check connection/sqlTemplate for non-sql configType', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'builder',
        displayType: DisplayType.Line,
        source: 'source-log',
      }),
      logSource,
      setError,
    );
    expect(
      errors.filter(e => e.path === 'connection' || e.path === 'sqlTemplate'),
    ).toHaveLength(0);
  });

  // ── Source validation ────────────────────────────────────────────────

  it('errors when builder chart has no source', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({ source: undefined }),
      logSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'source',
        message: 'Source is required',
      }),
    );
  });

  it('does not require source for Markdown charts', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({ displayType: DisplayType.Markdown, source: undefined }),
      undefined,
      setError,
    );
    expect(errors.filter(e => e.path === 'source')).toHaveLength(0);
  });

  it('does not require source for raw SQL charts', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Table,
        sqlTemplate: 'SELECT 1',
        connection: 'conn-1',
        source: undefined,
      }),
      undefined,
      setError,
    );
    expect(errors.filter(e => e.path === 'source')).toHaveLength(0);
  });

  // ── Series valueExpression validation ────────────────────────────────

  it('errors when a non-count aggFn series is missing valueExpression', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        source: 'source-log',
        series: [{ ...seriesItem, aggFn: 'sum', valueExpression: '' }],
      }),
      logSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'series.0.valueExpression',
        message: 'Expression is required for series 1',
      }),
    );
  });

  it('errors for each series missing valueExpression with non-count aggFn', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        source: 'source-log',
        series: [
          { ...seriesItem, aggFn: 'avg', valueExpression: '' },
          { ...seriesItem, aggFn: 'max', valueExpression: '' },
        ],
      }),
      logSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.0.valueExpression' }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.1.valueExpression' }),
    );
  });

  it('does not error for count aggFn even without valueExpression', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        source: 'source-log',
        series: [{ ...seriesItem, aggFn: 'count', valueExpression: '' }],
      }),
      logSource,
      setError,
    );
    expect(
      errors.filter(e => e.path === 'series.0.valueExpression'),
    ).toHaveLength(0);
  });

  it('does not validate valueExpression for Search displayType', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Search,
        source: 'source-log',
        series: [{ ...seriesItem, aggFn: 'sum', valueExpression: '' }],
      }),
      logSource,
      setError,
    );
    expect(
      errors.filter(
        e => typeof e.path === 'string' && e.path.includes('valueExpression'),
      ),
    ).toHaveLength(0);
  });

  it('does not validate valueExpression for Markdown displayType', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Markdown,
        source: 'source-log',
        series: [{ ...seriesItem, aggFn: 'sum', valueExpression: '' }],
      }),
      logSource,
      setError,
    );
    expect(
      errors.filter(
        e => typeof e.path === 'string' && e.path.includes('valueExpression'),
      ),
    ).toHaveLength(0);
  });

  // ── Metric name validation ───────────────────────────────────────────

  it('errors for each metric series item missing metricName', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const errors = validateChartForm(
      makeForm({
        source: 'source-metric',
        series: [seriesWithoutName, seriesWithoutName],
      }),
      metricSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.0.metricName' }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.1.metricName' }),
    );
  });

  it('only errors on metric series items that are missing metricName', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const errors = validateChartForm(
      makeForm({
        source: 'source-metric',
        series: [metricSeriesItem, seriesWithoutName],
      }),
      metricSource,
      setError,
    );
    expect(errors.filter(e => e.path === 'series.0.metricName')).toHaveLength(
      0,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.1.metricName' }),
    );
  });

  it('skips metric validation for non-metric sources', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const errors = validateChartForm(
      makeForm({ source: 'source-log', series: [seriesWithoutName] }),
      logSource,
      setError,
    );
    expect(
      errors.filter(
        e => typeof e.path === 'string' && e.path.includes('metricName'),
      ),
    ).toHaveLength(0);
  });

  it('skips metric validation when source is undefined', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const errors = validateChartForm(
      makeForm({ series: [seriesWithoutName] }),
      undefined,
      setError,
    );
    expect(
      errors.filter(
        e => typeof e.path === 'string' && e.path.includes('metricName'),
      ),
    ).toHaveLength(0);
  });

  // ── Number / Pie single-series validation ────────────────────────────

  it('errors when Number chart has more than one series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Number,
        source: 'source-log',
        series: [seriesItem, seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'series',
        message: `Only one series is allowed for ${DisplayType.Number} charts`,
      }),
    );
  });

  it('errors when Pie chart has more than one series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Pie,
        source: 'source-log',
        series: [seriesItem, seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'series',
        message: `Only one series is allowed for ${DisplayType.Pie} charts`,
      }),
    );
  });

  it('does not error for Line chart with multiple series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Line,
        source: 'source-log',
        series: [seriesItem, seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors.filter(e => e.path === 'series')).toHaveLength(0);
  });

  it('does not error for Table chart with multiple series', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Table,
        source: 'source-log',
        series: [seriesItem, seriesItem],
      }),
      logSource,
      setError,
    );
    expect(errors.filter(e => e.path === 'series')).toHaveLength(0);
  });

  it('does not apply single-series limit for raw SQL Number charts', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Number,
        sqlTemplate: 'SELECT 1',
        connection: 'conn-1',
        series: [seriesItem, seriesItem],
      }),
      undefined,
      setError,
    );
    expect(errors.filter(e => e.path === 'series')).toHaveLength(0);
  });

  // ── Multiple validation errors at once ───────────────────────────────

  it('accumulates multiple errors across different validation rules', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        displayType: DisplayType.Number,
        source: undefined,
        series: [
          { ...seriesItem, aggFn: 'sum', valueExpression: '' },
          { ...seriesItem, aggFn: 'avg', valueExpression: '' },
        ],
      }),
      logSource,
      setError,
    );
    // Should have: source error + 2 valueExpression errors + series count error
    expect(errors).toContainEqual(expect.objectContaining({ path: 'source' }));
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.0.valueExpression' }),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'series.1.valueExpression' }),
    );
    expect(errors).toContainEqual(expect.objectContaining({ path: 'series' }));
    expect(errors).toHaveLength(4);
  });

  it('calls setError for every accumulated error', () => {
    const setError = jest.fn();
    const errors = validateChartForm(
      makeForm({
        configType: 'sql',
        displayType: DisplayType.Table,
        connection: '',
        sqlTemplate: '',
      }),
      undefined,
      setError,
    );
    // connection (required type) + sqlTemplate (required type) setError calls,
    // then both are also called again with 'manual' type in the final loop
    expect(errors).toHaveLength(2);
    // Each error in the array triggers setError in the final loop
    expect(setError).toHaveBeenCalledWith(
      'connection',
      expect.objectContaining({ type: 'manual' }),
    );
    expect(setError).toHaveBeenCalledWith(
      'sqlTemplate',
      expect.objectContaining({ type: 'manual' }),
    );
  });
});
