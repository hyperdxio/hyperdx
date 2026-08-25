import { asString, isRecord, parseMaybeJson } from '@/llm/lib/attributeUtils';
import {
  ChatMessage,
  ChatToolCall,
  LLMDialect,
  LLMSpanEvent,
  SpanAttributeMap,
} from '@/llm/lib/types';

export interface ExtractedMessages {
  input: ChatMessage[];
  output: ChatMessage[];
}

/**
 * A message-normalization adapter for one instrumentation dialect. `extract`
 * may return undefined (or empty arrays) when the span matches the dialect
 * but carries no renderable messages; the registry then tries the next one.
 */
export interface MessageAdapter {
  id: LLMDialect;
  detect(attributes: SpanAttributeMap, events: LLMSpanEvent[]): boolean;
  extract(
    attributes: SpanAttributeMap,
    events: LLMSpanEvent[],
  ): ExtractedMessages | undefined;
}

/**
 * Flatten message content into display text. Handles plain strings, part
 * arrays from multiple dialects ({type:'text', text|content}, {text}), and
 * arbitrary objects (JSON-stringified as a fallback).
 */
export function flattenContentToText(value: unknown): string | null {
  const parsed = parseMaybeJson(value);
  if (parsed == null) return null;
  if (typeof parsed === 'string') return parsed;
  if (typeof parsed === 'number' || typeof parsed === 'boolean') {
    return String(parsed);
  }
  if (Array.isArray(parsed)) {
    const texts = parsed
      .map(part => {
        if (typeof part === 'string') return part;
        if (!isRecord(part)) return undefined;
        const record = part;
        const type = asString(record.type);
        if (type != null && type !== 'text' && type !== 'output_text') {
          // Non-text part (image, audio, tool call handled elsewhere).
          return record.text != null || record.content != null
            ? asString(record.text ?? record.content)
            : `[${type}]`;
        }
        return asString(record.text ?? record.content);
      })
      .filter((text): text is string => text != null && text !== '');
    if (texts.length > 0) return texts.join('\n');
    return parsed.length === 0 ? null : JSON.stringify(parsed);
  }
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Stringify tool-call arguments for display, tolerating objects/strings. */
export function stringifyArguments(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Normalize tool calls from common shapes:
 * - OpenAI/ChatML: `{ id, function: { name, arguments }, type }`
 * - Flat: `{ id, name, arguments }`
 * - Vercel AI SDK: `{ toolCallId, toolName, args }`
 */
export function normalizeToolCalls(value: unknown): ChatToolCall[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(raw => {
    if (!isRecord(raw)) return [];
    const record = raw;
    const fn = isRecord(record.function) ? record.function : undefined;
    const name = asString(fn?.name ?? record.name ?? record.toolName);
    if (name === undefined) return [];
    const toolCall: ChatToolCall = { name };
    const id = asString(record.id ?? record.toolCallId);
    if (id !== undefined) toolCall.id = id;
    const args = stringifyArguments(
      fn?.arguments ?? record.arguments ?? record.args ?? record.input,
    );
    if (args !== undefined) toolCall.arguments = args;
    return [toolCall];
  });
}

/** Build a ChatMessage, dropping empty messages entirely. */
export function buildMessage({
  role,
  content,
  toolCalls,
  toolCallId,
  name,
}: {
  role: string | undefined;
  content: string | null;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  name?: string;
}): ChatMessage | undefined {
  const hasToolCalls = toolCalls != null && toolCalls.length > 0;
  if ((content == null || content === '') && !hasToolCalls) return undefined;
  const message: ChatMessage = {
    role: role || 'unknown',
    content: content === '' ? null : content,
  };
  if (hasToolCalls) message.toolCalls = toolCalls;
  if (toolCallId !== undefined) message.toolCallId = toolCallId;
  if (name !== undefined) message.name = name;
  return message;
}
