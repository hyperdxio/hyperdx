import {
  asString,
  firstNumber,
  firstString,
  parseMaybeJson,
} from './attributeUtils';
import { isLLMSpan } from './detect';
import { LLMSpanEvent, LLMSpanInfo, LLMUsage, SpanAttributeMap } from './types';

// Model-name precedence mirrors Langfuse's OTel ingestion mapping: the
// response model is the most truthful (resolved by the provider), then SDK
// specific ids, then the requested model.
const RESPONSE_MODEL_KEYS = ['gen_ai.response.model', 'llm.response.model'];
const REQUEST_MODEL_KEYS = ['gen_ai.request.model', 'ai.model.id', 'model'];
const MODEL_KEYS = [
  ...RESPONSE_MODEL_KEYS,
  'ai.model.id',
  'gen_ai.request.model',
  'llm.model_name',
  'model',
];

const PROVIDER_KEYS = [
  'gen_ai.provider.name', // current semconv
  'gen_ai.system', // pre-1.37 semconv, OpenLLMetry, OpenLIT
  'ai.model.provider', // Vercel AI SDK
  'llm.provider', // OpenInference
  'llm.system',
];

const OPERATION_KEYS = ['gen_ai.operation.name', 'ai.operationId'];

// Flat keys (input_tokens, cost_usd, ...) are non-standard shorthands seen on
// log events (e.g. opencode's api_request logs). They're safe as last-resort
// fallbacks because usage is only extracted after LLM detection passes.
const INPUT_TOKEN_KEYS = [
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.prompt_tokens', // pre-1.27 semconv / OpenLLMetry
  'llm.token_count.prompt', // OpenInference
  'ai.usage.inputTokens', // Vercel AI SDK >= 4
  'ai.usage.promptTokens', // Vercel AI SDK < 4
  'input_tokens',
];
const OUTPUT_TOKEN_KEYS = [
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.completion_tokens',
  'llm.token_count.completion',
  'ai.usage.outputTokens',
  'ai.usage.completionTokens',
  'output_tokens',
];
const TOTAL_TOKEN_KEYS = [
  'gen_ai.usage.total_tokens',
  'llm.token_count.total',
  'llm.usage.total_tokens',
  'ai.usage.totalTokens',
  'ai.usage.tokens',
];
const CACHED_INPUT_TOKEN_KEYS = [
  'gen_ai.usage.cache_read.input_tokens', // current semconv registry
  'gen_ai.usage.cached_input_tokens',
  'gen_ai.usage.input_cached_tokens',
  'gen_ai.usage.cache_read_input_tokens', // Anthropic-style
  'llm.token_count.prompt_details.cache_read',
  'ai.usage.cachedInputTokens',
  'ai.usage.inputTokenDetails.cacheReadTokens',
  'cache_read_tokens',
];
const CACHE_WRITE_TOKEN_KEYS = [
  'gen_ai.usage.cache_creation_input_tokens', // Anthropic-style
  'llm.token_count.prompt_details.cache_write', // OpenInference
  'ai.usage.inputTokenDetails.cacheWriteTokens', // Vercel AI SDK
  'cache_write_tokens',
  'cache_creation_tokens',
];
const REASONING_TOKEN_KEYS = [
  'gen_ai.usage.reasoning.output_tokens', // current semconv registry
  'gen_ai.usage.output_reasoning_tokens',
  'gen_ai.usage.reasoning_tokens',
  'llm.token_count.completion_details.reasoning',
  'ai.usage.reasoningTokens',
  'reasoning_tokens',
];

const PROVIDED_COST_KEYS = ['gen_ai.usage.cost', 'llm.cost.total', 'cost_usd'];

/**
 * Session/conversation grouping keys: GenAI semconv conversation id, the
 * general OTel session attribute, then the Vercel AI SDK metadata key.
 */
const SESSION_ID_KEYS = [
  'gen_ai.conversation.id',
  'session.id',
  'ai.telemetry.metadata.sessionId',
];

/**
 * Time-to-first-token in milliseconds (Vercel AI SDK, Claude Code, GitHub
 * Copilot Chat — verified ms in vscode-copilot-chat's chatMLFetcher).
 */
const TTFT_MS_KEYS = [
  'ai.response.msToFirstChunk',
  'ttft_ms',
  'copilot_chat.time_to_first_token',
];

/** `gen_ai.request.*` parameters worth surfacing, in display order. */
const REQUEST_PARAM_KEYS = [
  'temperature',
  'max_tokens',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
  'stop_sequences',
  'seed',
  'service_tier',
];

