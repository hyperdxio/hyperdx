import sortBy from 'lodash/sortBy';
import uniqBy from 'lodash/uniqBy';
import SqlString from 'sqlstring';
import type {
  BuilderChartConfigWithDateRange,
  Filter,
  TLogSource,
} from '@hyperdx/common-utils/dist/types';

import type { WithClause } from '@/hooks/useRowWhere';
import type { PlaybarMarker } from '@/PlaybarSlider';
import {
  getDisplayedTimestampValueExpression,
  getEventBody,
  getFirstTimestampValueExpression,
} from '@/source';
import {
  BROWSER_EVENT_NAMES,
  BrowserEventLabel,
  getBrowserEventLabel,
} from '@/utils/browserEvents';
import { sessionIdFilter, SessionIdKey } from '@/utils/sessionId';
import type { SessionRow } from '@/utils/sessions';

export type SessionLogEvent = BrowserEventLabel & {
  id: string;
  timestamp: Date;
  /** The result row, which keeps the nanosecond timestamp for the row id. */
  row: Record<string, unknown>;
};

export type SessionLogEvents = {
  events: SessionLogEvent[];
  isLoading: boolean;
  open: (event: SessionLogEvent) => void;
};

/** What a click on an event list row opens. */
export type SessionEventOpen =
  | { kind: 'span'; row: SessionRow }
  | { kind: 'log'; event: SessionLogEvent };

/** Set when the event lives on a log source rather than the trace source. */
type SessionLogEventTarget = {
  sourceId: string;
  focusTimestamp: string;
};

export type SessionEventNavigate = (
  rowId: string,
  aliasWith: WithClause[],
  target?: SessionLogEventTarget,
) => void;

// Click and navigation rows have an empty Body, SpanId and SeverityText, so the
// event name and session id keep row ids unique. Body splits console calls
// made in the same millisecond. timestamp_key lets the lookup prune on tables
// keyed by another time column than the displayed one (TimestampTime).
export const SESSION_LOG_EVENT_KEY_COLUMNS = new Set([
  'timestamp',
  'timestamp_key',
  'event_name',
  'session_id',
  'body',
]);

const { CLICK, NAVIGATION, CONSOLE, EXCEPTION } = BROWSER_EVENT_NAMES;

/**
 * Highlighted keeps what the legacy SDK's tab showed: navigations, exceptions
 * and console errors. Filtered on the server, as spans are, so a console flood
 * can't push them past the row limit.
 */
function eventNameCondition(
  eventName: string,
  consoleMethodExpression: string,
  highlighted: boolean,
): string {
  return highlighted
    ? SqlString.format('? IN (?) OR (? = ? AND ? = ?)', [
        SqlString.raw(eventName),
        [NAVIGATION, EXCEPTION],
        SqlString.raw(eventName),
        CONSOLE,
        SqlString.raw(consoleMethodExpression),
        'error',
      ])
    : SqlString.format('? IN (?)', [
        SqlString.raw(eventName),
        [CLICK, NAVIGATION, EXCEPTION, CONSOLE],
      ]);
}

/** Null when the session has no browser log events to query. */
export function buildSessionLogEventsQuery({
  logSource,
  sessionId,
  sessionIdKey,
  serviceName,
  searchedQuery,
  dateRange,
  tab,
  sessionIdExpression,
  consoleMethodExpression,
}: {
  logSource: TLogSource | undefined;
  sessionId: string;
  sessionIdKey: SessionIdKey | undefined;
  serviceName: string;
  searchedQuery: string;
  dateRange: [Date, Date];
  tab: string;
  sessionIdExpression: string | undefined;
  consoleMethodExpression: string | undefined;
}): {
  config: BuilderChartConfigWithDateRange;
  aliasMap: Record<string, string>;
} | null {
  const attrs = logSource?.eventAttributesExpression;
  // Only OTel browser SDKs write these events, and the search box is written
  // against trace fields.
  if (
    sessionIdKey !== 'session.id' ||
    searchedQuery !== '' ||
    !logSource?.eventNameExpression ||
    !attrs ||
    !sessionIdExpression ||
    !consoleMethodExpression
  ) {
    return null;
  }
  // toString: a JSON path is Dynamic, which IN rejects.
  const eventName = `toString(${logSource.eventNameExpression})`;
  const timestamp = getDisplayedTimestampValueExpression(logSource);
  const timestampKey = getFirstTimestampValueExpression(
    logSource.timestampValueExpression,
  );
  const body = getEventBody(logSource);
  const aliasMap: Record<string, string> = {
    timestamp,
    ...(timestampKey !== timestamp ? { timestamp_key: timestampKey } : {}),
    event_name: eventName,
    session_id: sessionIdExpression,
    ...(body ? { body } : {}),
    attributes: attrs,
  };
  const filters: Filter[] = [
    {
      type: 'lucene',
      condition: sessionIdFilter(
        {
          resource:
            logSource.resourceAttributesExpression ?? 'ResourceAttributes',
          attrs,
        },
        sessionId,
        'session.id',
      ),
    },
    {
      type: 'sql',
      condition: eventNameCondition(
        eventName,
        consoleMethodExpression,
        tab === 'highlighted',
      ),
    },
  ];
  // Matches the replay query, and keeps backend exceptions that carry a
  // propagated session.id off the browser timeline.
  if (logSource.serviceNameExpression && serviceName) {
    filters.push({
      type: 'sql',
      condition: SqlString.format('? = ?', [
        SqlString.raw(logSource.serviceNameExpression),
        serviceName,
      ]),
    });
  }
  return {
    aliasMap,
    config: {
      source: logSource.id,
      select: Object.entries(aliasMap).map(([alias, valueExpression]) => ({
        valueExpression,
        alias,
      })),
      from: logSource.from,
      connection: logSource.connection,
      timestampValueExpression: logSource.timestampValueExpression,
      dateRange,
      where: '',
      whereLanguage: 'sql',
      filters,
      orderBy: `${timestamp} ASC`,
      limit: { limit: 4000, offset: 0 },
    },
  };
}

export function toSessionLogEvents(
  rows: Record<string, unknown>[],
): SessionLogEvent[] {
  return rows.map((row, index) => ({
    ...getBrowserEventLabel({
      eventName: String(row.event_name ?? ''),
      body: row.body,
      attributes: row.attributes,
    }),
    id: `log-${index}`,
    timestamp: new Date(String(row.timestamp)),
    row,
  }));
}

/** Returns `spanMarkers` itself when no log event falls in the range. */
export function mergeLogMarkers(
  spanMarkers: PlaybarMarker[],
  logEvents: SessionLogEvent[],
  minTs: number,
  maxTs: number,
): PlaybarMarker[] {
  const logMarkers = logEvents
    .map(event => ({
      id: event.id,
      ts: event.timestamp.getTime(),
      description: event.timelineText,
      isError: event.isError,
      isSuccess: false,
    }))
    .filter(({ ts }) => ts >= minTs && ts <= maxTs);
  if (logMarkers.length === 0) {
    return spanMarkers;
  }
  // Same bucketing as the span markers, which are already one per percent.
  return uniqBy(sortBy([...spanMarkers, ...logMarkers], 'ts'), ({ ts }) =>
    Math.round(((ts - minTs) / (maxTs - minTs)) * 100),
  );
}
