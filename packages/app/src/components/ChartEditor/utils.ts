import { omit, pick } from 'lodash';
import { Path, UseFormSetError } from 'react-hook-form';
import {
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@berg/common-utils/dist/guards';
import {
  BuilderSavedChartConfig,
  ChartConfigWithDateRange,
  DisplayType,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  TSource,
} from '@berg/common-utils/dist/types';

import { getStoredLanguage } from '../SearchInput';

import { ChartEditorFormState } from './types';

function normalizeChartConfig<
  C extends Pick<
    BuilderSavedChartConfig,
    'select' | 'having' | 'orderBy' | 'displayType' | 'onClick'
  >,
>(config: C, _source: TSource): C {
  return {
    ...config,
    // Berg has no metric kinds; metric-name/metric-type stripping is a no-op.
    select: Array.isArray(config.select)
      ? config.select.map(s => omit(s, ['metricName', 'metricType']))
      : config.select,
    // Order By and Having can only be set by the user for table charts
    having:
      config.displayType === DisplayType.Table ? config.having : undefined,
    orderBy:
      config.displayType === DisplayType.Table ? config.orderBy : undefined,
    onClick:
      config.onClick && config.displayType === DisplayType.Table
        ? config.onClick
        : undefined,
  };
}

export const isRawSqlDisplayType = (
  displayType: DisplayType | undefined,
): displayType is
  | DisplayType.Table
  | DisplayType.Line
  | DisplayType.StackedBar
  | DisplayType.Pie
  | DisplayType.Number =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar ||
  displayType === DisplayType.Pie ||
  displayType === DisplayType.Number;

export function convertFormStateToSavedChartConfig(
  form: ChartEditorFormState,
  source: TSource | undefined,
): SavedChartConfig | undefined {
  if (form.configType === 'sql' && isRawSqlDisplayType(form.displayType)) {
    const rawSqlConfig: RawSqlSavedChartConfig = {
      configType: 'sql' as const,
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'onClick',
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
    };
    return rawSqlConfig;
  }

  if (source) {
    // Merge the series and select fields back together, and prevent the series field from being submitted
    const config: BuilderSavedChartConfig = {
      ...omit(form, ['series', 'configType', 'sqlTemplate']),
      // If the chart type is search, we need to ensure the select is a string
      select:
        form.displayType === DisplayType.Search
          ? typeof form.select === 'string'
            ? form.select
            : ''
          : form.series,
      where: form.where ?? '',
      source: source.id,
    };

    return normalizeChartConfig(config, source);
  }
}

export function convertFormStateToChartConfig(
  form: ChartEditorFormState,
  dateRange: ChartConfigWithDateRange['dateRange'],
  source: TSource | undefined,
): ChartConfigWithDateRange | undefined {
  if (form.configType === 'sql' && isRawSqlDisplayType(form.displayType)) {
    const rawSqlConfig: RawSqlChartConfig = {
      configType: 'sql',
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'onClick',
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
      from: source
        ? { databaseName: source.database, tableName: source.table }
        : undefined,
    };

    return { ...rawSqlConfig, dateRange };
  }

  if (source) {
    // Merge the series and select fields back together, and prevent the series field from being submitted
    const mergedSelect =
      form.displayType === DisplayType.Search ? form.select : form.series;
    const isSelectEmpty = !mergedSelect || mergedSelect.length === 0;

    const newConfig: ChartConfigWithDateRange = {
      ...omit(form, ['series', 'configType', 'sqlTemplate']),
      from: { databaseName: source.database, tableName: source.table },
      timestampValueExpression: source.timestampColumn ?? '',
      dateRange,
      connection: '',
      where: form.where ?? '',
      select: isSelectEmpty ? '*' : mergedSelect,
    };

    return structuredClone(normalizeChartConfig(newConfig, source));
  }
}

export function convertSavedChartConfigToFormState(
  config: SavedChartConfig,
): ChartEditorFormState {
  return {
    ...config,
    configType: isRawSqlSavedChartConfig(config) ? 'sql' : 'builder',
    series:
      isBuilderSavedChartConfig(config) && Array.isArray(config.select)
        ? config.select.map(s => ({
            ...s,
            aggConditionLanguage:
              s.aggConditionLanguage ?? getStoredLanguage() ?? 'lucene',
          }))
        : [],
  };
}

export const validateChartForm = (
  form: ChartEditorFormState,
  source: TSource | undefined,
  setError: UseFormSetError<ChartEditorFormState>,
) => {
  const errors: { path: Path<ChartEditorFormState>; message: string }[] = [];

  const isRawSqlChart =
    form.configType === 'sql' && isRawSqlDisplayType(form.displayType);

  // Validate connection is selected for raw SQL charts
  if (isRawSqlChart && !form.connection) {
    errors.push({ path: `connection`, message: 'Connection is required' });
  }

  // Validate SQL is provided for raw SQL charts
  if (isRawSqlChart && !form.sqlTemplate) {
    errors.push({ path: `sqlTemplate`, message: 'SQL query is required' });
  }

  // Validate source is selected for builder charts
  if (
    !isRawSqlChart &&
    form.displayType !== DisplayType.Markdown &&
    (!form.source || !source)
  ) {
    errors.push({ path: `source`, message: 'Source is required' });
  }

  // Validate that valueExpressions are specified for each series
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    form.displayType !== DisplayType.Markdown &&
    form.displayType !== DisplayType.Search
  ) {
    form.series.forEach((s, index) => {
      if (s.aggFn && s.aggFn !== 'count' && !s.valueExpression) {
        errors.push({
          path: `series.${index}.valueExpression`,
          message: `Expression is required for series ${index + 1}`,
        });
      }
    });
  }

  // Berg has no metric source kind, so metric-name validation is gone.
  void source;

  // Validate number, pie, and heatmap charts only have one series
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    (form.displayType === DisplayType.Number ||
      form.displayType === DisplayType.Pie ||
      form.displayType === DisplayType.Heatmap) &&
    form.series.length > 1
  ) {
    errors.push({
      path: `series`,
      message: `Only one series is allowed for ${form.displayType} charts`,
    });
  }

  // Validate heatmap requires a value expression
  if (
    !isRawSqlChart &&
    form.displayType === DisplayType.Heatmap &&
    Array.isArray(form.series) &&
    form.series.length > 0 &&
    !form.series[0]?.valueExpression
  ) {
    errors.push({
      path: `series.0.valueExpression`,
      message: 'Value expression is required for heatmap charts',
    });
  }

  for (const error of errors) {
    console.warn(`Validation error in field ${error.path}: ${error.message}`);
    setError(error.path, {
      type: 'manual',
      message: error.message,
    });
  }

  return errors;
};
