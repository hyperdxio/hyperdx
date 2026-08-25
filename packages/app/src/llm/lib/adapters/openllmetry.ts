import {
  asString,
  hasKeyWithPrefix,
  isRecord,
  keyPathsToArray,
} from '@/llm/lib/attributeUtils';
import { ChatMessage, ChatToolCall } from '@/llm/lib/types';

import {
  buildMessage,
  flattenContentToText,
  MessageAdapter,
  stringifyArguments,
} from './shared';

/**
 * OpenLLMetry (Traceloop) flattens messages into indexed key-path
 * attributes: `gen_ai.prompt.{i}.role`, `gen_ai.prompt.{i}.content`,
 * `gen_ai.completion.{i}.tool_calls.{j}.name`, etc. Reconstructs the arrays
 * and normalizes each entry.
 */

function toToolCalls(raw: unknown): ChatToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!isRecord(item)) return [];
    const record = item;
    // Either flat {name, arguments} or nested {function: {name, arguments}}.
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

function toMessage(item: Record<string, unknown>): ChatMessage | undefined {
  return buildMessage({
    role: asString(item.role),
    content: flattenContentToText(item.content),
    toolCalls: toToolCalls(item.tool_calls),
    toolCallId: asString(item.tool_call_id),
    name: asString(item.name),
  });
}

export const openllmetryAdapter: MessageAdapter = {
  id: 'openllmetry',
  detect: attributes =>
    hasKeyWithPrefix(attributes, 'gen_ai.prompt.') ||
    hasKeyWithPrefix(attributes, 'gen_ai.completion.'),
  extract: attributes => {
    const input = keyPathsToArray(attributes, 'gen_ai.prompt')
      .map(toMessage)
      .filter((message): message is ChatMessage => message !== undefined);
    const output = keyPathsToArray(attributes, 'gen_ai.completion')
      .map(item => toMessage(item))
      .filter((message): message is ChatMessage => message !== undefined)
      .map(message => ({
        ...message,
        role: message.role === 'unknown' ? 'assistant' : message.role,
      }));

    if (input.length === 0 && output.length === 0) return undefined;
    return { input, output };
  },
};
