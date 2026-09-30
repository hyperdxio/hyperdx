import { MESSAGE_ADAPTERS } from './adapters';
import {
  ConversationMessage,
  LLMConversation,
  LLMSpanEvent,
  SpanAttributeMap,
} from './types';

/**
 * Normalize a span's LLM input/output into a single conversation, trying
 * each dialect adapter in precedence order. Returns undefined when no
 * adapter produced any messages.
 */
export function extractConversation(
  attributes: SpanAttributeMap | undefined | null,
  events?: LLMSpanEvent[],
): LLMConversation | undefined {
  const attrs = attributes ?? {};
  const eventList = events ?? [];

  for (const adapter of MESSAGE_ADAPTERS) {
    if (!adapter.detect(attrs, eventList)) continue;
    const extracted = adapter.extract(attrs, eventList);
    if (
      extracted == null ||
      (extracted.input.length === 0 && extracted.output.length === 0)
    ) {
      continue;
    }
    const messages: ConversationMessage[] = [
      ...extracted.input.map(message => ({
        ...message,
        source: 'input' as const,
      })),
      ...extracted.output.map(message => ({
        ...message,
        // Output messages default to the assistant role.
        role: message.role === 'unknown' ? 'assistant' : message.role,
        source: 'output' as const,
      })),
      // Conversations are immutable once extracted, so the position is a
      // stable render key.
    ].map((message, index) => ({ ...message, id: index }));
    return { messages, dialect: adapter.id };
  }
  return undefined;
}
