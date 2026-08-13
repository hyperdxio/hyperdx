import { omit, pick } from 'lodash';
import { Path, UseFormSetError } from 'react-hook-form';
import { validateRawSqlForAlert } from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderSavedChartConfig,
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  MACRO_SUGGESTIONS,
  MacroSuggestion,
  VARIABLE_MACRO_SUGGESTIONS,
} from '@hyperdx/common-utils/dist/macros';
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
import {
  substituteVariables,
  VARIABLE_FORMATS,
  VariableFormat,
} from '@hyperdx/common-utils/dist/variables';

import { getStoredLanguage } from '@/components/SearchInput';
import { type SQLCompletion } from '@/components/SQLEditor/utils';

import { ChartEditorFormState } from './types';

/** What each `${name:format}` renders, for the completion's help text. */
const VARIABLE_FORMAT_DESCRIPTIONS: Record<VariableFormat, string> = {
  sqlstring: "Quoted and comma-separated, escaped for SQL. e.g. 'a', 'b', 'c'",
  csv: 'Comma-separated and unquoted. Not SQL-escaped. e.g. a,b,c',
  regex: 'A regex alternation. Regex escaped. e.g. (a|b|c)',
  lucene: 'An OR of quoted terms, for Lucene inputs. e.g. ("a" OR "b" OR "c")',
};

/** What `snippet` expands to against the variable's current selection. */
function describeVariableExpansion(
  snippet: string,
  variable: ChartVariable,
): string | undefined {
  let expansion: string;
  try {
    expansion = substituteVariables(snippet, [variable]);
  } catch {
    return undefined;
  }
  return `Expands to: ${expansion === '' ? '(empty string)' : expansion}`;
}

/**
 * Completion help built as markup rather than a string, so `footnote` sits on
 * its own line.
 *
 * CodeMirror turns a string `info` into a single text node, where a `\n` is
 * subject to the inherited `white-space` and generally collapses to a space.
 * A `Node` is rendered as given, so the break is structural.
 */
function completionInfo(description: string, footnote: string) {
  return () => {
    const dom = document.createElement('div');

    const main = document.createElement('div');
    main.textContent = description;
    dom.appendChild(main);

    const sub = document.createElement('div');
    sub.className = 'cm-completionInfo-footnote';
    sub.textContent = footnote;
    dom.appendChild(sub);

    return dom;
  };
}

const toMacroCompletion = ({
  name,
  minArgs,
  description,
}: MacroSuggestion): SQLCompletion => ({
  label: `$__${name}`,
  apply: minArgs > 0 ? `$__${name}(` : `$__${name}`,
  detail: 'macro',
  info: description,
  type: 'function',
});

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

  const macroCompletions = MACRO_SUGGESTIONS.map(toMacroCompletion);

  if (!variables?.length) {
    return [...paramCompletions, ...macroCompletions];
  }

  const variableMacroCompletions =
    VARIABLE_MACRO_SUGGESTIONS.map(toMacroCompletion);

  const variableCompletions = variables.flatMap((variable): SQLCompletion[] => {
    const { name } = variable;

    /** A static description and an expansion preview given the current variable selections */
    const help = (snippet: string | undefined, description: string) => {
      const expansion =
        snippet == null
          ? undefined
          : describeVariableExpansion(snippet, variable);
      return expansion ? completionInfo(description, expansion) : description;
    };

    return [
      ...(variable.expression
        ? [
            {
              label: `$__filter(${name})`,
              apply: `$__filter(${name})`,
              detail: 'variable filter',
              info: help(
                `$__filter(${name})`,
                `Filters by the ${name} variable using its defined expression. Matches every row when no values are selected for the variable.`,
              ),
              type: 'function',
            },
          ]
        : []),
      {
        label: `$${name}`,
        apply: `$${name}`,
        detail: 'variable',
        info: help(
          `$${name}`,
          `The selected values of ${name}, in the default sqlstring format. Has no valid empty state — prefer $__filter(<expression>, ${name}).`,
        ),
        type: 'variable',
      },
      {
        label: `\${${name}}`,
        apply: `\${${name}}`,
        detail: 'variable',
        info: help(
          `\${${name}}`,
          `The same as $${name}, but delimited — use it when the reference runs into following word characters, as in \${${name}}_total.`,
        ),
        type: 'variable',
      },
      ...VARIABLE_FORMATS.map((format): SQLCompletion => {
        const reference = `\${${name}:${format}}`;
        return {
          label: reference,
          apply: reference,
          detail: 'variable',
          info: help(reference, VARIABLE_FORMAT_DESCRIPTIONS[format]),
          type: 'variable',
        };
      }),
    ];
  });

  return [
    ...paramCompletions,
    ...macroCompletions,
    ...variableMacroCompletions,
    ...variableCompletions,
  ];
}

function normalizeChartConfig<
  C extends Pick<
    BuilderSavedChartConfig,
    'select' | 'having' | 'orderBy' | 'displayType' | 'metricTables' | 'onClick'
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
  // otherwise they show a single value.
  if (
    !isRawSqlChart &&
    Array.isArray(form.series) &&
    form.displayType === DisplayType.Number &&
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
