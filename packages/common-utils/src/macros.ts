import { splitAndTrimWithBracket } from './core/utils';
import { RawSqlQueryParam, renderQueryParam } from './rawSqlParams';
import {
  MetricsDataType,
  MetricsDataTypeSchema,
  RawSqlChartConfig,
} from './types';
import {
  expandVariableToken,
  findBalancedParens,
  scanTemplateTokens,
  VARIABLE_MACRO_NAMES,
  VariableContext,
} from './variables';

function expectArgs(
  macroName: string,
  args: string[],
  minArgs: number,
  maxArgs: number,
) {
  if (args.length < minArgs || args.length > maxArgs) {
    const expected =
      minArgs === maxArgs ? `${minArgs}` : `${minArgs}-${maxArgs}`;
    throw new Error(
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
  replace: (args: string[]) => string;
};

const MACROS: Macro[] = [
  {
    name: 'fromTime',
    minArgs: 0,
    maxArgs: 0,
    replace: () => timeToDateTime(startMs()),
  },
  {
    name: 'toTime',
    minArgs: 0,
    maxArgs: 0,
    replace: () => timeToDateTime(endMs()),
  },
  {
    name: 'fromTime_ms',
    minArgs: 0,
    maxArgs: 0,
    replace: () => timeToDateTime64(startMs()),
  },
  {
    name: 'toTime_ms',
    minArgs: 0,
    maxArgs: 0,
    replace: () => timeToDateTime64(endMs()),
  },
  {
    name: 'timeFilter',
    minArgs: 1,
    maxArgs: 1,
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
    replace: () => intervalS(),
  },
];

/** Macro metadata for autocomplete suggestions */
export const MACRO_SUGGESTIONS = [
  ...MACROS.map(({ name, minArgs, maxArgs }) => ({ name, minArgs, maxArgs })),
  { name: 'filters', minArgs: 0, maxArgs: 0 },
  { name: 'sourceTable', minArgs: 0, maxArgs: 1 },
  ...Object.values(MetricsDataType).map(type => ({
    name: `sourceTable(${type})`,
    minArgs: 0,
    maxArgs: 0,
  })),
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
export function hasMacro(sql: string, name: string): boolean {
  return findMacros(sql, name).length > 0;
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

function findMacros(input: string, name: string): MacroMatch[] {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const pattern = new RegExp(`\\$__${name}\\b`, 'g');
  const matches: MacroMatch[] = [];

  for (const match of input.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    const { args, length } = parseMacroArgs(input.slice(end));

    if (length < 0) {
      throw new Error('Failed to parse macro arguments');
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
 * The template is scanned once, left to right, and each token is expanded into
 * an output buffer — an expansion is never re-scanned, so neither `$__filters`
 * output nor a selected variable value can trigger further substitution.
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
      replace: () => filtersSQL || NO_FILTERS,
    },
    {
      name: 'sourceTable',
      minArgs: 0,
      maxArgs: 1,
      replace: (args: string[]) => {
        expectArgs('sourceTable', args, 0, 1);
        if (!from) {
          throw new Error(
            "Macro '$__sourceTable' requires a source to be selected",
          );
        }

        if (args.length === 0 && metricTables) {
          throw new Error(
            "Macro '$__sourceTable(metricType)' requires a metricType when a metrics source is selected",
          );
        }

        if (args.length === 0 && !from.tableName) {
          throw new Error(
            "Macro '$__sourceTable' requires a source with a table to be selected when no arguments are provided",
          );
        }

        if (args.length === 0) {
          return `\`${from.databaseName}\`.\`${from.tableName}\``;
        }

        if (!metricTables) {
          throw new Error(
            "Macro '$__sourceTable(metricType)' with a metric type argument requires a metrics source to be selected",
          );
        }

        const metricsTypeParseResult = MetricsDataTypeSchema.safeParse(args[0]);
        if (!metricsTypeParseResult.success) {
          throw new Error(
            `Macro '$__sourceTable(metricType)' invalid argument '${args[0]}'. Expected a valid metrics data type (${Object.values(MetricsDataType).join(', ')}).`,
          );
        }

        const metricType = metricsTypeParseResult.data;
        const table = metricTables[metricType];
        if (!table) {
          throw new Error(
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

  return scanTemplateTokens(chartConfig.sqlTemplate, macroNames)
    .map(token => {
      if (token.kind === 'text') return token.text;

      if (token.kind === 'macro') {
        const macro = macrosByName.get(token.name);
        return macro
          ? macro.replace(token.args) // Non-variable-referencing macro
          : expandVariableToken(token, variableContext!); // Variable-referencing macro
      }

      // Braced and bare variable references ($var, ${var}, or ${var:format})
      return variableContext
        ? expandVariableToken(token, variableContext)
        : token.raw;
    })
    .join('');
}
