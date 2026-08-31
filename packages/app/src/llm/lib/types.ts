/**
 * Raw span attributes as read from the row. ClickHouse `Map(String, String)`
 * columns deliver every value as a string; JSON-typed columns deliver real
 * numbers/objects. All extraction helpers must tolerate both.
 */
export type SpanAttributeMap = Record<string, unknown>;

/**
 * A span event row as surfaced by the row-data query (`__hdx_span_events`) or
 * the waterfall query (`SpanEvents`). Only the fields we consume are typed.
 */
export interface LLMSpanEvent {
  name: string;
  attributes: SpanAttributeMap;
}

/** A tool/function call requested by the model. */
export interface ChatToolCall {
  id?: string;
  name: string;
  /** JSON string of arguments (kept as text for display). */
  arguments?: string;
}

/**
 * A normalized chat message (ChatML-style). `content` is display text; rich
 * parts (images, audio) are flattened into text placeholders for v1.
 */
export interface ChatMessage {
  role: string;
  content: string | null;
  toolCalls?: ChatToolCall[];
  /** For role=tool messages: the id of the call this message responds to. */
  toolCallId?: string;
  name?: string;
}

/** Which side of the exchange a message came from. */
export type ConversationMessage = ChatMessage & {
  source: 'input' | 'output';
  /**
   * Stable render key within the conversation (assigned by
   * extractConversation; conversations are immutable once extracted).
   */
  id: number;
};

/** Instrumentation dialects the normalizer understands. */
export type LLMDialect =
  | 'semconv-attributes'
  | 'semconv-events'
  | 'openllmetry'
  | 'openinference'
  | 'vercel-ai';

export interface LLMConversation {
  messages: ConversationMessage[];
  dialect: LLMDialect;
}

/** Normalized token usage. All counts are absolute token counts. */
export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Cache-read prompt tokens (may be a subset of, or extra to, inputTokens
   * depending on the emitter's convention — see computeCostUsd). */
  cachedInputTokens?: number;
  /** Cache-write/creation prompt tokens (billed at a premium by Anthropic). */
  cacheWriteInputTokens?: number;
  /** Reasoning/thinking tokens (subset of outputTokens). */
  reasoningOutputTokens?: number;
}

/** Normalized summary of an LLM span, extracted at read time. */
export interface LLMSpanInfo {
  /** Best-effort canonical model (response model preferred over request). */
  model?: string;
  requestModel?: string;
  responseModel?: string;
  /** Provider/system, e.g. "openai", "anthropic", "aws.bedrock". */
  provider?: string;
  /** Operation, e.g. "chat", "embeddings", "execute_tool", "invoke_agent". */
  operation?: string;
  /**
   * Conversation/session identifier (gen_ai.conversation.id, session.id, or
   * ai.telemetry.metadata.sessionId).
   */
  conversationId?: string;
  /** Time to first output token in milliseconds, when reported. */
  timeToFirstTokenMs?: number;
  usage: LLMUsage;
  /** Cost in USD reported by the instrumentation itself, when present. */
  providedCostUsd?: number;
  /** Request parameters (temperature, max_tokens, top_p, ...). */
  params: Record<string, string>;
  finishReasons?: string;
  /** Tool name for execute_tool spans. */
  toolName?: string;
  /** Agent name for agent-framework spans (gen_ai.agent.name). */
  agentName?: string;
}
