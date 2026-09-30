import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  TimeWindow,
  windowInclusivity,
} from '@hyperdx/common-utils/dist/core/searchWindows';
import {
  getFirstTimestampValueExpression,
  isFirstOrderByAscending,
  isTimestampExpressionInFirstOrderBy,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  DisplayType,
  isLogSource,
  isTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import type { ExternalDashboardSearchRequestConfig } from '@/utils/zod';

import type { SearchCursorState } from './searchCursor';

export type SearchErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'INVALID_CURSOR'
  | 'CURSOR_QUERY_MISMATCH';

type SearchError = {
  isError: true;
  code: SearchErrorCode;
  message: string;
};

type SearchResults = {
  isError: false;
  data: Record<string, unknown>[];
  nextCursorState: SearchCursorState | null;
};

export function resolveSearchWindows(
  source: TSource,
  orderBy: string,
  startDate: Date,
  endDate: Date,
): TimeWindow[] {
  // renderChartConfig forces both bounds inclusive for toStartOf*/Date-typed
  // timestamp expressions, which defeats the half-open windows below and would
  // return boundary rows on two consecutive pages. Fall back to one window.
  const roundsTimestamp = /\btoStartOf|\btoDate\s*\(/i.test(
    source.timestampValueExpression ?? '',
  );

  const canWindow =
    !roundsTimestamp &&
    isTimestampExpressionInFirstOrderBy({
      orderBy,
      timestampValueExpression: source.timestampValueExpression,
    } as Parameters<typeof isTimestampExpressionInFirstOrderBy>[0]);

  if (!canWindow) {
    return [
      {
        startTime: startDate,
        endTime: endDate,
        windowIndex: 0,
        direction: isFirstOrderByAscending(orderBy) ? 'ASC' : 'DESC',
      },
    ];
  }

  return isFirstOrderByAscending(orderBy)
    ? generateTimeWindowsAscending(startDate, endDate)
    : generateTimeWindowsDescending(startDate, endDate);
}

// Mirrors `optimizeDefaultOrderBy` + `useDefaultOrderBy` from DBSearchPage.tsx.
// Uses `source.orderByExpression` when set, otherwise derives an ORDER BY string
// from the source's timestamp expressions.
//
// The UI version also folds in `tableMetadata.sorting_key` (fetched from CH) to
// pick up extra timestamp-like columns from the table's sort key. We skip that
// step here to avoid an extra CH round-trip on the critical path. Sources that
// need the full sorting-key-aware behaviour should set `orderByExpression`.
function resolveSearchOrderBy(source: TSource): string {
  const explicit =
    isLogSource(source) || isTraceSource(source)
      ? source.orderByExpression?.trim()
      : undefined;
  if (explicit) return explicit;

  const timestampExpr = source.timestampValueExpression ?? '';
  const displayedExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.displayedTimestampValueExpression?.trim()
      : undefined;

  const timestampParts = splitAndTrimWithBracket(timestampExpr);
  const candidates = displayedExpr
    ? [...timestampParts, displayedExpr]
    : [...timestampParts];

  const seen = new Set<string>();
  const orderByParts: string[] = [];
  for (const key of candidates) {
    if (!seen.has(key)) {
      seen.add(key);
      orderByParts.push(key);
    }
  }

  if (orderByParts.length === 0) {
    orderByParts.push(
      getFirstTimestampValueExpression(timestampExpr) ?? 'Timestamp',
    );
  }

  return orderByParts.length > 1
    ? `(${orderByParts.join(', ')}) DESC`
    : `${orderByParts[0]} DESC`;
}

export async function runSearchConfig({
  teamId,
  config,
  startDate,
  endDate,
  maxResults,
  offset,
  cursorState,
}: {
  teamId: string;
  config: ExternalDashboardSearchRequestConfig;
  startDate: Date;
  endDate: Date;
  maxResults: number;
  offset: number;
  cursorState?: SearchCursorState;
}): Promise<SearchResults | SearchError> {
  const source = await getSource(teamId, config.sourceId);
  if (!source) {
    return {
      isError: true,
      code: 'SOURCE_NOT_FOUND',
      message: `Source not found: ${config.sourceId}`,
    };
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return {
      isError: true,
      code: 'CONNECTION_NOT_FOUND',
      message: `Connection not found for source: ${config.sourceId}`,
    };
  }

  // Set client-side HTTP timeout slightly above the source's max_execution_time
  // so CH can return a clean error first. value=0 means no server limit.
  const maxExecSetting = source.querySettings?.find(
    s => s.setting === 'max_execution_time',
  );
  const maxExecSeconds = maxExecSetting ? Number(maxExecSetting.value) : NaN;
  const requestTimeout =
    maxExecSeconds > 0 && isFinite(maxExecSeconds)
      ? maxExecSeconds * 1000 + 2_000
      : undefined;

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
    ...(requestTimeout != null ? { requestTimeout } : {}),
  });

  const effectiveOrderBy =
    config.orderBy?.trim() || resolveSearchOrderBy(source);

  // Window ONLY for an active cursor walk. An offset-only request keeps the
  // legacy single-range behaviour: confining it to window 0 would make a large
  // `offset` skip within the newest window and never reach older rows.
  const windows = cursorState
    ? resolveSearchWindows(source, effectiveOrderBy, startDate, endDate)
    : [
        {
          startTime: startDate,
          endTime: endDate,
          windowIndex: 0,
          direction: isFirstOrderByAscending(effectiveOrderBy)
            ? ('ASC' as const)
            : ('DESC' as const),
        },
      ];
  const windowIndex = cursorState?.windowIndex ?? 0;
  const window = windows[windowIndex];
  if (window == null) {
    return {
      isError: true,
      code: 'CURSOR_QUERY_MISMATCH',
      message: 'Cursor refers to a page outside the current time range',
    };
  }
  const effectiveOffset = cursorState ? cursorState.offset : offset;

  const searchBase = buildSearchChartConfig(source, {
    where: typeof config.where === 'string' ? config.where : '',
    whereLanguage: config.whereLanguage ?? 'lucene',
    select: config.select ?? null,
    displayType: DisplayType.Search,
    orderBy: effectiveOrderBy,
    dateRange: [window.startTime, window.endTime],
    ...windowInclusivity(window, windows.length),
  });

  const chartConfig: ChartConfigWithDateRange = {
    ...searchBase,
    connection: source.connection.toString(),
    limit: { limit: maxResults, offset: effectiveOffset },
  } as ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: source.querySettings,
  });

  if (
    result == null ||
    typeof result !== 'object' ||
    !('data' in result) ||
    !Array.isArray((result as { data: unknown }).data)
  ) {
    throw new Error('Unexpected ClickHouse response shape: missing data array');
  }

  const data = (result as { data: unknown[] }).data as Record<
    string,
    unknown
  >[];

  // Only a cursor walk gets a next cursor; offset-only callers are unchanged.
  let nextCursorState: SearchCursorState | null = null;
  if (cursorState) {
    const pinned = {
      startTime: cursorState.startTime,
      endTime: cursorState.endTime,
    };
    if (data.length >= maxResults) {
      nextCursorState = {
        windowIndex,
        offset: effectiveOffset + data.length,
        ...pinned,
      };
    } else if (windowIndex + 1 < windows.length) {
      nextCursorState = { windowIndex: windowIndex + 1, offset: 0, ...pinned };
    }
  }

  return { isError: false, data, nextCursorState };
}
