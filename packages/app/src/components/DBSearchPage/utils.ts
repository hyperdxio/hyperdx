import { parseAsString, parseAsStringEnum } from 'nuqs';
import { z } from 'zod';
import {
  buildSearchChartConfig,
  SearchChartConfig,
} from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  aliasMapToWithClauses,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  Filter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { SearchConfig } from '@/types';
import { parseAsJsonEncoded, parseAsStringEncoded } from '@/utils/queryParsers';

export const LIVE_TAIL_REFRESH_FREQUENCY_OPTIONS = [
  { value: '1000', label: '1s' },
  { value: '2000', label: '2s' },
  { value: '4000', label: '4s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
];
export const DEFAULT_REFRESH_FREQUENCY = 10000;

export const ALLOWED_SOURCE_KINDS = [SourceKind.Log, SourceKind.Trace];

export const QUERY_KEY_PREFIX = 'search';

export const SearchConfigSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']),
  orderBy: z.string(),
  filters: z.array(
    z.union([
      z.object({
        type: z.literal('sql_ast'),
        operator: z.enum(['=', '<', '>', '>=', '<=', '!=']),
        left: z.string(),
        right: z.string(),
      }),
      z.object({
        type: z.enum(['sql', 'lucene']),
        condition: z.string(),
      }),
    ]),
  ),
});

export type SearchConfigFromSchema = z.infer<typeof SearchConfigSchema>;

// Stable reference for useQueryStates
export const queryStateMap = {
  source: parseAsString,
  where: parseAsStringEncoded,
  select: parseAsStringEncoded,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  filters: parseAsJsonEncoded<Filter[]>(),
  orderBy: parseAsStringEncoded,
};

// Helper function to get the default source id
export function getDefaultSourceId(
  sources: { id: string; disabled?: boolean }[] | undefined,
  lastSelectedSourceId: string | undefined,
): string {
  if (!sources || sources.length === 0) return '';

  // Filter out disabled sources
  const enabledSources = sources.filter(s => !s.disabled);
  if (enabledSources.length === 0) return '';

  if (
    lastSelectedSourceId &&
    enabledSources.some(s => s.id === lastSelectedSourceId)
  ) {
    return lastSelectedSourceId;
  }
  return enabledSources[0].id;
}

const implicitDateTimePrefixes = [
  'toStartOf',
  'toUnixTimestamp',
  'toDateTime',
  'Timestamp',
] as const;

export function optimizeDefaultOrderBy(
  timestampExpr: string,
  displayedTimestampExpr: string | undefined,
  sortingKey: string | undefined,
) {
  const orderByArr: string[] = [];

  const timestampExprParts = splitAndTrimWithBracket(timestampExpr);
  const keys = splitAndTrimWithBracket(sortingKey ?? '');
  keys.push(...timestampExprParts);
  if (displayedTimestampExpr) {
    keys.push(displayedTimestampExpr.trim());
  }
  for (const key of keys) {
    if (
      !orderByArr.includes(key) &&
      (implicitDateTimePrefixes.some(v => key.startsWith(v)) ||
        timestampExprParts.includes(key) ||
        displayedTimestampExpr?.trim() === key)
    ) {
      orderByArr.push(key);
    }
  }

  return orderByArr.length > 1
    ? `(${orderByArr.join(', ')}) DESC`
    : `${orderByArr[0]} DESC`;
}

export function buildChartConfigFromSearchedConfig(
  sourceObj: TSource | undefined,
  searchedConfig: SearchConfig,
  defaultSearchConfig: Partial<SearchConfig> | undefined,
  defaultOrderBy: string | undefined,
): SearchChartConfig | null {
  if (sourceObj == null) return null;
  const { select, where, whereLanguage, filters, orderBy } = searchedConfig;
  const resolvedOrderBy =
    orderBy || defaultSearchConfig?.orderBy || defaultOrderBy;

  return buildSearchChartConfig(sourceObj, {
    where,
    whereLanguage,
    filters,
    select: select || defaultSearchConfig?.select || null,
    displayType: DisplayType.Search,
    ...(resolvedOrderBy != null ? { orderBy: resolvedOrderBy } : {}),
  });
}

/**
 * `select` is typed as `string | DerivedColumn[]` upstream, but in the
 * search page we always supply a string. Returns the trimmed column list.
 */
export function parseDisplayedColumns(
  rawSelect: string | unknown[] | undefined,
  defaultSelect: string | undefined,
): string[] {
  const value = rawSelect ?? defaultSelect ?? '';
  return splitAndTrimWithBracket(typeof value === 'string' ? value : '');
}

export function toggleColumnInSelect(
  displayedColumns: string[],
  column: string,
): string {
  const newSelectArray = displayedColumns.includes(column)
    ? displayedColumns.filter(s => s !== column)
    : [...displayedColumns, column];
  return newSelectArray.join(', ');
}

type HistogramBuilderArgs = {
  chartConfig: SearchChartConfig;
  source: TSource | undefined;
  aliasWith: ReturnType<typeof aliasMapToWithClauses>;
  searchedTimeRange: [Date, Date];
  isLive: boolean;
  eventTableSelect: string | undefined;
};

export function buildHistogramTimeChartConfig({
  chartConfig,
  source,
  aliasWith,
  searchedTimeRange,
  isLive,
  eventTableSelect,
}: HistogramBuilderArgs): BuilderChartConfigWithDateRange {
  const variableConfig: { groupBy?: string } = {};
  switch (source?.kind) {
    case SourceKind.Log:
      variableConfig.groupBy = source.severityTextExpression;
      break;
    case SourceKind.Trace:
      variableConfig.groupBy = source.statusCodeExpression;
      break;
  }

  return {
    ...chartConfig,
    select: [
      {
        aggFn: 'count',
        aggCondition: '',
        valueExpression: '',
      },
    ],
    orderBy: undefined,
    granularity: 'auto',
    dateRange: searchedTimeRange,
    displayType: DisplayType.StackedBar,
    with: aliasWith,
    // Preserve the original table select string for "View Events" links
    eventTableSelect,
    // In live mode, when the end date is aligned to the granularity, the end date does
    // not change on every query, resulting in cached data being re-used.
    alignDateRangeToGranularity: !isLive,
    ...variableConfig,
  };
}

type SearchUrlArgs = {
  where: SearchConfig['where'];
  whereLanguage: SearchConfig['whereLanguage'];
  source?: TSource;
  searchedSource: TSource | undefined;
  searchedConfig: {
    select?: string | null;
    where?: string | null;
    filters?: Filter[] | null;
  };
  searchedTimeRange: [Date, Date];
  interval: number;
};

export function generateSearchUrl({
  where,
  whereLanguage,
  source,
  searchedSource,
  searchedConfig,
  searchedTimeRange,
  interval,
}: SearchUrlArgs) {
  const qParams = new URLSearchParams({
    whereLanguage: whereLanguage || 'sql',
    from: searchedTimeRange[0].getTime().toString(),
    to: searchedTimeRange[1].getTime().toString(),
    isLive: 'false',
    liveInterval: interval.toString(),
  });

  // When generating a search based on a different source,
  // filters and select for the current source are not preserved.
  if (source && source.id !== searchedSource?.id) {
    qParams.append('where', where || '');
    qParams.append('source', source.id);
  } else {
    qParams.append('select', searchedConfig.select || '');
    qParams.append('where', where || searchedConfig.where || '');
    qParams.append('filters', JSON.stringify(searchedConfig.filters ?? []));
    qParams.append('source', searchedSource?.id || '');
  }

  return `/search?${qParams.toString()}`;
}
