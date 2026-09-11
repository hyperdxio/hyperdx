import { TSource } from '@hyperdx/common-utils/dist/types';

import { quoteIdentifierIfNeeded } from '@/utils';

function getTraceIdExpression(source: TSource): string | undefined {
  return 'traceIdExpression' in source && source.traceIdExpression
    ? source.traceIdExpression
    : undefined;
}

/**
 * Builds the where clause for a "Search for this value only" action on an
 * event from a correlated source (e.g. a log attribute clicked while viewing
 * a trace search), keeping the searched source instead of pivoting to the
 * event's source. The condition is expressed as a plain SQL subquery on the
 * shared trace id:
 *
 *   <searched tid> IN (SELECT <event tid> FROM <event table> WHERE <condition>)
 *
 * so it lands in the search box where the user can see and edit it. Like the
 * same-source action, it replaces the search box; filters and select are
 * preserved by the caller.
 */
export function buildCorrelatedSearchWhere({
  searchedSource,
  eventSource,
  eventWhere,
}: {
  searchedSource: TSource;
  eventSource: TSource;
  /** SQL condition on the event's own source (e.g. the clicked attribute). */
  eventWhere: string;
}): string {
  // Same default as buildDirectTraceWhereClause: assume the OTel column name
  // when a source doesn't configure one.
  const searchedTraceId = getTraceIdExpression(searchedSource) ?? 'TraceId';
  const eventTraceId = getTraceIdExpression(eventSource) ?? 'TraceId';
  const { databaseName, tableName } = eventSource.from ?? {};
  const quotedTable = tableName
    ? quoteIdentifierIfNeeded(tableName)
    : tableName;
  const eventTable = databaseName
    ? `${quoteIdentifierIfNeeded(databaseName)}.${quotedTable}`
    : quotedTable;

  return `${searchedTraceId} IN (SELECT ${eventTraceId} FROM ${eventTable} WHERE ${eventWhere.trim()})`;
}
