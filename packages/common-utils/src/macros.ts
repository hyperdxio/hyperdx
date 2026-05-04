import { splitAndTrimWithBracket } from './core/utils';
import { RawSqlQueryParam, renderQueryParam } from './rawSqlParams';
import {
  MetricsDataType,
  MetricsDataTypeSchema,
  RawSqlChartConfig,
} from './types';

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

type MacroMatch = {
  full: string;
  args: string[];
};

function parseMacroArgs(argString: string): { args: string[]; length: number } {
  if (!argString.startsWith('(')) {
    return { args: [], length: 0 };
  }

  // Find the matching close paren
  let unmatchedParens = 0;
  let closeParenIndex = -1;
  for (let i = 0; i < argString.length; i++) {
    const c = argString.charAt(i);
    if (c === '(') {
      unmatchedParens++;
    } else if (c === ')') {
      unmatchedParens--;
      if (unmatchedParens === 0) {
        closeParenIndex = i;
        break;
      }
    }
  }

  if (closeParenIndex < 0) {
    return { args: [], length: -1 };
  }

  const inner = argString.slice(1, closeParenIndex);
  const args = splitAndTrimWithBracket(inner);
  return { args, length: closeParenIndex + 1 };
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

export function replaceMacros(
  chartConfig: Pick<RawSqlChartConfig, 'sqlTemplate' | 'from' | 'metricTables'>,
  filtersSQL?: string,
): string {
  const { from, metricTables } = chartConfig;

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

  const sortedMacros = allMacros.sort(
    (m1, m2) => m2.name.length - m1.name.length,
  );

  let sql = chartConfig.sqlTemplate;
  for (const macro of sortedMacros) {
    const matches = findMacros(sql, macro.name);

    for (const match of matches) {
      sql = sql.replaceAll(match.full, macro.replace(match.args));
    }
  }

  return sql;
}