function extractUsage(attributes: SpanAttributeMap): LLMUsage {
  const usage: LLMUsage = {};
  const inputTokens = firstNumber(attributes, INPUT_TOKEN_KEYS);
  const outputTokens = firstNumber(attributes, OUTPUT_TOKEN_KEYS);
  const cachedInputTokens = firstNumber(attributes, CACHED_INPUT_TOKEN_KEYS);
  const cacheWriteTokens = firstNumber(attributes, CACHE_WRITE_TOKEN_KEYS);
  // Exclusive-style emitters (Anthropic flat keys, OpenInference) report
  // input tokens excluding cache reads/writes; fold them back in for the
  // derived total so it reflects the full context processed.
  const cacheTokens = (cachedInputTokens ?? 0) + (cacheWriteTokens ?? 0);
  const effectiveInputTokens =
    cacheTokens > (inputTokens ?? 0)
      ? (inputTokens ?? 0) + cacheTokens
      : inputTokens;
  const totalTokens =
    firstNumber(attributes, TOTAL_TOKEN_KEYS) ??
    (effectiveInputTokens != null || outputTokens != null
      ? (effectiveInputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  const reasoningOutputTokens = firstNumber(attributes, REASONING_TOKEN_KEYS);

  if (inputTokens != null) usage.inputTokens = inputTokens;
  if (outputTokens != null) usage.outputTokens = outputTokens;
  if (totalTokens != null) usage.totalTokens = totalTokens;
  if (cachedInputTokens != null) usage.cachedInputTokens = cachedInputTokens;
  if (cacheWriteTokens != null) usage.cacheWriteInputTokens = cacheWriteTokens;
  if (reasoningOutputTokens != null) {
    usage.reasoningOutputTokens = reasoningOutputTokens;
  }
  return usage;
}

function extractParams(attributes: SpanAttributeMap): Record<string, string> {
  const params: Record<string, string> = {};
  for (const param of REQUEST_PARAM_KEYS) {
    const value = asString(attributes[`gen_ai.request.${param}`]);
    if (value !== undefined) params[param] = value;
  }
  // OpenInference carries request params as one JSON blob.
  const invocationParams = parseMaybeJson(
    attributes['llm.invocation_parameters'],
  );
  if (invocationParams && typeof invocationParams === 'object') {
    for (const [key, value] of Object.entries(invocationParams)) {
      if (params[key] === undefined && key !== 'model') {
        const str = asString(value);
        if (str !== undefined) params[key] = str;
      }
    }
  }
  return params;
}

/**
 * Extract a normalized LLM summary from raw span attributes. Returns
 * undefined when the span carries no LLM instrumentation.
 */
export function extractLLMSpanInfo(
  attributes: SpanAttributeMap | undefined | null,
  events?: LLMSpanEvent[],
): LLMSpanInfo | undefined {
  if (!isLLMSpan(attributes, events)) return undefined;
  const attrs = attributes ?? {};

  const info: LLMSpanInfo = {
    usage: extractUsage(attrs),
    params: extractParams(attrs),
  };

  const model = firstString(attrs, MODEL_KEYS);
  if (model !== undefined) info.model = model;
  const responseModel = firstString(attrs, RESPONSE_MODEL_KEYS);
  if (responseModel !== undefined) info.responseModel = responseModel;
  const requestModel = firstString(attrs, REQUEST_MODEL_KEYS);
  if (requestModel !== undefined) info.requestModel = requestModel;

  const provider = firstString(attrs, PROVIDER_KEYS);
  if (provider !== undefined) info.provider = provider;

  const operation =
    firstString(attrs, OPERATION_KEYS) ??
    asString(attrs['openinference.span.kind'])?.toLowerCase();
  if (operation !== undefined) info.operation = operation;

  const conversationId = firstString(attrs, SESSION_ID_KEYS);
  if (conversationId !== undefined) info.conversationId = conversationId;

  const timeToFirstTokenMs = firstNumber(attrs, TTFT_MS_KEYS);
  if (timeToFirstTokenMs !== undefined) {
    info.timeToFirstTokenMs = timeToFirstTokenMs;
  }

  const providedCostUsd = firstNumber(attrs, PROVIDED_COST_KEYS);
  if (providedCostUsd !== undefined) info.providedCostUsd = providedCostUsd;

  const finishReasons = asString(attrs['gen_ai.response.finish_reasons']);
  if (finishReasons !== undefined) info.finishReasons = finishReasons;

  const toolName =
    asString(attrs['gen_ai.tool.name']) ?? asString(attrs['tool_name']);
  if (toolName !== undefined) info.toolName = toolName;

  const agentName =
    asString(attrs['gen_ai.agent.name']) ?? asString(attrs['agent.name']);
  if (agentName !== undefined) info.agentName = agentName;

  return info;
}

/**
 * True when the row is an authoritative usage reporter (mirrors the SQL
 * `hasReportedTokens` gate in expressions.ts): standard semconv/OpenInference
 * usage keys or the flat form used by primary reporters like Claude Code.
 * SDK wrapper spans (Vercel's `ai.usage.*`-only layers) return false, so
 * summing gated rows never double counts a call.
 */
export function hasReportedUsage(
  attributes: SpanAttributeMap | undefined | null,
): boolean {
  if (attributes == null) return false;
  return Object.keys(attributes).some(
    key =>
      key.startsWith('gen_ai.usage.') ||
      key.startsWith('llm.token_count.') ||
      key === 'input_tokens' ||
      key === 'output_tokens',
  );
}

/** Format a token count for badges, e.g. 12345 → "12.3k tok". */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tok`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k tok`;
  }
  return `${tokens} tok`;
}

/** Format a USD cost for display, using more precision for tiny values. */
export function formatCostUsd(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(6).replace(/0+$/, '')}`;
  return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}
