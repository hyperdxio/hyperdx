import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  buildSearchChartConfig,
  resolveSelect,
} from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import type {
  ChartConfigWithDateRange,
  QuerySettings,
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

import {
  CURSOR_TS_COLUMN,
  MAX_SINGLE_WINDOW_OFFSET,
  type SearchCursorState,
  type SearchWalk,
} from './searchCursor';
import {
  cutWindowAtBucket,
  nextSearchWindow,
  resolveFirstSearchWindow,
  windowBounds,
} from './searchWindows';

const OVERFLOW_MODE_SETTING = /_overflow_mode(_leaf)?$/;
const DEFAULT_OVERFLOW_MODE_SETTINGS = [
  'result_overflow_mode',
  'read_overflow_mode',
  'timeout_overflow_mode',
];

// A limit set to 'break' returns a partial page with no error, which a walk
// would read as the end of its window. Cursor walks fail loudly instead.
function withThrowingOverflow(
  querySettings: QuerySettings | undefined,
): QuerySettings {
  const settings = querySettings ?? [];
  const overflowModes = new Set([
    ...DEFAULT_OVERFLOW_MODE_SETTINGS,
    ...settings
      .map(({ setting }) => setting)
      .filter(setting => OVERFLOW_MODE_SETTING.test(setting)),
  ]);
  return [
    ...settings.filter(({ setting }) => !overflowModes.has(setting)),
    ...[...overflowModes].map(setting => ({ setting, value: 'throw' })),
  ];
}

function maxResultRows(querySettings: QuerySettings | undefined): number {
  const value = Number(
    querySettings?.find(s => s.setting === 'max_result_rows')?.value,
  );
  return value > 0 ? value : Infinity;
}

export type SearchErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'CURSOR_WINDOW_TOO_DENSE';

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
  cursorState?: SearchWalk;
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

  // Windows come from the range pinned in the cursor, so boundaries stay put
  // between pages.
  const walkStart = cursorState ? new Date(cursorState.startTime) : startDate;
  const walkEnd = cursorState ? new Date(cursorState.endTime) : endDate;

  const metadata = getMetadata(clickhouseClient);

  const baseSelect = resolveSelect(source, config.select);
  // Windows are cut via a hidden select column, which would change what
  // DISTINCT deduplicates; DISTINCT is also per window. Those walks, and
  // offset-only requests, use one window over the whole range.
  const canWindow =
    typeof baseSelect === 'string' && !/^\s*DISTINCT\b/i.test(baseSelect);
  const first = await resolveFirstSearchWindow(
    source,
    effectiveOrderBy,
    walkStart,
    walkEnd,
    {
      forceSingleWindow: !cursorState || !canWindow,
      columnType: async column =>
        (
          await metadata.getColumn({
            databaseName: source.from.databaseName,
            tableName: source.from.tableName,
            column,
            connectionId: source.connection.toString(),
          })
        )?.type,
    },
  );
  const range = { start: walkStart, end: walkEnd };
  const window = cursorState?.window ?? first.window;
  const effectiveOffset = cursorState ? cursorState.offset : offset;
  const cut = cursorState ? first.cut : null;
  // A walk that can't cut its windows pages with plain offsets, so it keeps
  // the `offset` field's cap. Erroring, rather than ending the walk, keeps a
  // truncated result from looking complete.
  const requestedLimit =
    cursorState && !cut
      ? Math.min(maxResults, MAX_SINGLE_WINDOW_OFFSET - effectiveOffset)
      : maxResults;
  // A cursor walk reads one extra row to learn whether the window continues,
  // unless the source's max_result_rows leaves no room for it; then a full
  // page counts as "more in the window".
  const rowCap = maxResultRows(source.querySettings);
  const pageLimit = cursorState
    ? Math.min(requestedLimit, rowCap)
    : requestedLimit;
  const queryLimit = cursorState
    ? Math.min(pageLimit + 1, rowCap)
    : requestedLimit;
  if (cursorState && pageLimit <= 0) {
    return {
      isError: true,
      code: 'CURSOR_WINDOW_TOO_DENSE',
      message:
        'Too many matching rows to page further. Narrow the time range or the filter.',
    };
  }

  const searchBase = buildSearchChartConfig(source, {
    where: typeof config.where === 'string' ? config.where : '',
    whereLanguage: config.whereLanguage ?? 'lucene',
    select: cut
      ? `${baseSelect || '*'}, toUnixTimestamp64Milli(toDateTime64(${cut.expression}, 3)) AS ${CURSOR_TS_COLUMN}`
      : (config.select ?? null),
    displayType: DisplayType.Search,
    orderBy: effectiveOrderBy,
    ...windowBounds(window, range),
  });

  const chartConfig: ChartConfigWithDateRange = {
    ...searchBase,
    connection: source.connection.toString(),
    limit: { limit: queryLimit, offset: effectiveOffset },
  } as ChartConfigWithDateRange;

  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: cursorState
      ? withThrowingOverflow(source.querySettings)
      : source.querySettings,
  });

  if (
    result == null ||
    typeof result !== 'object' ||
    !('data' in result) ||
    !Array.isArray((result as { data: unknown }).data)
  ) {
    throw new Error('Unexpected ClickHouse response shape: missing data array');
  }

  const rows = (result as { data: unknown[] }).data as Record<
    string,
    unknown
  >[];
  const hasMoreInWindow =
    cursorState != null &&
    (rows.length > pageLimit ||
      (queryLimit === pageLimit && rows.length === pageLimit));
  const page = cursorState ? rows.slice(0, pageLimit) : rows;
  const split = cut
    ? page.map(({ [CURSOR_TS_COLUMN]: ms, ...row }) => {
        const bucket = Math.floor(Number(ms) / cut.bucketMs) * cut.bucketMs;
        if (!Number.isFinite(bucket)) {
          throw new Error(`Search result is missing ${CURSOR_TS_COLUMN}`);
        }
        return { bucket, row };
      })
    : null;
  const buckets = split?.map(r => r.bucket) ?? [];
  const data = split?.map(r => r.row) ?? page;

  // Only a cursor walk gets a next cursor; offset-only callers are unchanged.
  let nextCursorState: SearchCursorState | null = null;
  if (cursorState) {
    const pinned = {
      startTime: cursorState.startTime,
      endTime: cursorState.endTime,
    };
    if (hasMoreInWindow && cut) {
      const lastBucket = buckets[buckets.length - 1];
      let trailingRunLength = 0;
      while (buckets[buckets.length - 1 - trailingRunLength] === lastBucket) {
        trailingRunLength++;
      }
      nextCursorState = {
        ...cutWindowAtBucket({
          window,
          direction: first.direction,
          offset: effectiveOffset,
          pageLength: data.length,
          lastBucketMs: lastBucket,
          bucketMs: cut.bucketMs,
          trailingRunLength,
        }),
        ...pinned,
      };
    } else if (hasMoreInWindow) {
      nextCursorState = {
        window,
        offset: effectiveOffset + data.length,
        ...pinned,
      };
    } else {
      const nextWindow = nextSearchWindow(
        window,
        range,
        first.direction,
        first.cut?.bucketMs,
      );
      if (nextWindow) {
        nextCursorState = { window: nextWindow, offset: 0, ...pinned };
      }
    }
  }

  return { isError: false, data, nextCursorState };
}
