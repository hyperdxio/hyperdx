import { omit, pick } from 'lodash';
import { Path, UseFormSetError } from 'react-hook-form';
import { validateRawSqlForAlert } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderSavedChartConfig,
  ChartConfigWithDateRange,
  DisplayType,
  getSampleWeightExpression,
  isLogSource,
  isMetricSource,
  isRangeThresholdType,
  isTraceSource,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { getStoredLanguage } from '../SearchInput';

import { ChartEditorFormState } from './types';

function normalizeChartConfig<
  C extends Pick<
    BuilderSavedChartConfig,
    'select' | 'having' | 'orderBy' | 'displayType' | 'metricTables'
  >,
>(config: C, source: TSource): C {
  const isMetricSource = source.kind === SourceKind.Metric;
  return {
    ...config,
    // Strip out metric-specific fields for non-metric sources
    select:
      !isMetricSource && Array.isArray(config.select)
        ? config.select.map(s => omit(s, ['metricName', 'metricType']))
        : config.select,
    metricTables: isMetricSource ? config.metricTables : undefined,
    // Order By and Having can only be set by the user for table charts
    having:
      config.displayType === DisplayType.Table ? config.having : undefined,
    orderBy:
      config.displayType === DisplayType.Table ? config.orderBy : undefined,
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
      configType: 'sql',
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'alert',
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
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
      from: source?.from,
      implicitColumnExpression:
        source && (isLogSource(source) || isTraceSource(source))
          ? source.implicitColumnExpression
          : undefined,
      metricTables:
        source && isMetricSource(source) ? source.metricTables : undefined,
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
      from: source.from,
      timestampValueExpression: source.timestampValueExpression,
      dateRange,
      connection: source.connection,
      implicitColumnExpression:
        isLogSource(source) || isTraceSource(source)
          ? source.implicitColumnExpression
          : undefined,
      sampleWeightExpression: getSampleWeightExpression(source),
      metricTables: isMetricSource(source) ? source.metricTables : undefined,
      where: form.where ?? '',
      select: isSelectEmpty
        ? ((isLogSource(source) || isTraceSource(source)) &&
            source.defaultTableSelectExpression) ||
          ''
        : mergedSelect,
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
    source?.kind !== SourceKind.Metric &&
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

  // Validate metric names for metric sources
  if (
    source?.kind === SourceKind.Metric &&
    Array.isArray(form.series) &&
    form.displayType !== DisplayType.Markdown &&
    form.displayType !== DisplayType.Search &&
    !isRawSqlChart
  ) {
    form.series.forEach((s, index) => {
      if (s.metricType && !s.metricName) {
        errors.push({
          path: `series.${index}.metricName`,
          message: `Metric is required`,
        });
      }
    });
  }

  // Validate raw SQL alert has required time filters and interval parameters
  if (isRawSqlChart && form.alert) {
    const config = {
      configType: 'sql',
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      from: source?.from,
      displayType: form.displayType,
    } satisfies RawSqlChartConfig;
    const { errors: alertErrors } = validateRawSqlForAlert(config);
    if (alertErrors.length > 0) {
      errors.push({
        path: `sqlTemplate`,
        message: alertErrors.join('. '),
      });
    }
  }

  // Validate thresholdMax for range threshold types (between / not between)
  if (form.alert && isRangeThresholdType(form.alert.thresholdType)) {
    if (form.alert.thresholdMax == null) {
      errors.push({
        path: 'alert.thresholdMax',
        message:
          'Upper bound is required for between/not between threshold types',
      });
    } else if (form.alert.thresholdMax < form.alert.threshold) {
      errors.push({
        path: 'alert.thresholdMax',
        message:
          'Alert threshold upper bound must be greater than or equal to the lower bound',
      });
    }
  }

  // Validate number and pie charts only have one series
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    (form.displayType === DisplayType.Number ||
      form.displayType === DisplayType.Pie) &&
    form.series.length > 1
  ) {
    errors.push({
      path: `series`,
      message: `Only one series is allowed for ${form.displayType} charts`,
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
