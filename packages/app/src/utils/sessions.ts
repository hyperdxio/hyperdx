import z from 'zod';
import type {
  ConditionFilter,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { getHttpMethod, getHttpStatusCode } from './httpSpanAttributes';
import { getHttpUrl } from './httpUrl';
import {
  sessionIdFilter,
  SessionIdKey,
  traceSessionIdColumns,
} from './sessionId';
import { isSet } from './spanAttributeReaders';

export const sessionRowSchema = z.object({
  body: z.string().nullish(),
  component: z.string().nullish(),
  durationInMs: z.number(),
  'error.message': z.string().nullish(),
  'http.method': z.string().nullish(),
  'http.request.method': z.string().nullish(),
  'http.response.status_code': z.string().nullish(),
  'http.status_code': z.string().nullish(),
  'http.url': z.string().nullish(),
  id: z.string(),
  'location.href': z.string().nullish(),
  'otel.library.name': z.string(),
  parent_span_id: z.string(),
  severity_text: z.string(),
  span_id: z.string(),
  span_name: z.string(),
  timestamp: z.string(),
  trace_id: z.string(),
  type: z.string().nullish(),
  'url.full': z.string().nullish(),
});

export type SessionRow = z.infer<typeof sessionRowSchema>;

/** Reads both the stable HTTP keys (OTel SDKs) and the deprecated ones. */
export function getSessionRowHttp(row: SessionRow) {
  const statusCode = getHttpStatusCode(row);
  const method = getHttpMethod(row) ?? '';
  return {
    url: getHttpUrl(row) ?? '',
    method,
    statusCode: statusCode ?? 0,
    label: [statusCode, method].filter(isSet).join(' '),
  };
}

export function buildSessionEventFilters({
  traceSource,
  sessionId,
  sessionIdKey,
}: {
  traceSource: Pick<
    TTraceSource,
    | 'resourceAttributesExpression'
    | 'eventAttributesExpression'
    | 'spanNameExpression'
  >;
  sessionId: string;
  sessionIdKey?: SessionIdKey;
}): Record<'highlighted' | 'all', ConditionFilter[]> {
  const cols = traceSessionIdColumns(traceSource);
  const attrs = cols.attrs;
  const spanName = traceSource.spanNameExpression;
  const sessionFilter: ConditionFilter = {
    type: 'lucene',
    condition: sessionIdFilter(cols, sessionId, sessionIdKey),
  };
  const legacyEvents = `${spanName}:"routeChange"
      OR ${spanName}:"documentLoad"
      OR ${spanName}:"intercom.onShow"
      OR ScopeName:"custom-action"`;
  return {
    highlighted: [
      sessionFilter,
      {
        type: 'lucene',
        condition: `${attrs}.http.status_code:>299
      OR ${attrs}.http.response.status_code:>299
      OR ${attrs}.error.type:*
      OR ${attrs}.component:"error"
      OR ${legacyEvents}`,
      },
    ],
    all: [
      sessionFilter,
      {
        type: 'lucene',
        // url.full rather than the stable status code key, because OTel
        // network failures have no status code
        condition: `${attrs}.http.status_code:*
      OR ${attrs}.url.full:*
      OR ${attrs}.component:"console"
      OR ${attrs}.component:"error"
      OR ${legacyEvents}`,
      },
    ],
  };
}
