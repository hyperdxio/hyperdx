import { asString, isRecord, parseMaybeJson } from '@/llm/lib/attributeUtils';
import { ChatMessage } from '@/llm/lib/types';

import {
  buildMessage,
  flattenContentToText,
  MessageAdapter,
  normalizeToolCalls,
} from './shared';

/**
 * Vercel AI SDK telemetry: input as `ai.prompt.messages` (JSON message
 * array) or `ai.prompt` (JSON `{ system, prompt, messages }`), output as
 * `ai.response.text` / `ai.response.object` / `ai.response.toolCalls`.
 */

function parsePromptMessages(value: unknown): ChatMessage[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(raw => {
    if (!isRecord(raw)) return [];
    const record = raw;
    // Tool results arrive as content parts with type "tool-result".
    const toolCalls = Array.isArray(record.content)
      ? normalizeToolCalls(
          record.content.filter(
            part => isRecord(part) && part.type === 'tool-call',
          ),
        )
      : [];
    const message = buildMessage({
      role: asString(record.role),
      content: flattenContentToText(record.content),
      toolCalls,
    });
    return message ? [message] : [];
  });
}

function parsePromptObject(value: unknown): ChatMessage[] {
  const parsed = parseMaybeJson(value);
  if (parsed == null) return [];
  if (typeof parsed === 'string') {
    return [{ role: 'user', content: parsed }];
  }
  if (!isRecord(parsed)) return [];
  const record = parsed;
  const messages: ChatMessage[] = [];
  const system = flattenContentToText(record.system);
  if (system != null) messages.push({ role: 'system', content: system });
  if (Array.isArray(record.messages)) {
    messages.push(...parsePromptMessages(record.messages));
  }
  const prompt = flattenContentToText(record.prompt);
  if (prompt != null) messages.push({ role: 'user', content: prompt });
  return messages;
}

export const vercelAiAdapter: MessageAdapter = {
  id: 'vercel-ai',
  detect: attributes =>
    attributes['ai.prompt.messages'] != null ||
    attributes['ai.prompt'] != null ||
    attributes['ai.response.text'] != null ||
    attributes['ai.response.object'] != null ||
    attributes['ai.response.toolCalls'] != null ||
    attributes['ai.toolCall.name'] != null,
  extract: attributes => {
    const input: ChatMessage[] = [];
    const output: ChatMessage[] = [];

    input.push(...parsePromptMessages(attributes['ai.prompt.messages']));
    if (input.length === 0) {
      input.push(...parsePromptObject(attributes['ai.prompt']));
    }

    const text = flattenContentToText(attributes['ai.response.text']);
    const object = flattenContentToText(attributes['ai.response.object']);
    const toolCalls = normalizeToolCalls(attributes['ai.response.toolCalls']);
    const responseMessage = buildMessage({
      role: 'assistant',
      content: text ?? object,
      toolCalls,
    });
    if (responseMessage) output.push(responseMessage);

    // Tool-execution spans (`ai.toolCall.*`).
    const toolName = asString(attributes['ai.toolCall.name']);
    if (toolName !== undefined) {
      if (input.length === 0) {
        const args = flattenContentToText(
          attributes['ai.toolCall.args'] ?? attributes['ai.toolCall.input'],
        );
        input.push({
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              name: toolName,
              id: asString(attributes['ai.toolCall.id']),
              arguments: args ?? undefined,
            },
          ],
        });
      }
      if (output.length === 0) {
        const result = flattenContentToText(
          attributes['ai.toolCall.result'] ?? attributes['ai.toolCall.output'],
        );
        if (result != null) {
          output.push({ role: 'tool', content: result, name: toolName });
        }
      }
    }

    if (input.length === 0 && output.length === 0) return undefined;
    return { input, output };
  },
};
