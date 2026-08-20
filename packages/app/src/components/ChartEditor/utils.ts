import { omit, pick } from 'lodash';
import { Path, UseFormSetError } from 'react-hook-form';
import { validateFormula } from '@hyperdx/common-utils/dist/core/formula';
import { validateRawSqlForAlert } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderSavedChartConfig,
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import { MACRO_SUGGESTIONS } from '@hyperdx/common-utils/dist/macros';
import { QUERY_PARAMS_BY_DISPLAY_TYPE } from '@hyperdx/common-utils/dist/rawSqlParams';
import {
  BuilderSavedChartConfig,
  ChartConfigWithDateRange,
  ChartVariable,
  DisplayType,
  getSampleWeightExpression,
  isLogSource,
  isMetricSource,
  isRangeThresholdType,
  isTraceSource,
  PromqlChartConfig,
  PromqlSavedChartConfig,
  RawSqlChartConfig,
  RawSqlSavedChartConfig,
  SavedChartConfig,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { getStoredLanguage } from '@/components/SearchInput';
import { type SQLCompletion } from '@/components/SQLEditor/utils';
import {
  buildVariableCompletions,
  toMacroCompletion,
} from '@/components/SQLEditor/variableCompletions';
import { toAlertChannels } from '@/utils/alerts';

import { ChartEditorFormState } from './types';

/**
 * Autocomplete entries offered on top of columns/keywords in the raw SQL
 * editor: query params, macros, and variables (when available).
 */
export function buildRawSqlCompletions({
  displayType,
  variables,
}: {
  displayType: DisplayType | undefined;
  variables: ChartVariable[] | undefined;
}): SQLCompletion[] {
  const effectiveDisplayType = displayType ?? DisplayType.Table;
  const params = QUERY_PARAMS_BY_DISPLAY_TYPE[effectiveDisplayType];

  const paramCompletions: SQLCompletion[] = params.map(
    ({ name, type, description }) => ({
      label: `{${name}:${type}}`,
      apply: `{${name}:${type}}`,
      detail: 'param',
      info: description,
      type: 'variable',
    }),
  );

  return [
    ...paramCompletions,
    ...MACRO_SUGGESTIONS.map(toMacroCompletion),
    ...buildVariableCompletions(variables),
  ];
}

function normalizeChartConfig<
  C extends Pick<
    BuilderSavedChartConfig,
    | 'select'
    | 'having'
    | 'orderBy'
    | 'displayType'
    | 'metricTables'
    | 'onClick'
    | 'formulas'
    | 'showOperandSeries'
  >,
>(config: C, source: TSource): C {
  const isMetricSource = source.kind === SourceKind.Metric;
  // Formulas (HDX-5080) render on metric and event (log/trace) sources, and
  // only on the display types the formula query paths support (time series /
  // table / number). Strip them elsewhere so a source or display-type switch
  // can't persist a config the renderer would reject. The form state keeps
  // them, so switching back restores the formula rows.
  const keepFormulas =
    isFormulaSourceKind(source.kind) &&
    (config.formulas?.length ?? 0) > 0 &&
    isFormulaDisplayType(config.displayType);
  return {
    ...config,
    // Strip out metric-specific fields for non-metric sources
    select:
      !isMetricSource && Array.isArray(config.select)
        ? config.select.map(s => omit(s, ['metricName', 'metricType']))
        : config.select,
    metricTables: isMetricSource ? config.metricTables : undefined,
    formulas: keepFormulas ? config.formulas : undefined,
    // Number charts display the first value column, so the operand series
    // are always hidden there (persisted explicitly so the saved tile config
    // is self-describing; convertToNumberChartConfig enforces the same at
    // render time). Other display types keep the tile's own toggle value.
    showOperandSeries: keepFormulas
      ? config.displayType === DisplayType.Number
        ? false
        : config.showOperandSeries
      : undefined,
    // Order By and Having can only be set by the user for table charts
    having:
      config.displayType === DisplayType.Table ? config.having : undefined,
    orderBy: isCustomOrderByDisplayType(config.displayType)
      ? config.orderBy
      : undefined,
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
  | DisplayType.Bar
  | DisplayType.Number =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar ||
  displayType === DisplayType.Pie ||
  displayType === DisplayType.Bar ||
  displayType === DisplayType.Number;

/**
 * Display types that store `select` as a plain string (column expression)
 * rather than a structured `DerivedColumn[]` series array. These types
 * don't use the builder series editor and skip series-level validation.
 */
export const isStringSelectDisplayType = (
  displayType: DisplayType | undefined,
): displayType is DisplayType.Search | DisplayType.EventPatterns =>
  displayType === DisplayType.Search ||
  displayType === DisplayType.EventPatterns;

export const isPromqlDisplayType = (
  displayType: DisplayType | undefined,
): displayType is
  | DisplayType.Table
  | DisplayType.Line
  | DisplayType.StackedBar
  | DisplayType.Pie
  | DisplayType.Bar
  | DisplayType.Number =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar ||
  displayType === DisplayType.Pie ||
  displayType === DisplayType.Bar ||
  displayType === DisplayType.Number;

const isCustomOrderByDisplayType = (
  displayType: DisplayType | undefined,
): displayType is DisplayType.Table | DisplayType.Bar | DisplayType.Pie =>
  displayType === DisplayType.Table ||
  displayType === DisplayType.Bar ||
  displayType === DisplayType.Pie;

/**
 * Display types that can carry formulas (HDX-5080) — the shapes the formula
 * query paths render (composed multi-series for metrics, inline single-scan
 * for events). Mirrors the "Add Formula" gating in ChartEditorControls.
 */
export const isFormulaDisplayType = (
  displayType: DisplayType | undefined,
): displayType is
  | DisplayType.Line
  | DisplayType.StackedBar
  | DisplayType.Table
  | DisplayType.Number =>
  displayType === DisplayType.Line ||
  displayType === DisplayType.StackedBar ||
  displayType === DisplayType.Table ||
  displayType === DisplayType.Number;

/**
 * Source kinds that can carry formulas: metric sources (rendered via the
 * composed multi-series metric query) and event sources (log/trace, compiled
 * inline in the single-scan SELECT — see renderSelectListWithFormulas in
 * common-utils).
 */
export const isFormulaSourceKind = (
  kind: SourceKind | undefined,
): kind is SourceKind.Metric | SourceKind.Log | SourceKind.Trace =>
  kind === SourceKind.Metric ||
  kind === SourceKind.Log ||
  kind === SourceKind.Trace;

export function convertFormStateToSavedChartConfig(
  form: ChartEditorFormState,
  source: TSource | undefined,
): SavedChartConfig | undefined {
  if (form.configType === 'promql' && isPromqlDisplayType(form.displayType)) {
    const promqlConfig: PromqlSavedChartConfig = {
      configType: 'promql',
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'color',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'alternateRowBackground',
        // 'alert', // TODO: Support alerts on PromQL (HDX-4636)
      ]),
      promqlExpression: form.promqlExpression ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
    };

    return promqlConfig;
  }

  if (form.configType === 'sql' && isRawSqlDisplayType(form.displayType)) {
    const rawSqlConfig: RawSqlSavedChartConfig = {
      configType: 'sql',
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'color',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'alternateRowBackground',
        // Per-tile render cap for raw SQL time charts (drives the client-side
        // series cap in formatResponseForTimeChart). See
        // SharedChartSettingsSchema.seriesLimit.
        'seriesLimit',
        'alert',
        'onClick',
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
    };
    return rawSqlConfig;
  }

  if (form.displayType === DisplayType.Markdown) {
    const config: BuilderSavedChartConfig = {
      ...omit(form, ['series', 'configType', 'sqlTemplate']),
      select: [],
      where: form.where ?? '',
      source: source?.id ?? form.source ?? '',
    };
    return config;
  }

  if (source) {
    // Merge the series and select fields back together, and prevent the series field from being submitted
    const config: BuilderSavedChartConfig = {
      ...omit(form, ['series', 'configType', 'sqlTemplate']),
      select: isStringSelectDisplayType(form.displayType)
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
  if (form.configType === 'promql' && isPromqlDisplayType(form.displayType)) {
    const promqlConfig: PromqlChartConfig = {
      configType: 'promql',
      ...pick(form, [
        'displayType',
        'numberFormat',
        'color',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'alternateRowBackground',
      ]),
      promqlExpression: form.promqlExpression ?? '',
      connection: source?.connection ?? form.connection ?? '',
      source: form.source || undefined,
      from: source?.from,
    };

    return { ...promqlConfig, dateRange };
  }

  if (form.configType === 'sql' && isRawSqlDisplayType(form.displayType)) {
    const rawSqlConfig: RawSqlChartConfig = {
      configType: 'sql',
      ...pick(form, [
        'name',
        'displayType',
        'numberFormat',
        'color',
        'granularity',
        'compareToPreviousPeriod',
        'fillNulls',
        'alignDateRangeToGranularity',
        'alternateRowBackground',
        // Per-tile render cap for raw SQL time charts (see the save-config path
        // above and SharedChartSettingsSchema.seriesLimit).
        'seriesLimit',
        'onClick',
      ]),
      sqlTemplate: form.sqlTemplate ?? '',
      connection: form.connection ?? '',
      source: form.source || undefined,
      from: source?.from,
      implicitColumnExpression:
        source && (isLogSource(source) || isTraceSource(source))
          ? source.implicitColumnExpression
          : undefined,
      // Body expression is only populated for log sources; trace sources use
      // `spanNameExpression` for display, which has a different semantic for
      // bare-text search and should not auto-fall-back.
      bodyExpression:
        source && isLogSource(source) ? source.bodyExpression : undefined,
      useTextIndexForImplicitColumn:
        source && (isLogSource(source) || isTraceSource(source))
          ? source.useTextIndexForImplicitColumn
          : undefined,
      metricTables:
        source && isMetricSource(source) ? source.metricTables : undefined,
    };

    return { ...rawSqlConfig, dateRange };
  }

  if (source) {
    // Merge the series and select fields back together, and prevent the series field from being submitted.
    const mergedSelect = isStringSelectDisplayType(form.displayType)
      ? form.select
      : form.series;
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
      // Logs-only body fallback (see comment above for raw-sql config).
      bodyExpression: isLogSource(source) ? source.bodyExpression : undefined,
      useTextIndexForImplicitColumn:
        isLogSource(source) || isTraceSource(source)
          ? source.useTextIndexForImplicitColumn
          : undefined,
      sampleWeightExpression: getSampleWeightExpression(source),
      metricTables: isMetricSource(source) ? source.metricTables : undefined,
      where: form.where ?? '',
      // When select is empty, the fallback differs by display type:
      //   - EventPatterns: keep '' — the pattern-mining code resolves the
      //     body expression from the source at render time. Using
      //     defaultTableSelectExpression here would inject multi-column
      //     search-table columns (e.g. SeverityText) that don't belong in
      //     a single-expression pattern field.
      //   - Search: fall back to defaultTableSelectExpression — the
      //     multi-column list is exactly what the search results table needs.
      select: isSelectEmpty
        ? form.displayType === DisplayType.EventPatterns
          ? ''
          : ((isLogSource(source) || isTraceSource(source)) &&
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
    // Normalise the alert's channels up front: tile alerts saved before
    // multi-channel support only carry the singular `channel`. Clearing it
    // here keeps a stale value from being submitted alongside an edited list.
    ...(config.alert != null && {
      alert: {
        ...config.alert,
        channel: undefined,
        channels: toAlertChannels(config.alert),
      },
    }),
    configType: isPromqlSavedChartConfig(config)
      ? 'promql'
      : isRawSqlSavedChartConfig(config)
        ? 'sql'
        : 'builder',
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

  // Validate that valueExpressions are specified for each series.
  // String-select display types (Search, EventPatterns) don't use the
  // series array, so skip them.
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    source?.kind !== SourceKind.Metric &&
    form.displayType !== DisplayType.Markdown &&
    !isStringSelectDisplayType(form.displayType)
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

  // Validate formulas (HDX-5080) with the structured validator the query
  // renderer uses, so a bad expression is caught here rather than at render
  // time. Only applies where formulas survive normalization (formula-capable
  // source kind + display type).
  if (
    !isRawSqlChart &&
    isFormulaSourceKind(source?.kind) &&
    isFormulaDisplayType(form.displayType) &&
    Array.isArray(form.formulas)
  ) {
    const seriesCount = Array.isArray(form.series) ? form.series.length : 0;
    form.formulas.forEach((formula, index) => {
      const result = validateFormula(formula.expression ?? '', {
        seriesCount,
      });
      if (!result.ok) {
        errors.push({
          path: `formulas.${index}.expression`,
          message: result.errors.map(e => e.message).join('; '),
        });
      }
    });

    // A number chart displays a single value — its one formula. Multiple
    // formulas can only get here by switching an existing multi-formula
    // chart to the Number display type (the editor hides "Add Formula" once
    // a Number tile has one); block rather than silently dropping one.
    if (form.displayType === DisplayType.Number && form.formulas.length > 1) {
      errors.push({
        path: `formulas`,
        message: 'Number charts support a single formula',
      });
    }
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
        message: alertErrors.join(' '),
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

  // Validate pie, bar, and heatmap charts only have one series
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    (form.displayType === DisplayType.Pie ||
      form.displayType === DisplayType.Bar ||
      form.displayType === DisplayType.Heatmap) &&
    form.series.length > 1
  ) {
    errors.push({
      path: `series`,
      message: `Only one series is allowed for ${form.displayType} charts`,
    });
  }

  // Number charts allow a second series only for ratio mode (numerator /
  // denominator, which can be shown as a percentage via the number format);
  // otherwise they show a single value. With formulas the extra series are
  // operands (e.g. A / (A + B + C)), so the cap doesn't apply.
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    form.displayType === DisplayType.Number &&
    !(form.formulas?.length && isFormulaSourceKind(source?.kind)) &&
    form.series.length > (form.seriesReturnType === 'ratio' ? 2 : 1)
  ) {
    errors.push({
      path: `series`,
      message:
        form.seriesReturnType === 'ratio'
          ? 'Number charts support at most two series (ratio mode)'
          : 'Number charts support a single series unless ratio mode (As Ratio) is enabled',
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
