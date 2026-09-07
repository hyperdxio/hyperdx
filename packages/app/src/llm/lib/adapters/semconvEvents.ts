import { asString, isRecord, parseMaybeJson } from '@/llm/lib/attributeUtils';
import { ChatMessage, LLMSpanEvent } from '@/llm/lib/types';

import {
  buildMessage,
  flattenContentToText,
  MessageAdapter,
  normalizeToolCalls,
} from './shared';

/**
 * Event-based OTel GenAI conventions (pre-1.37 python instrumentations,
 * OpenLIT): chat history as span events named `gen_ai.system.message`,
 * `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.tool.message`
 * and `gen_ai.choice`, plus OpenLIT's `gen_ai.content.prompt` /
 * `gen_ai.content.completion` events.
 */

const INPUT_MESSAGE_EVENTS = new Set([
  'gen_ai.system.message',
  'gen_ai.user.message',
  'gen_ai.assistant.message',
  'gen_ai.tool.message',
]);

function contentFromEvent(event: LLMSpanEvent): unknown {
  const attrs = event.attributes ?? {};
  return (
    attrs['gen_ai.event.content'] ??
    attrs['content'] ??
    attrs['gen_ai.prompt'] ??
    attrs['gen_ai.completion'] ??
    attrs['message'] ??
    (Object.keys(attrs).length > 0 ? attrs : undefined)
  );
}

function messageFromEvent(
  event: LLMSpanEvent,
  fallbackRole: string,
): ChatMessage | undefined {
  const parsed = parseMaybeJson(contentFromEvent(event));
  if (parsed == null) return undefined;

  if (isRecord(parsed)) {
    const record = parsed;
    // `gen_ai.choice` payloads nest the message under `message`.
    const inner = isRecord(record.message) ? record.message : record;
    const message = buildMessage({
      role: asString(inner.role) ?? fallbackRole,
      content: flattenContentToText(inner.content),
      toolCalls: normalizeToolCalls(inner.tool_calls),
      toolCallId: asString(inner.tool_call_id ?? record.id),
    });
    if (message) return message;
  }

  const content = flattenContentToText(parsed);
  if (content == null) return undefined;
  return { role: fallbackRole, content };
}

export const semconvEventsAdapter: MessageAdapter = {
  id: 'semconv-events',
  detect: (_attributes, events) =>
    events.some(
      event =>
        INPUT_MESSAGE_EVENTS.has(event.name) ||
        event.name === 'gen_ai.choice' ||
        event.name === 'gen_ai.content.prompt' ||
        event.name === 'gen_ai.content.completion',
    ),
  extract: (_attributes, events) => {
    const input: ChatMessage[] = [];
    const output: ChatMessage[] = [];

    for (const event of events) {
      if (INPUT_MESSAGE_EVENTS.has(event.name)) {
        // Role encoded in the event name: gen_ai.<role>.message
        const role = event.name.replace('gen_ai.', '').replace('.message', '');
        const message = messageFromEvent(event, role);
        if (message) input.push(message);
      } else if (event.name === 'gen_ai.choice') {
        const message = messageFromEvent(event, 'assistant');
        if (message) output.push(message);
      } else if (event.name === 'gen_ai.content.prompt') {
        const content = flattenContentToText(
          event.attributes?.['gen_ai.prompt'],
        );
        if (content != null) input.push({ role: 'user', content });
      } else if (event.name === 'gen_ai.content.completion') {
        const content = flattenContentToText(
          event.attributes?.['gen_ai.completion'],
        );
        if (content != null) output.push({ role: 'assistant', content });
      }
    }

    if (input.length === 0 && output.length === 0) return undefined;
    return { input, output };
  },
};
