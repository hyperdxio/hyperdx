import { splitAndTrimWithBracket } from './core/utils';
import { MacroExpansionError, MalformedMacroArgsError } from './macroErrors';
import { RawSqlQueryParam, renderQueryParam } from './rawSqlParams';
import {
  MetricsDataType,
  MetricsDataTypeSchema,
  RawSqlChartConfig,
} from './types';
import {
  expandTemplate,
  expandVariableToken,
  findBalancedParens,
  hasVariableMacro,
  VARIABLE_MACRO_NAMES,
  VariableContext,
  VariableMacroName,
} from './variables';

function expectArgs(
  macroName: MacroName,
  args: string[],
  minArgs: number,
  maxArgs: number,
) {
  if (args.length < minArgs || args.length > maxArgs) {
    const expected =
      minArgs === maxArgs ? `${minArgs}` : `${minArgs}-${maxArgs}`;
    throw new MacroExpansionError(
      macroName,
      `Macro '${macroName}' expects ${expected} argument(s), but got ${args.length}`,
    );
  }
}

// Helpers to render ClickHouse time conversions using query params
const startMs = () => renderQueryParam(RawSqlQueryParam.startDateMilliseconds);
const endMs = () => renderQueryParam(RawSqlQueryParam.endDateMilliseconds);
const intervalS = () => renderQueryParam(RawSqlQueryParam.intervalSeconds);
const intervalMs = () =>
  renderQueryParam(RawSqlQueryParam.intervalMilliseconds);

const timeToDate = (msParam: string) =>
  `toDate(fromUnixTimestamp64Milli(${msParam}))`;
const timeToDateTime = (msParam: string) =>
  `toDateTime(fromUnixTimestamp64Milli(${msParam}))`;
const timeToDateTime64 = (msParam: string) =>
  `fromUnixTimestamp64Milli(${msParam})`;

type Macro = {
  name: string;
  minArgs: number;
  maxArgs: number;
  /** One-line summary of what the macro expands to, shown in autocomplete. */
  description: string;
  replace: (args: string[]) => string;
};

