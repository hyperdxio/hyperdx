import SqlString from 'sqlstring';
import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import { BROWSER_EVENT_NAMES } from '@/utils/browserEvents';
import {
  BrowserEventLogSource,
  BrowserEventResult,
  BrowserTraceContext,
  getBrowserEventDateRange,
  hasSubSecondTimestamps,
  parseRowTimeMs,
} from '@/utils/browserTraceContext';
import { getSessionLogEventQueryParts } from '@/utils/sessionLogEvents';

// Clicks land 0-5 ms before the request they start; the click before that is
// usually several hundred ms earlier.
const TRIGGER_LOOKBACK_MS = 250;
// The floored window holds at most about 2 s of one session's clicks.
const TRIGGER_CLICK_LIMIT = 10;

export function buildTriggerClickQuery({
  logSource,
  context,
  sessionId,
  sessionIdExpression,
}: {
  logSource: BrowserEventLogSource;
  context: BrowserTraceContext;
  sessionId: string;
  sessionIdExpression: string;
}): {
  config: BuilderChartConfigWithDateRange;
  aliasMap: Record<string, string>;
} {
  const { aliasMap, select, sessionFilter, serviceFilters } =
    getSessionLogEventQueryParts({
      logSource,
      sessionId,
      serviceName: context.serviceName,
      sessionIdExpression,
    });
  return {
    aliasMap,
    config: {
      source: logSource.id,
      select,
      from: logSource.from,
      connection: logSource.connection,
      timestampValueExpression: logSource.timestampValueExpression,
      // pickTriggerClick clips to the exact window.
      dateRange: getBrowserEventDateRange(
        context.anchorMs - TRIGGER_LOOKBACK_MS,
        context.anchorMs,
      ),
      where: '',
      whereLanguage: 'sql',
      filters: [
        sessionFilter,
        {
          type: 'sql',
          condition: SqlString.format('? = ?', [
            SqlString.raw(aliasMap.event_name),
            BROWSER_EVENT_NAMES.CLICK,
          ]),
        },
        ...serviceFilters,
      ],
      orderBy: `${aliasMap.timestamp} DESC`,
      limit: { limit: TRIGGER_CLICK_LIMIT },
    },
  };
}

/**
 * The latest click in the lookback before the anchor. The page URL isn't
 * compared: the SDK records a click's URL before the app's handler runs, and
 * the request's after, so a click that changes the route or query string
 * would never match. Clicks in a whole-second timestamp column can't be
 * placed within the lookback, so none match.
 */
export function pickTriggerClick(
  { data, meta }: BrowserEventResult,
  anchorMs: number,
): { row: Record<string, unknown>; gapMs: number } | undefined {
  if (!hasSubSecondTimestamps(meta)) {
    return undefined;
  }
  let latest: { row: Record<string, unknown>; ms: number } | undefined;
  for (const row of data) {
    const ms = parseRowTimeMs(row.timestamp);
    if (
      ms != null &&
      ms >= anchorMs - TRIGGER_LOOKBACK_MS &&
      ms <= anchorMs &&
      (latest == null || ms > latest.ms)
    ) {
      latest = { row, ms };
    }
  }
  return latest != null
    ? { row: latest.row, gapMs: anchorMs - latest.ms }
    : undefined;
}
