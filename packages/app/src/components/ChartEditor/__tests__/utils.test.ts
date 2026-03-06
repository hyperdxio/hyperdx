import type {
  BuilderChartConfig,
  BuilderSavedChartConfig,
  RawSqlSavedChartConfig,
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
  validateMetricNames,
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

const metricSource: TSource = {
  id: 'source-metric',
  name: 'Metric Source',
  kind: SourceKind.Metric,
  connection: 'conn-1',
  from: { databaseName: 'db', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: { gauge: 'gauge_table' } as TSource['metricTables'],
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

  it('returns undefined for sql config without Table displayType', () => {
    const form: ChartEditorFormState = {
      configType: 'sql',
      displayType: DisplayType.Line,
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

describe('validateMetricNames', () => {
  const metricSeriesItem = {
    ...seriesItem,
    metricType: MetricsDataType.Gauge,
    metricName: 'cpu.usage',
  };

  it('returns false when tableSource is undefined', () => {
    const setError = jest.fn();
    const result = validateMetricNames(
      undefined,
      [metricSeriesItem],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false when tableSource is not a metric source', () => {
    const setError = jest.fn();
    const result = validateMetricNames(
      logSource,
      [metricSeriesItem],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false when series is undefined', () => {
    const setError = jest.fn();
    const result = validateMetricNames(
      metricSource,
      undefined,
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false when displayType is Markdown', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const result = validateMetricNames(
      metricSource,
      [seriesWithoutName],
      DisplayType.Markdown,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false when all series items with metricType have a metricName', () => {
    const setError = jest.fn();
    const result = validateMetricNames(
      metricSource,
      [metricSeriesItem],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false when series items have no metricType', () => {
    const setError = jest.fn();
    const result = validateMetricNames(
      metricSource,
      [seriesItem],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns true and calls setError when a series item has metricType but no metricName', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const result = validateMetricNames(
      metricSource,
      [seriesWithoutName],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('series.0.metricName', {
      type: 'manual',
      message: 'Please select a metric name',
    });
  });

  it('calls setError for each series item missing metricName', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const result = validateMetricNames(
      metricSource,
      [seriesWithoutName, seriesWithoutName],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(true);
    expect(setError).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenCalledWith(
      'series.0.metricName',
      expect.any(Object),
    );
    expect(setError).toHaveBeenCalledWith(
      'series.1.metricName',
      expect.any(Object),
    );
  });

  it('only errors on series items that are missing metricName', () => {
    const setError = jest.fn();
    const seriesWithoutName = {
      ...seriesItem,
      metricType: MetricsDataType.Gauge,
    };
    const result = validateMetricNames(
      metricSource,
      [metricSeriesItem, seriesWithoutName],
      DisplayType.Line,
      setError,
    );
    expect(result).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith(
      'series.1.metricName',
      expect.any(Object),
    );
  });
});
