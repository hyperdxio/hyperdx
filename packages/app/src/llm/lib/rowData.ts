import {
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { isRecord } from './attributeUtils';
import { isLLMSpan } from './detect';
import { asLLMEvents, extractLLMSpanInfo } from './extract';
import { extractConversation } from './messages';
import {
  LLMConversation,
  LLMSpanEvent,
  LLMSpanInfo,
  SpanAttributeMap,
} from './types';

// Row aliases owned by DBRowDataPanel's useRowData select. Duplicated string
// literals would drift; import cycle prevents importing the component enum
// here, so keep these in sync with ROW_DATA_ALIASES.
const EVENT_ATTRIBUTES_ALIAS = '__hdx_event_attributes';
const SPAN_EVENTS_ALIAS = '__hdx_span_events';

/**
 * Pull the span attributes map out of a row fetched by `useRowData` (or the
 * waterfall query), preferring the dedicated alias and falling back to the
 * source's raw attribute column.
 */
export function getRowAttributes(
  source: TSource,
  row: Record<string, unknown> | undefined | null,
): SpanAttributeMap | undefined {
  if (row == null) return undefined;
  const attributesExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.eventAttributesExpression
      : undefined;
  const candidate =
    row[EVENT_ATTRIBUTES_ALIAS] ??
    (attributesExpr != null ? row[attributesExpr] : undefined) ??
    row['SpanAttributes'];
  return isRecord(candidate) ? candidate : undefined;
}

/** Pull span events out of a `useRowData` row. */
export function getRowSpanEvents(
  row: Record<string, unknown> | undefined | null,
): LLMSpanEvent[] {
  if (row == null) return [];
  return asLLMEvents(row[SPAN_EVENTS_ALIAS] ?? row['Events']);
}

export interface LLMRowData {
  isLLM: boolean;
  info: LLMSpanInfo | undefined;
  conversation: LLMConversation | undefined;
}

/** One-stop extraction of all LLM data from a row-data row. */
export function getLLMRowData(
  source: TSource,
  row: Record<string, unknown> | undefined | null,
): LLMRowData {
  const attributes = getRowAttributes(source, row);
  const events = getRowSpanEvents(row);
  if (!isLLMSpan(attributes, events)) {
    return { isLLM: false, info: undefined, conversation: undefined };
  }
  return {
    isLLM: true,
    info: extractLLMSpanInfo(attributes, events),
    conversation: extractConversation(attributes, events),
  };
}
