import { omit, pick } from 'lodash';
import { FieldPath } from 'react-hook-form';
import {
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BuilderSavedChartConfig,
  ChartConfigWithDateRange,
  DisplayType,
  isLogSource,
  isMetricSource,
  isTraceSource,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { getStoredLanguage } from '../SearchInput';

import { ChartEditorFormState, SavedChartConfigWithSelectArray } from './types';

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
  | DisplayType.StackedBar =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar;

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
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
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

// Helper function to safely construct field paths for series
export const getSeriesFieldPath = (
  namePrefix: string,
  fieldName: string,
): FieldPath<ChartEditorFormState> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return `${namePrefix}${fieldName}` as FieldPath<ChartEditorFormState>;
};

// Helper function to validate metric names for metric sources
export const validateMetricNames = (
  tableSource: TSource | undefined,
  series: SavedChartConfigWithSelectArray['select'] | undefined,
  displayType: DisplayType | undefined,
  setError: (
    name: FieldPath<ChartEditorFormState>,
    error: { type: string; message: string },
  ) => void,
): boolean => {
  if (
    tableSource?.kind === SourceKind.Metric &&
    Array.isArray(series) &&
    displayType !== DisplayType.Markdown
  ) {
    let hasValidationError = false;
    series.forEach((s, index) => {
      if (s.metricType && !s.metricName) {
        setError(getSeriesFieldPath(`series.${index}.`, 'metricName'), {
          type: 'manual',
          message: 'Please select a metric name',
        });
        hasValidationError = true;
      }
    });
    return hasValidationError;
  }
  return false;
};