const MACROS = [
  {
    name: 'fromTime',
    minArgs: 0,
    maxArgs: 0,
    description: 'Start of the selected time range, as a DateTime.',
    replace: () => timeToDateTime(startMs()),
  },
  {
    name: 'toTime',
    minArgs: 0,
    maxArgs: 0,
    description: 'End of the selected time range, as a DateTime.',
    replace: () => timeToDateTime(endMs()),
  },
  {
    name: 'fromTime_ms',
    minArgs: 0,
    maxArgs: 0,
    description:
      'Start of the selected time range, as a millisecond-precision DateTime64.',
    replace: () => timeToDateTime64(startMs()),
  },
  {
    name: 'toTime_ms',
    minArgs: 0,
    maxArgs: 0,
    description:
      'End of the selected time range, as a millisecond-precision DateTime64.',
    replace: () => timeToDateTime64(endMs()),
  },
  {
    name: 'timeFilter',
    minArgs: 1,
    maxArgs: 1,
    description:
      'Filters the given DateTime column to the selected time range (inclusive of both ends).',
    replace: (args: string[]) => {
      expectArgs('timeFilter', args, 1, 1);
      const [col] = args;
      return `${col} >= ${timeToDateTime(startMs())} AND ${col} <= ${timeToDateTime(endMs())}`;
    },
  },
  {
    name: 'timeFilter_ms',
    minArgs: 1,
    maxArgs: 1,
    description:
      'Filters the given millisecond-precision DateTime64 column to the selected time range.',
    replace: (args: string[]) => {
      expectArgs('timeFilter_ms', args, 1, 1);
      const [col] = args;
      return `${col} >= ${timeToDateTime64(startMs())} AND ${col} <= ${timeToDateTime64(endMs())}`;
    },
  },
  {
    name: 'dateFilter',
    minArgs: 1,
    maxArgs: 1,
    description: 'Filters the given Date column to the selected time range.',
    replace: (args: string[]) => {
      expectArgs('dateFilter', args, 1, 1);
      const [col] = args;
      return `${col} >= ${timeToDate(startMs())} AND ${col} <= ${timeToDate(endMs())}`;
    },
  },
  {
    name: 'dateTimeFilter',
    minArgs: 2,
    maxArgs: 2,
    description:
      'Filters the given Date and DateTime columns to the selected time range, for tables partitioned on a date.',
    replace: (args: string[]) => {
      expectArgs('dateTimeFilter', args, 2, 2);
      const [dateCol, timeCol] = args;
      const dateFilter = `(${dateCol} >= ${timeToDate(startMs())} AND ${dateCol} <= ${timeToDate(endMs())})`;
      const timeFilter = `(${timeCol} >= ${timeToDateTime(startMs())} AND ${timeCol} <= ${timeToDateTime(endMs())})`;
      return `${dateFilter} AND ${timeFilter}`;
    },
  },
  {
    name: 'dt',
    minArgs: 2,
    maxArgs: 2,
    description: 'Short alias for $__dateTimeFilter(dateCol, timeCol).',
    replace: (args: string[]) => {
      expectArgs('dt', args, 2, 2);
      const [dateCol, timeCol] = args;
      const dateFilter = `(${dateCol} >= ${timeToDate(startMs())} AND ${dateCol} <= ${timeToDate(endMs())})`;
      const timeFilter = `(${timeCol} >= ${timeToDateTime(startMs())} AND ${timeCol} <= ${timeToDateTime(endMs())})`;
      return `${dateFilter} AND ${timeFilter}`;
    },
  },
  {
    name: 'timeInterval',
    minArgs: 1,
    maxArgs: 1,
    description:
      'Buckets the provided DateTime column to the chart granularity, for the time axis of a time-series chart.',
    replace: (args: string[]) => {
      expectArgs('timeInterval', args, 1, 1);
      const [col] = args;
      return `toStartOfInterval(toDateTime(${col}), INTERVAL ${intervalS()} second)`;
    },
  },
  {
    name: 'timeInterval_ms',
    minArgs: 1,
    maxArgs: 1,
    description:
      'Buckets the provided millisecond-precision column to the chart granularity.',
    replace: (args: string[]) => {
      expectArgs('timeInterval_ms', args, 1, 1);
      const [col] = args;
      return `toStartOfInterval(toDateTime64(${col}, 3), INTERVAL ${intervalMs()} millisecond)`;
    },
  },
  {
    name: 'interval_s',
    minArgs: 0,
    maxArgs: 0,
    description: 'The chart granularity, in seconds.',
    replace: () => intervalS(),
  },
] as const satisfies readonly Macro[];

/**
 * Every `$__<name>` a raw SQL template can use: the static macros above, the
 * two built in `replaceMacros` from the chart's source, and the variable macros
 * that only exist when a variable context is present.
 */
export type MacroName =
  | (typeof MACROS)[number]['name']
  | 'filters'
  | 'sourceTable'
  | VariableMacroName;

const FILTERS_MACRO_DESCRIPTION =
  'Applies all broadcasted dashboard filters to this tile, as a single predicate. Expands to 1=1 when none apply. Requires a source selection for the tile.';
const SOURCE_TABLE_MACRO_DESCRIPTION =
  "The selected source's table, fully qualified. Requires a source selection for the tile.";

export type MacroSuggestion = {
  name: string;
  minArgs: number;
  maxArgs: number;
  description: string;
};

/** Macro metadata for autocomplete suggestions */
export const MACRO_SUGGESTIONS: MacroSuggestion[] = [
  ...MACROS.map(({ name, minArgs, maxArgs, description }) => ({
    name,
    minArgs,
    maxArgs,
    description,
  })),
  {
    name: 'filters',
    minArgs: 0,
    maxArgs: 0,
    description: FILTERS_MACRO_DESCRIPTION,
  },
  {
    name: 'sourceTable',
    minArgs: 0,
    maxArgs: 1,
    description: SOURCE_TABLE_MACRO_DESCRIPTION,
  },
  ...Object.values(MetricsDataType).map(type => ({
    name: `sourceTable(${type})`,
    minArgs: 0,
    maxArgs: 0,
    description: `The selected metrics source's ${type} table, fully qualified.`,
  })),
];

/** Macros that only resolve when the chart is rendered with a variable context */
export const VARIABLE_MACRO_SUGGESTIONS: MacroSuggestion[] = [
  {
    name: 'filter',
    minArgs: 1,
    maxArgs: 2,
    description:
      "$__filter(<expression>, <variable>) — matches the expression against the variable's selected values. Expands to 1=1 when nothing is selected, so the query stays valid. The recommended way to use a variable in SQL.",
  },
  {
    name: 'conditionalAll',
    minArgs: 2,
    maxArgs: 2,
    description:
      '$__conditionalAll(<condition>, <variable>) — applies the condition only while the variable has a selection, and expands to 1=1 otherwise. Use it for operators IN cannot express, such as NOT IN or LIKE.',
  },
];

