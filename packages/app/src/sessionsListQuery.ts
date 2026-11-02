import { ChSql, chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  Filter,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import type { FieldExpressionGenerator } from './hooks/useFieldExpressionGenerator';
import {
  anySessionIdPresence,
  rumSessionIdPresence,
  sessionIdKeyExpr,
  sessionTableSessionIdColumns,
} from './utils/sessionId';

/**
 * The service scope keeps the `session.id` check off spans outside the replay
 * services and makes the session table's `ServiceName` match the trace service
 * names, so both halves group into the same rows. The recordings half also
 * needs the trace source's connection.
 */
export function isOtelSessionListEnabled({
  traceSource,
  sessionSource,
  serviceScopeFilters,
}: {
  traceSource: TTraceSource;
  sessionSource: TSessionSource;
  serviceScopeFilters: Filter[];
}): boolean {
  return (
    traceSource.connection === sessionSource.connection &&
    serviceScopeFilters.length > 0
  );
}

/** Sessions with replay rows, so sessions without matching spans are listed too. */
export function buildRecordingsChartConfig({
  sessionSource,
  dateRange,
  getSessionSourceFieldExpression,
}: {
  sessionSource: TSessionSource;
  dateRange: [Date, Date];
  getSessionSourceFieldExpression: FieldExpressionGenerator;
}): BuilderChartConfigWithDateRange {
  const timestamp = getFirstTimestampValueExpression(
    sessionSource.timestampValueExpression,
  );
  return {
    select: [
      { valueExpression: 'ServiceName', alias: 'serviceName' },
      {
        valueExpression: sessionIdKeyExpr(
          getSessionSourceFieldExpression,
          sessionTableSessionIdColumns(),
        ),
        alias: 'sessionId',
      },
      { valueExpression: `MAX(${timestamp})`, alias: 'maxTimestamp' },
      { valueExpression: `MIN(${timestamp})`, alias: 'minTimestamp' },
      {
        aggFn: 'count',
        aggConditionLanguage: 'lucene',
        aggCondition: rumSessionIdPresence(sessionTableSessionIdColumns()),
        valueExpression: '',
        alias: 'rumRows',
      },
    ],
    from: sessionSource.from,
    dateRange,
    where: anySessionIdPresence(sessionTableSessionIdColumns()),
    whereLanguage: 'lucene',
    timestampValueExpression: sessionSource.timestampValueExpression,
    connection: sessionSource.connection,
    groupBy: [
      { valueExpression: 'serviceName' },
      { valueExpression: 'sessionId' },
    ],
    selectGroupBy: false,
  };
}

/** `session.id` sessions in the list CTE that have replay rows. */
export function buildOtelSessionIdsWithRecordingsChartConfig({
  sessionSource,
  dateRange,
  getSessionSourceFieldExpression,
  sessionsCteName,
}: {
  sessionSource: TSessionSource;
  dateRange: [Date, Date];
  getSessionSourceFieldExpression: FieldExpressionGenerator;
  sessionsCteName: string;
}): BuilderChartConfigWithDateRange {
  const otelSessionId = getSessionSourceFieldExpression(
    sessionTableSessionIdColumns().attrs,
    'session.id',
  );
  return {
    select: [
      { valueExpression: `DISTINCT ${otelSessionId}`, alias: 'sessionId' },
    ],
    from: sessionSource.from,
    dateRange,
    where: `${otelSessionId} IN (SELECT ${sessionsCteName}.sessionId FROM ${sessionsCteName})`,
    whereLanguage: 'sql',
    timestampValueExpression: sessionSource.timestampValueExpression,
    connection: sessionSource.connection,
  };
}

/**
 * Two single-key `IN` lookups stay index-served where one OR lookup wouldn't.
 * This only tests membership, so a session with both keys can't count twice.
 */
export function unionSessionIds(rumIds: ChSql, otelIds: ChSql | undefined) {
  return otelIds == null
    ? rumIds
    : chSql`SELECT sessionId FROM (${rumIds}) UNION DISTINCT SELECT sessionId FROM (${otelIds})`;
}

/**
 * Merges the span and recordings halves into one row per (service, session).
 * Legacy sessions with spans keep span-only times; others use both halves.
 * Inner aliases differ from outer ones because reusing them raises
 * ILLEGAL_AGGREGATION.
 */
export function buildSessionsCtes({
  name,
  spans,
  recordings,
  withActivityFilter,
}: {
  name: string;
  spans: ChSql;
  recordings: ChSql | undefined;
  withActivityFilter: boolean;
}): ChSql {
  const recordingsUnion =
    recordings != null
      ? `UNION ALL
      SELECT serviceName AS svc, sessionId AS sid, maxTimestamp AS maxTs,
        minTimestamp AS minTs, 0 AS spans, 0 AS errors, 0 AS interactions,
        0 AS recordInits, rumRows, '' AS email, '' AS name, '' AS tid,
        '' AS tname, 1 AS fromReplay
      FROM _recordings`
      : '';
  const having = withActivityFilter
    ? `HAVING ${recordings != null ? 'max(fromReplay) = 1 OR ' : ''}interactionCount > 0 OR recordingCount > 0`
    : '';
  return chSql`
    WITH _spans AS (${spans}),
    ${recordings != null ? chSql`_recordings AS (${recordings}),` : ''}
    ${name} AS (
      SELECT svc AS serviceName, sid AS sessionId,
        if(sum(rumRows) > 0, 'rum.sessionId', 'session.id') AS sessionIdKey,
        if(sum(rumRows) > 0 AND sum(spans) > 0, maxIf(maxTs, fromReplay = 0), max(maxTs)) AS maxTimestamp,
        if(sum(rumRows) > 0 AND sum(spans) > 0, minIf(minTs, fromReplay = 0), min(minTs)) AS minTimestamp,
        sum(spans) AS sessionCount, sum(errors) AS errorCount,
        sum(interactions) AS interactionCount, sum(recordInits) AS recordingCount,
        ifNull(max(email), '') AS userEmail, ifNull(max(name), '') AS userName,
        max(tid) AS teamId, max(tname) AS teamName
      FROM (
        SELECT serviceName AS svc, sessionId AS sid, maxTimestamp AS maxTs,
          minTimestamp AS minTs, sessionCount AS spans, errorCount AS errors,
          interactionCount AS interactions, recordingCount AS recordInits,
          rumRows, userEmail AS email, userName AS name, teamId AS tid,
          teamName AS tname, 0 AS fromReplay
        FROM _spans
        ${recordingsUnion}
      )
      GROUP BY svc, sid
      ${having}
      ORDER BY maxTimestamp DESC
      LIMIT 500
    )
  `;
}
