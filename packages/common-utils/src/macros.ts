import { splitAndTrimWithBracket } from './core/utils';
import { renderQueryParam } from './rawSqlParams';
import type { Filter, RawSqlChartConfig } from './types';

function expectArgs(macroName: string, args: string[], expected: number) {
  if (args.length !== expected) {
    throw new Error(
      `Macro '${macroName}' expects ${expected} argument(s), but got ${args.length}`,
    );
  }
}

// Helpers to render ClickHouse time conversions using query params
const startMs = () => renderQueryParam('startDateMilliseconds');
const endMs = () => renderQueryParam('endDateMilliseconds');
const intervalS = () => renderQueryParam('intervalSeconds');
const intervalMs = () => renderQueryParam('intervalMilliseconds');

const timeToDate = (msParam: string) =>
  `toDate(fromUnixTimestamp64Milli(${msParam}))`;
const timeToDateTime = (msParam: string) =>
  `toDateTime(fromUnixTimestamp64Milli(${msParam}))`;
const timeToDateTime64 = (msParam: string) =>
  `fromUnixTimestamp64Milli(${msParam})`;

type Macro = {
  name: string;
  argCount: number;
  replace: (args: string[]) => string;
};

const MACROS: Macro[] = [
  {
    name: 'fromTime',
    argCount: 0,
    replace: () => timeToDateTime(startMs()),
  },
  {
    name: 'toTime',
    argCount: 0,
    replace: () => timeToDateTime(endMs()),
  },
  {
    name: 'fromTime_ms',
    argCount: 0,
    replace: () => timeToDateTime64(startMs()),
  },
  {
    name: 'toTime_ms',
    argCount: 0,
    replace: () => timeToDateTime64(endMs()),
  },
  {
    name: 'timeFilter',
    argCount: 1,
    replace: (args: string[]) => {
      expectArgs('timeFilter', args, 1);
      const [col] = args;
      return `${col} >= ${timeToDateTime(startMs())} AND ${col} <= ${timeToDateTime(endMs())}`;
    },
  },
  {
    name: 'timeFilter_ms',
    argCount: 1,
    replace: (args: string[]) => {
      expectArgs('timeFilter_ms', args, 1);
      const [col] = args;
      return `${col} >= ${timeToDateTime64(startMs())} AND ${col} <= ${timeToDateTime64(endMs())}`;
    },
  },
  {
    name: 'dateFilter',
    argCount: 1,
    replace: (args: string[]) => {
      expectArgs('dateFilter', args, 1);
      const [col] = args;
      return `${col} >= ${timeToDate(startMs())} AND ${col} <= ${timeToDate(endMs())}`;
    },
  },
  {
    name: 'dateTimeFilter',
    argCount: 2,
    replace: (args: string[]) => {
      expectArgs('dateTimeFilter', args, 2);
      const [dateCol, timeCol] = args;
      const dateFilter = `(${dateCol} >= ${timeToDate(startMs())} AND ${dateCol} <= ${timeToDate(endMs())})`;
      const timeFilter = `(${timeCol} >= ${timeToDateTime(startMs())} AND ${timeCol} <= ${timeToDateTime(endMs())})`;
      return `${dateFilter} AND ${timeFilter}`;
    },
  },
  {
    name: 'dt',
    argCount: 2,
    replace: (args: string[]) => {
      expectArgs('dt', args, 2);
      const [dateCol, timeCol] = args;
      const dateFilter = `(${dateCol} >= ${timeToDate(startMs())} AND ${dateCol} <= ${timeToDate(endMs())})`;
      const timeFilter = `(${timeCol} >= ${timeToDateTime(startMs())} AND ${timeCol} <= ${timeToDateTime(endMs())})`;
      return `${dateFilter} AND ${timeFilter}`;
    },
  },
  {
    name: 'timeInterval',
    argCount: 1,
    replace: (args: string[]) => {
      expectArgs('timeInterval', args, 1);
      const [col] = args;
      return `toStartOfInterval(toDateTime(${col}), INTERVAL ${intervalS()} second)`;
    },
  },
  {
    name: 'timeInterval_ms',
    argCount: 1,
    replace: (args: string[]) => {
      expectArgs('timeInterval_ms', args, 1);
      const [col] = args;
      return `toStartOfInterval(toDateTime64(${col}, 3), INTERVAL ${intervalMs()} millisecond)`;
    },
  },
  {
    name: 'interval_s',
    argCount: 0,
    replace: () => intervalS(),
  },
];

/** Renders a Filter[] array into a raw SQL condition string */
export function renderFiltersToSql(filters: Filter[]): string {
  const conditions = filters
    .map(filter => {
      if (filter.type === 'sql_ast') {
        return `(${filter.left} ${filter.operator} ${filter.right})`;
      } else if (filter.type === 'sql') {
        return filter.condition ? `(${filter.condition})` : '';
      }
      // lucene filters are not supported in raw SQL charts
      return '';
    })
    .filter(Boolean);

  return conditions.join(' AND ') || '(1=1 /** no filters applied */)';
}

export type MacroContext = {
  filtersSQL?: string;
};

/** Macro metadata for autocomplete suggestions */
export const MACRO_SUGGESTIONS = [
  ...MACROS.map(({ name, argCount }) => ({ name, argCount })),
  { name: 'filters', argCount: 0 },
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

export function replaceMacros(chartConfig: RawSqlChartConfig): string {
  const allMacros: Macro[] = [
    ...MACROS,
    {
      name: 'filters',
      argCount: 0,
      replace: () => renderFiltersToSql(chartConfig.filters ?? []),
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
