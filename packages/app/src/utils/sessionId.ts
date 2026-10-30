import type { TTraceSource } from '@hyperdx/common-utils/dist/types';

import type { FieldExpressionGenerator } from '@/hooks/useFieldExpressionGenerator';
import { SESSION_TABLE_EXPRESSIONS } from '@/source';

/** `rum.sessionId` is the legacy HyperDX SDK's key, `session.id` is OTel's. */
export type SessionIdKey = 'rum.sessionId' | 'session.id';

type SessionIdColumns = { resource: string; attrs: string };

// The session source has no event attributes setting, the player already
// hardcodes these columns, and isValidSessionsTable requires both, so a bad
// custom resource expression can't break the list or the player. Read on call:
// test suites that stub '@/source' import this module indirectly.
export function sessionTableSessionIdColumns(): SessionIdColumns {
  return {
    resource: SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression,
    attrs: SESSION_TABLE_EXPRESSIONS.eventAttributesExpression,
  };
}

export function traceSessionIdColumns(
  source: Pick<
    TTraceSource,
    'resourceAttributesExpression' | 'eventAttributesExpression'
  >,
): SessionIdColumns {
  return {
    resource: source.resourceAttributesExpression ?? 'ResourceAttributes',
    attrs: source.eventAttributesExpression ?? 'SpanAttributes',
  };
}

/**
 * One key per row for grouping. `rum.sessionId` wins because legacy SDK spans
 * can carry an app's own `session.id` while their replay rows carry only
 * `rum.sessionId`; rows where the collector copied one key to the other hold
 * equal values.
 */
export function sessionIdKeyExpr(
  getFieldExpression: FieldExpressionGenerator,
  cols: SessionIdColumns,
): string {
  const rumSessionId = getFieldExpression(cols.resource, 'rum.sessionId');
  return `if(${rumSessionId} != '', ${rumSessionId}, ${getFieldExpression(cols.attrs, 'session.id')})`;
}

/**
 * A lookup on the one key the session uses. An OR of both keys can't use skip
 * indexes before ClickHouse 25.12 (`use_skip_indexes_for_disjunctions`).
 */
export function sessionIdFilter(
  cols: SessionIdColumns,
  sessionId: string,
  key: SessionIdKey = 'rum.sessionId',
): string {
  return key === 'session.id'
    ? `${cols.attrs}.session.id:"${sessionId}"`
    : `${cols.resource}.rum.sessionId:"${sessionId}"`;
}

export function rumSessionIdPresence(cols: SessionIdColumns): string {
  return `${cols.resource}.rum.sessionId:*`;
}

export function anySessionIdPresence(cols: SessionIdColumns): string {
  return `${rumSessionIdPresence(cols)} OR ${cols.attrs}.session.id:*`;
}
