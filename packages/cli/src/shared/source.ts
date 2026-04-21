/**
 * Source helper functions.
 *
 * @source packages/app/src/source.ts
 *
 * Only the pure functions needed by the CLI are included (no React hooks,
 * no API calls, no Mantine notifications).
 *
 * Same exports as the web frontend so they can be moved to common-utils later.
 */

import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';

import type { SourceResponse } from '@/api/client';

// If a user specifies a timestampValueExpression with multiple columns,
// this will return the first one. We'll want to refine this over time
export function getFirstTimestampValueExpression(valueExpression: string) {
  return splitAndTrimWithBracket(valueExpression)[0];
}

export function getDisplayedTimestampValueExpression(
  eventModel: SourceResponse,
) {
  return (
    eventModel.displayedTimestampValueExpression ??
    getFirstTimestampValueExpression(
      eventModel.timestampValueExpression ?? 'TimestampTime',
    )
  );
}

export function getEventBody(eventModel: SourceResponse) {
  let expression: string | undefined;
  if (eventModel.kind === 'trace') {
    expression = eventModel.spanNameExpression ?? undefined;
  } else if (eventModel.kind === 'log') {
    expression = eventModel.bodyExpression;
  }
  const multiExpr = splitAndTrimWithBracket(expression ?? '');
  return multiExpr.length === 1 ? expression : multiExpr[0];
}

export function isLogSource(source: SourceResponse): boolean {
  return source.kind === 'log';
}

export function isTraceSource(source: SourceResponse): boolean {
  return source.kind === 'trace';
}
