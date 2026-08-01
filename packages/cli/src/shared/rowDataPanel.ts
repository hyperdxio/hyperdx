/**
 * Row data panel helpers.
 *
 * @source packages/app/src/components/DBRowDataPanel.tsx
 *
 * Contains ROW_DATA_ALIASES and the SELECT list builder for the full row
 * fetch query. Same exports as the web frontend for future move to common-utils.
 */

import type { SelectList } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';
import {
  getDisplayedTimestampValueExpression,
  getEventBody,
  isLogSource,
  isTraceSource,
} from '@/shared/source';

export enum ROW_DATA_ALIASES {
  TIMESTAMP = '__hdx_timestamp',
  BODY = '__hdx_body',
  TRACE_ID = '__hdx_trace_id',
  SPAN_ID = '__hdx_span_id',
  SEVERITY_TEXT = '__hdx_severity_text',
  SERVICE_NAME = '__hdx_service_name',
  RESOURCE_ATTRIBUTES = '__hdx_resource_attributes',
  EVENT_ATTRIBUTES = '__hdx_event_attributes',
  EVENTS_EXCEPTION_ATTRIBUTES = '__hdx_events_exception_attributes',
  SPAN_EVENTS = '__hdx_span_events',
}

/**
 * Build the SELECT list with __hdx_* aliases for a full row fetch,
 * matching the web frontend's useRowData in DBRowDataPanel.tsx.
 */
export function buildRowDataSelectList(source: SourceResponse): SelectList {
  const select: SelectList = [{ valueExpression: '*' }];

  const add = (expr: string | undefined, alias: string) => {
    if (expr) select.push({ valueExpression: expr, alias });
  };

  add(getDisplayedTimestampValueExpression(source), ROW_DATA_ALIASES.TIMESTAMP);

  const eventBodyExpr = getEventBody(source);
  add(eventBodyExpr ?? undefined, ROW_DATA_ALIASES.BODY);

  if (isLogSource(source) || isTraceSource(source)) {
    add(source.traceIdExpression, ROW_DATA_ALIASES.TRACE_ID);
    add(source.spanIdExpression, ROW_DATA_ALIASES.SPAN_ID);
    add(source.serviceNameExpression, ROW_DATA_ALIASES.SERVICE_NAME);
  }

  if (isLogSource(source)) {
    add(source.severityTextExpression, ROW_DATA_ALIASES.SEVERITY_TEXT);
  } else if (isTraceSource(source)) {
    add(source.statusCodeExpression, ROW_DATA_ALIASES.SEVERITY_TEXT);
  }

  add(
    source.resourceAttributesExpression,
    ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES,
  );

  if (isLogSource(source) || isTraceSource(source)) {
    add(source.eventAttributesExpression, ROW_DATA_ALIASES.EVENT_ATTRIBUTES);
  }

  return select;
}
