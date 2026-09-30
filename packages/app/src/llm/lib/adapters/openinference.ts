import {
  asString,
  hasKeyWithPrefix,
  isRecord,
  keyPathsToArray,
  parseMaybeJson,
} from '@/llm/lib/attributeUtils';
import { ChatMessage, ChatToolCall } from '@/llm/lib/types';

import {
  buildMessage,
  flattenContentToText,
  MessageAdapter,
  normalizeToolCalls,
  stringifyArguments,
} from './shared';

/**
 * OpenInference (Arize) key-path attributes:
 * `llm.input_messages.{i}.message.role` / `.message.content`, tool calls at
 * `.message.tool_calls.{j}.tool_call.function.{name,arguments}`. Falls back
 * to the whole-payload `input.value` / `output.value` attributes.
 */

function toToolCalls(raw: unknown): ChatToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!isRecord(item)) return [];
    const wrapper = item.tool_call ?? item;
    if (!isRecord(wrapper)) return [];
    const record = wrapper;
    const fn = isRecord(record.function) ? record.function : record;
    const name = asString(fn.name);
    if (name === undefined) return [];
    const toolCall: ChatToolCall = { name };
    const id = asString(record.id);
    if (id !== undefined) toolCall.id = id;
    const args = stringifyArguments(fn.arguments);
    if (args !== undefined) toolCall.arguments = args;
    return [toolCall];
  });
}

function toMessages(items: Record<string, unknown>[]): ChatMessage[] {
  return items.flatMap(item => {
    const raw = item.message ?? item;
    if (!isRecord(raw)) return [];
    const record = raw;
    const contents = Array.isArray(record.contents)
      ? // `message.contents.{j}.message_content.{text,type}` part lists
        record.contents
          .map(part => {
            const wrapped = isRecord(part)
              ? (part.message_content ?? part)
              : part;
            return flattenContentToText(wrapped);
          })
          .filter((text): text is string => text != null)
          .join('\n')
      : null;
    const message = buildMessage({
      role: asString(record.role),
      content: contents || flattenContentToText(record.content),
      toolCalls: toToolCalls(record.tool_calls),
      toolCallId: asString(record.tool_call_id),
      name: asString(record.name),
    });
    return message ? [message] : [];
  });
}

function fallbackFromValue(
  value: unknown,
  role: string,
): ChatMessage | undefined {
  const parsed = parseMaybeJson(value);
  if (parsed == null) return undefined;
  if (isRecord(parsed)) {
    const record = parsed;
    if (Array.isArray(record.messages)) {
      // Prefer structured messages when the payload carries them; caller
      // renders them via toMessages, so signal by returning undefined here.
      return undefined;
    }
  }
  const content = flattenContentToText(parsed);
  if (content == null) return undefined;
  return { role, content };
}

/**
 * Some emitters (e.g. opencode) write `llm.input_messages` /
 * `llm.output_messages` as one JSON-string attribute containing the whole
 * message array, instead of key-path attributes.
 */
function wholeStringMessages(value: unknown): ChatMessage[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return toMessages(
    parsed.filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object',
    ),
  );
}

export const openinferenceAdapter: MessageAdapter = {
  id: 'openinference',
  detect: attributes =>
    hasKeyWithPrefix(attributes, 'llm.input_messages') ||
    hasKeyWithPrefix(attributes, 'llm.output_messages') ||
    (attributes['openinference.span.kind'] != null &&
      (attributes['input.value'] != null ||
        attributes['output.value'] != null)),
  extract: attributes => {
    const input = toMessages(keyPathsToArray(attributes, 'llm.input_messages'));
    const output = toMessages(
      keyPathsToArray(attributes, 'llm.output_messages'),
    );

    if (input.length === 0) {
      input.push(...wholeStringMessages(attributes['llm.input_messages']));
    }
    if (output.length === 0) {
      output.push(...wholeStringMessages(attributes['llm.output_messages']));
    }

    if (input.length === 0) {
      const parsed = parseMaybeJson(attributes['input.value']);
      if (isRecord(parsed) && Array.isArray(parsed.messages)) {
        input.push(
          ...toMessages(
            parsed.messages.filter((item): item is Record<string, unknown> =>
              isRecord(item),
            ),
          ),
        );
      } else {
        const fallback = fallbackFromValue(attributes['input.value'], 'user');
        if (fallback) input.push(fallback);
      }
    }
    if (output.length === 0) {
      const fallback = fallbackFromValue(
        attributes['output.value'],
        'assistant',
      );
      if (fallback) output.push(fallback);
      // Tool calls surfaced as a whole-list attribute on some versions.
      const toolCalls = normalizeToolCalls(attributes['llm.tools']);
      if (fallback == null && toolCalls.length > 0) {
        output.push({ role: 'assistant', content: null, toolCalls });
      }
    }

    if (input.length === 0 && output.length === 0) return undefined;
    return { input, output };
  },
};