/**
 * Macros whose expansion depends on the chart's
 * source being configured. With no source:
 *  - `$__filters` cannot resolve dashboard filters against the source's
 *    columns and falls back to `(1=1)`, so the filters are silently dropped.
 *  - `$__sourceTable` throws at render time ("requires a source to be
 *    selected"), so the query fails outright.
 *
 * Every other macro only needs the dashboard time range / interval and takes
 * its column as an argument, so it does not require a source.
 */
export const SOURCE_DEPENDENT_MACROS = ['filters', 'sourceTable'] as const;

/**
 * Time-range macros. Any single one binds a raw
 * SQL query to the dashboard/query time range, so the presence of *any* of
 * these satisfies a time-range check — callers should test them as a set
 * rather than requiring a specific one.
 */
export const TIME_RANGE_MACROS = [
  'timeFilter',
  'timeFilter_ms',
  'dateFilter',
  'dateTimeFilter',
  'dt',
  'fromTime',
  'toTime',
  'fromTime_ms',
  'toTime_ms',
] as const;

/**
 * Time-bucketing macros. Only relevant to time-series
 * (line/bar) charts, where they align buckets to the requested granularity.
 */
export const INTERVAL_MACROS = [
  'timeInterval',
  'timeInterval_ms',
  'interval_s',
] as const;

type MacroMatch = {
  full: string;
  args: string[];
};

function parseMacroArgs(argString: string): { args: string[]; length: number } {
  if (!argString.startsWith('(')) {
    return { args: [], length: 0 };
  }

  // Quote-aware, so a `)` inside a string literal doesn't end the argument list.
  const closeParenIndex = findBalancedParens(argString, 0);

  if (closeParenIndex < 0) {
    return { args: [], length: -1 };
  }

  const inner = argString.slice(1, closeParenIndex);
  const args = splitAndTrimWithBracket(inner);
  return { args, length: closeParenIndex + 1 };
}

/**
 * True if the SQL contains at least one occurrence of the `$__<name>` macro.
 */
export function hasMacro(sql: string, name: MacroName): boolean {
  return findMacros(sql, name).length > 0;
}

/**
 * Whether a dashboard tile's SQL leaves dashboard filters unapplied: neither
 * `$__filters` nor a variable macro (`$__filter`/`$__conditionalAll`) appears,
 * so nothing in the template consumes the dashboard's filter state.
 */
export function isMissingFiltersMacro(sqlTemplate: string): boolean {
  try {
    return !hasMacro(sqlTemplate, 'filters') && !hasVariableMacro(sqlTemplate);
  } catch (e) {
    if (e instanceof MalformedMacroArgsError) {
      return false;
    }
    console.log('unexpected error in isMissingFiltersMacro', e);
    return false;
  }
}

/**
 * Which of SOURCE_DEPENDENT_MACROS are actually referenced in the given SQL.
 * Shared by callers that need to warn/error when those macros are used
 * without a source to resolve them against.
 */
export function getSourceDependentMacrosUsed(
  sqlTemplate: string,
): (typeof SOURCE_DEPENDENT_MACROS)[number][] {
  return SOURCE_DEPENDENT_MACROS.filter(macro => hasMacro(sqlTemplate, macro));
}

/**
 * Argument count for each `$__sourceTable(...)` usage in the SQL — 0 for a
 * bare `$__sourceTable`, 1 for `$__sourceTable(<metricType>)`.
 */
export function getSourceTableMacroArgCounts(sqlTemplate: string): number[] {
  return findMacros(sqlTemplate, 'sourceTable').map(match => match.args.length);
}

function findMacros(input: string, name: MacroName): MacroMatch[] {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const pattern = new RegExp(`\\$__${name}\\b`, 'g');
  const matches: MacroMatch[] = [];

  for (const match of input.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    const { args, length } = parseMacroArgs(input.slice(end));

    if (length < 0) {
      throw new MalformedMacroArgsError();
    }

    matches.push({ full: input.slice(start, end + length), args });
  }

  return matches;
}

