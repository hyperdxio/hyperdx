import { isTraceSource, TSource } from '@hyperdx/common-utils/dist/types';

import { getEventBody } from '@/source';

/**
 * Label for a row picked out of a `DBSqlRowTable` — what the side panel's
 * breadcrumb shows for the row you drilled into.
 *
 * The table selects the source's own expressions, so the body sits under its
 * expression, not under the `__hdx_body` alias `useRowData` projects. Falls
 * back to the kind of event when the row's select doesn't carry the body (or
 * carries it under an alias).
 */
export function getTableRowLabel(
  source: TSource,
  row: Record<string, unknown> | undefined,
): string {
  const bodyExpression = getEventBody(source);
  const body = bodyExpression ? row?.[bodyExpression] : undefined;
  if (typeof body === 'string') {
    // An empty body names nothing; fall through to the kind of event.
    return body.length > 0 ? body : eventKindLabel(source);
  }
  if (body != null) {
    return JSON.stringify(body);
  }
  return eventKindLabel(source);
}

function eventKindLabel(source: TSource): string {
  return isTraceSource(source) ? 'Span' : 'Log';
}
