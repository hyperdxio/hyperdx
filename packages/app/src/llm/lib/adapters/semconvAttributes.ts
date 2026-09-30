import { asString, isRecord, parseMaybeJson } from '@/llm/lib/attributeUtils';
import { ChatMessage, ChatToolCall } from '@/llm/lib/types';

import {
  buildMessage,
  flattenContentToText,
  MessageAdapter,
  stringifyArguments,
} from './shared';

/**
 * Current OTel GenAI semantic conventions (>= 1.37): full chat history as
 * JSON in `gen_ai.input.messages` / `gen_ai.output.messages`, with messages
 * shaped `{ role, parts: [{ type, ... }] }`. Also handles the transitional
 * whole-payload attributes `gen_ai.prompt` / `gen_ai.completion` (as emitted
 * by OpenLIT and some vendor SDKs) and `gen_ai.system_instructions`.
 */

function partsToMessage(raw: unknown): ChatMessage | undefined {
  if (!isRecord(raw)) return undefined;
  const record = raw;
  const role = asString(record.role);

  // Plain `{ role, content }` message (no parts array).
  if (!Array.isArray(record.parts)) {
    return buildMessage({
      role,
      content: flattenContentToText(record.content),
      toolCalls: undefined,
    });
  }

  const texts: string[] = [];
  const toolCalls: ChatToolCall[] = [];
  let toolCallId: string | undefined;
  for (const part of record.parts) {
    if (!isRecord(part)) continue;
    const partRecord = part;
    const type = asString(partRecord.type);
    if (type === 'tool_call') {
      const name = asString(partRecord.name);
      if (name !== undefined) {
        const toolCall: ChatToolCall = { name };
        const id = asString(partRecord.id);
        if (id !== undefined) toolCall.id = id;
        const args = stringifyArguments(partRecord.arguments);
        if (args !== undefined) toolCall.arguments = args;
        toolCalls.push(toolCall);
      }
    } else if (type === 'tool_call_response') {
      toolCallId = asString(partRecord.id) ?? toolCallId;
      const response = flattenContentToText(
        partRecord.response ?? partRecord.result,
      );
      if (response != null) texts.push(response);
    } else {
      const text = flattenContentToText(partRecord.content ?? partRecord.text);
      if (text != null) texts.push(text);
    }
  }
  return buildMessage({
    role,
    content: texts.length > 0 ? texts.join('\n') : null,
    toolCalls,
    toolCallId,
  });
}

function parseMessagesAttribute(value: unknown): ChatMessage[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(partsToMessage)
    .filter((message): message is ChatMessage => message !== undefined);
}

function parseSystemInstructions(value: unknown): ChatMessage | undefined {
  const content = flattenContentToText(value);
  if (content == null) return undefined;
  return { role: 'system', content };
}

export const semconvAttributesAdapter: MessageAdapter = {
  id: 'semconv-attributes',
  detect: attributes =>
    attributes['gen_ai.input.messages'] != null ||
    attributes['gen_ai.output.messages'] != null ||
    attributes['gen_ai.system_instructions'] != null ||
    attributes['gen_ai.prompt'] != null ||
    attributes['gen_ai.completion'] != null ||
    attributes['gen_ai.tool.call.arguments'] != null,
  extract: attributes => {
    const input: ChatMessage[] = [];
    const output: ChatMessage[] = [];

    const system = parseSystemInstructions(
      attributes['gen_ai.system_instructions'],
    );
    if (system) input.push(system);

    input.push(...parseMessagesAttribute(attributes['gen_ai.input.messages']));
    output.push(
      ...parseMessagesAttribute(attributes['gen_ai.output.messages']),
    );

    // Transitional whole-payload attributes.
    if (input.length === (system ? 1 : 0)) {
      const prompt = flattenContentToText(attributes['gen_ai.prompt']);
      if (prompt != null) input.push({ role: 'user', content: prompt });
    }
    if (output.length === 0) {
      const completion = flattenContentToText(attributes['gen_ai.completion']);
      if (completion != null) {
        output.push({ role: 'assistant', content: completion });
      }
    }

    // Tool-execution spans: arguments in, result out.
    const toolArgs = stringifyArguments(
      attributes['gen_ai.tool.call.arguments'],
    );
    const toolName = asString(attributes['gen_ai.tool.name']);
    if (input.length === 0 && toolArgs !== undefined) {
      input.push({
        role: 'assistant',
        content: null,
        toolCalls: [{ name: toolName ?? 'tool', arguments: toolArgs }],
      });
    }
    const toolResult = flattenContentToText(
      attributes['gen_ai.tool.call.result'],
    );
    if (output.length === 0 && toolResult != null) {
      output.push({ role: 'tool', content: toolResult, name: toolName });
    }

    if (input.length === 0 && output.length === 0) return undefined;
    return { input, output };
  },
};