const NO_FILTERS = '(1=1 /** no filters applied */)';

/**
 * Expand every macro and (when a variable context is present) every dashboard
 * variable reference in a raw SQL template.
 *
 * The template is scanned left to right and each token is expanded into an
 * output buffer. A macro's arguments are expanded first, recursively, so a
 * variable or macro nested in an argument resolves before the enclosing macro
 * sees it — `$__timeFilter(${TsColumn:csv})` filters on the selected column, and
 * `$__conditionalAll($__timeFilter(ts), env)` expands the inner macro. Only
 * template source is recursed into: an expansion is never re-scanned, so neither
 * `$__filters` output nor a selected variable value can trigger further
 * substitution.
 *
 * `chartConfig.variables` being undefined means variable references and
 * the variable macros are left exactly as written; an empty array means the
 * dashboard has no variables, and references to unknown names still pass
 * through verbatim while macros naming them error.
 */
export function replaceMacros(
  chartConfig: Pick<
    RawSqlChartConfig,
    'sqlTemplate' | 'from' | 'metricTables' | 'variables'
  >,
  filtersSQL?: string,
): string {
  const { from, metricTables, variables } = chartConfig;

  const allMacros: Macro[] = [
    ...MACROS,
    {
      name: 'filters',
      minArgs: 0,
      maxArgs: 0,
      description: FILTERS_MACRO_DESCRIPTION,
      replace: () => filtersSQL || NO_FILTERS,
    },
    {
      name: 'sourceTable',
      minArgs: 0,
      maxArgs: 1,
      description: SOURCE_TABLE_MACRO_DESCRIPTION,
      replace: (args: string[]) => {
        expectArgs('sourceTable', args, 0, 1);
        if (!from) {
          throw new MacroExpansionError(
            'sourceTable',
            "Macro '$__sourceTable' requires a source to be selected",
          );
        }

        if (args.length === 0 && metricTables) {
          throw new MacroExpansionError(
            'sourceTable',
            "Macro '$__sourceTable(metricType)' requires a metricType when a metrics source is selected",
          );
        }

        if (args.length === 0 && !from.tableName) {
          throw new MacroExpansionError(
            'sourceTable',
            "Macro '$__sourceTable' requires a source with a table to be selected when no arguments are provided",
          );
        }

        if (args.length === 0) {
          return `\`${from.databaseName}\`.\`${from.tableName}\``;
        }

        if (!metricTables) {
          throw new MacroExpansionError(
            'sourceTable',
            "Macro '$__sourceTable(metricType)' with a metric type argument requires a metrics source to be selected",
          );
        }

        const metricsTypeParseResult = MetricsDataTypeSchema.safeParse(args[0]);
        if (!metricsTypeParseResult.success) {
          throw new MacroExpansionError(
            'sourceTable',
            `Macro '$__sourceTable(metricType)' invalid argument '${args[0]}'. Expected a valid metrics data type (${Object.values(MetricsDataType).join(', ')}).`,
          );
        }

        const metricType = metricsTypeParseResult.data;
        const table = metricTables[metricType];
        if (!table) {
          throw new MacroExpansionError(
            'sourceTable',
            `Macro '$__sourceTable(metricType)': No table configured for metric type '${metricType}'.`,
          );
        }
        return `\`${from.databaseName}\`.\`${table}\``;
      },
    },
  ];

  const macrosByName = new Map(allMacros.map(macro => [macro.name, macro]));

  const variableContext: VariableContext | undefined = variables && {
    variables,
    defaultFormat: 'sqlstring',
  };

  const macroNames = [
    ...macrosByName.keys(),
    // Without a variable context the variable macros aren't macros at all —
    // leaving them unregistered emits them verbatim, arguments and all.
    ...(variableContext ? VARIABLE_MACRO_NAMES : []),
  ];

  return expandTemplate(chartConfig.sqlTemplate, {
    macroNames,
    expandMacro: token => {
      const macro = macrosByName.get(token.name);
      return macro
        ? macro.replace(token.args) // Non-variable-referencing macro
        : expandVariableToken(token, variableContext!); // Variable-referencing macro
    },
    // Braced and bare variable references ($var, ${var}, or ${var:format})
    expandReference: token =>
      variableContext ? expandVariableToken(token, variableContext) : token.raw,
  });
}
