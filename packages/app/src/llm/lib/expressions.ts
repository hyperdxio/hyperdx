import { TLogSource, TTraceSource } from '@hyperdx/common-utils/dist/types';

import { generateCostSqlExpression } from './cost';
import { buildLLMSpanSqlPredicate } from './detect';

/**
 * SQL expression derivation for the LLM dashboard, mirroring
 * `serviceDashboard.ts#getExpressions`. All expressions read span attributes
 * at query time and coalesce across the supported instrumentation dialects,
 * handling both `Map(String, String)` and JSON-typed attribute columns.
 */

function fieldAccess(
  field: string,
  key: string,
  isJsonColumn: boolean,
): string {
  return isJsonColumn ? `toString(${field}.\`${key}\`)` : `${field}['${key}']`;
}

/** First non-empty string among the given attribute keys ('' when none). */
function coalesceString(
  field: string,
  keys: string[],
  isJsonColumn: boolean,
): string {
  const args = keys.map(
    key => `nullif(${fieldAccess(field, key, isJsonColumn)}, '')`,
  );
  return `coalesce(${args.join(', ')}, '')`;
}

/**
 * Numeric attribute across dialect key variants. `greatest` (not `+`) so a
 * span that carries the same count under several conventions (e.g. Vercel AI
 * emitting both `gen_ai.usage.*` and `ai.usage.*`) isn't double-counted.
 */
function greatestNumber(
  field: string,
  keys: string[],
  isJsonColumn: boolean,
): string {
  const args = keys.map(
    key => `toFloat64OrZero(${fieldAccess(field, key, isJsonColumn)})`,
  );
  return args.length === 1 ? args[0] : `greatest(${args.join(', ')})`;
}

const MODEL_KEYS = [
  'gen_ai.response.model',
  'gen_ai.request.model',
  'llm.model_name',
  'ai.model.id',
];

const PROVIDER_KEYS = [
  'gen_ai.provider.name',
  'gen_ai.system',
  'ai.model.provider',
  'llm.provider',
];

const OPERATION_KEYS = ['gen_ai.operation.name', 'ai.operationId'];

const INPUT_TOKEN_KEYS = [
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.prompt_tokens',
  'llm.token_count.prompt',
  'ai.usage.inputTokens',
  'ai.usage.promptTokens',
  'input_tokens', // flat form (Claude Code spans, opencode logs)
];

const OUTPUT_TOKEN_KEYS = [
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.completion_tokens',
  'llm.token_count.completion',
  'ai.usage.outputTokens',
  'ai.usage.completionTokens',
  'output_tokens',
];

const PROVIDED_COST_KEYS = ['gen_ai.usage.cost', 'llm.cost.total', 'cost_usd'];

const CACHED_INPUT_TOKEN_KEYS = [
  'gen_ai.usage.cached_input_tokens',
  'gen_ai.usage.input_cached_tokens',
  'gen_ai.usage.cache_read_input_tokens',
  'llm.token_count.prompt_details.cache_read',
  'ai.usage.cachedInputTokens',
  'ai.usage.inputTokenDetails.cacheReadTokens',
  'cache_read_tokens',
];

/** Prompt-cache write/creation tokens (billed at a premium by Anthropic). */
const CACHE_WRITE_TOKEN_KEYS = [
  'gen_ai.usage.cache_creation_input_tokens',
  'llm.token_count.prompt_details.cache_write',
  'ai.usage.inputTokenDetails.cacheWriteTokens',
  'cache_write_tokens',
  'cache_creation_tokens',
];

const REASONING_TOKEN_KEYS = [
  'gen_ai.usage.output_reasoning_tokens',
  'gen_ai.usage.reasoning_tokens',
  'llm.token_count.completion_details.reasoning',
  'ai.usage.reasoningTokens',
  'reasoning_tokens',
];

/** Time-to-first-token in ms (Claude Code flat key, Vercel AI SDK). */
const TTFT_MS_KEYS = ['ttft_ms', 'ai.response.msToFirstChunk'];

const TOOL_NAME_KEYS = ['gen_ai.tool.name', 'ai.toolCall.name', 'tool_name'];

const FINISH_REASON_KEYS = [
  'gen_ai.response.finish_reasons',
  'stop_reason',
  'llm.finish_reason',
  'ai.response.finishReason',
];

/** End-user attribution across instrumentations. */
const USER_ID_KEYS = [
  'user.email',
  'enduser.id',
  'user.id',
  'ai.telemetry.metadata.userId',
];

const SESSION_ID_KEYS = [
  'gen_ai.conversation.id',
  'session.id',
  'ai.telemetry.metadata.sessionId',
];

/**
 * Keys that identify a span as the authoritative usage reporter for a call.
 * SDK wrapper spans (e.g. Vercel's `ai.streamText` around
 * `ai.streamText.doStream`) duplicate usage under `ai.usage.*` only; gating
 * token/cost aggregations on these keys keeps each call counted once.
 */
const REPORTED_TOKEN_KEYS = [
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.prompt_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.completion_tokens',
  'llm.token_count.prompt',
  'llm.token_count.completion',
  'llm.token_count.total',
  // Flat form: primary reporters like Claude Code's llm_request spans.
  // SDK wrapper spans never use the flat form, so this stays double-count safe.
  'input_tokens',
  'output_tokens',
];

/**
 * Attribute-derived expressions shared by trace spans and log events: both
 * carry LLM instrumentation in an attribute map column (SpanAttributes /
 * LogAttributes), just under a different field.
 */
function getLLMAttributeExpressions({
  attributeField,
  isJsonColumn,
}: {
  attributeField: string;
  isJsonColumn: boolean;
}) {
  const model = coalesceString(attributeField, MODEL_KEYS, isJsonColumn);
  const inputTokens = greatestNumber(
    attributeField,
    INPUT_TOKEN_KEYS,
    isJsonColumn,
  );
  const outputTokens = greatestNumber(
    attributeField,
    OUTPUT_TOKEN_KEYS,
    isJsonColumn,
  );
  const providedCost = greatestNumber(
    attributeField,
    PROVIDED_COST_KEYS,
    isJsonColumn,
  );
  const cachedInput = greatestNumber(
    attributeField,
    CACHED_INPUT_TOKEN_KEYS,
    isJsonColumn,
  );
  const cacheWriteInput = greatestNumber(
    attributeField,
    CACHE_WRITE_TOKEN_KEYS,
    isJsonColumn,
  );
  /**
   * Total prompt context per convention: OpenAI/Vercel-style report cache
   * reads/writes as subsets of input_tokens; Anthropic/OpenInference-style
   * report input_tokens excluding both. Heuristic: when reads + writes
   * exceed input the row must be exclusive-style, so add them.
   */
  const effectiveInputTokens = `if(${cachedInput} + ${cacheWriteInput} > ${inputTokens}, ${inputTokens} + ${cachedInput} + ${cacheWriteInput}, ${inputTokens})`;
  const uncachedInputTokens = `greatest(if(${cachedInput} + ${cacheWriteInput} > ${inputTokens}, ${inputTokens}, ${inputTokens} - ${cachedInput} - ${cacheWriteInput}), 0)`;

  return {
    model,
    provider: coalesceString(attributeField, PROVIDER_KEYS, isJsonColumn),
    operation: coalesceString(attributeField, OPERATION_KEYS, isJsonColumn),
    conversationId: fieldAccess(
      attributeField,
      'gen_ai.conversation.id',
      isJsonColumn,
    ),
    /** Session/conversation grouping id across dialects ('' when absent). */
    sessionId: coalesceString(attributeField, SESSION_ID_KEYS, isJsonColumn),
    inputTokens,
    outputTokens,
    /** Full context processed + output (see effectiveInputTokens). */
    totalTokens: `${effectiveInputTokens} + ${outputTokens}`,
    cachedInputTokens: cachedInput,
    cacheWriteInputTokens: cacheWriteInput,
    effectiveInputTokens,
    uncachedInputTokens,
    reasoningTokens: greatestNumber(
      attributeField,
      REASONING_TOKEN_KEYS,
      isJsonColumn,
    ),
    ttftMs: greatestNumber(attributeField, TTFT_MS_KEYS, isJsonColumn),
    toolName: coalesceString(attributeField, TOOL_NAME_KEYS, isJsonColumn),
    // Emitters disagree on encoding ('stop' vs '["stop"]'); strip the JSON
    // array wrapper so the group-by buckets align.
    finishReason: `replaceRegexpAll(${coalesceString(
      attributeField,
      FINISH_REASON_KEYS,
      isJsonColumn,
    )}, '[\\[\\]"]', '')`,
    userId: coalesceString(attributeField, USER_ID_KEYS, isJsonColumn),
    /** Estimated USD cost per row (provided cost wins over the catalog). */
    costUsd: generateCostSqlExpression({
      modelExpr: model,
      uncachedInputTokensExpr: uncachedInputTokens,
      cachedInputTokensExpr: cachedInput,
      cacheWriteInputTokensExpr: cacheWriteInput,
      outputTokensExpr: outputTokens,
      providedCostExpr: providedCost,
    }),
    isLLMSpan: buildLLMSpanSqlPredicate({ attributeField, isJsonColumn }),
    /**
     * Rows carrying a cost stamped by the instrumentation itself. These are
     * an app's own authoritative per-call reporters — see llmGatedSumExpr.
     */
    hasProvidedCost: `(${providedCost} > 0)`,
    /** See REPORTED_TOKEN_KEYS: gates sums so wrapper spans don't double count. */
    hasReportedTokens: `(${REPORTED_TOKEN_KEYS.map(key =>
      isJsonColumn
        ? `toString(${attributeField}.\`${key}\`) != ''`
        : `${attributeField}['${key}'] != ''`,
    ).join(' OR ')})`,
    hasSessionId: `${coalesceString(attributeField, SESSION_ID_KEYS, isJsonColumn)} != ''`,
    hasTtft: `${greatestNumber(attributeField, TTFT_MS_KEYS, isJsonColumn)} > 0`,
    hasUserId: `${coalesceString(attributeField, USER_ID_KEYS, isJsonColumn)} != ''`,
    hasFinishReason: `${coalesceString(attributeField, FINISH_REASON_KEYS, isJsonColumn)} != ''`,
    isToolSpan: `(${[
      `${fieldAccess(attributeField, 'openinference.span.kind', isJsonColumn)} = 'TOOL'`,
      `${fieldAccess(attributeField, 'gen_ai.tool.name', isJsonColumn)} != ''`,
      `${fieldAccess(attributeField, 'gen_ai.tool.call.id', isJsonColumn)} != ''`,
      `${fieldAccess(attributeField, 'ai.toolCall.name', isJsonColumn)} != ''`,
    ].join(' OR ')})`,
  };
}

export function getLLMExpressions(source: TTraceSource, jsonColumns: string[]) {
  const attributeField = source.eventAttributesExpression || 'SpanAttributes';
  const isJsonColumn = jsonColumns.includes(attributeField);

  const duration = source.durationExpression || 'Duration';
  const durationPrecision = source.durationPrecision ?? 9;

  const attributeExpressions = getLLMAttributeExpressions({
    attributeField,
    isJsonColumn,
  });

  const fieldExpressions = {
    duration,
    durationPrecision,
    traceId: source.traceIdExpression || 'TraceId',
    service: source.serviceNameExpression || 'ServiceName',
    spanName: source.spanNameExpression || 'SpanName',
    severityText: source.statusCodeExpression || 'StatusCode',
    statusMessage: source.statusMessageExpression || 'StatusMessage',
  };

  const auxExpressions = {
    /** Span duration in ms (see serviceDashboard.ts for the MV rationale). */
    durationInMillis: `${duration}/1e${durationPrecision - 3}`,
    durationDivisorForMillis: `1e${durationPrecision - 3}`,
  };

  return {
    ...attributeExpressions,
    ...fieldExpressions,
    ...auxExpressions,
    isError: `lower(${fieldExpressions.severityText}) = 'error'`,
    hasTokens: `${attributeExpressions.totalTokens} > 0`,
  };
}

export type LLMExpressions = ReturnType<typeof getLLMExpressions>;

/**
 * Expressions for LLM-related log events (e.g. opencode's `api_request`
 * logs). Session/detection expressions read the log source's attribute map.
 */
export function getLLMLogExpressions(
  source: TLogSource,
  jsonColumns: string[],
) {
  const attributeField = source.eventAttributesExpression || 'LogAttributes';
  const isJsonColumn = jsonColumns.includes(attributeField);

  const attributeExpressions = getLLMAttributeExpressions({
    attributeField,
    isJsonColumn,
  });

  return {
    ...attributeExpressions,
    service: source.serviceNameExpression || 'ServiceName',
    severityText: source.severityTextExpression || 'SeverityText',
    /**
     * Log events that belong to LLM activity: explicit LLM markers or any
     * session id (covers tool_result / lifecycle events that carry a
     * session.id without gen_ai attributes).
     */
    isLLMRelated: `(${attributeExpressions.isLLMSpan} OR ${attributeExpressions.hasSessionId})`,
  };
}

export type LLMLogExpressions = ReturnType<typeof getLLMLogExpressions>;

/**
 * Query-level alias for the per-row cost expression. The full `costUsd`
 * expression embeds the model price catalog (~70 KiB of SQL); referencing it
 * more than once per query risks ClickHouse's 256 KiB max_query_size, so
 * `baseLLMChartConfig` binds it once as a WITH expression alias and charts
 * reference this name instead.
 */
export const LLM_COST_SQL_ALIAS = '__llm_cost_usd';

type GateExpressions = Pick<
  LLMExpressions,
  'hasProvidedCost' | 'hasReportedTokens'
>;

/**
 * Election-gated sum for token/cost aggregations, used as a raw select
 * expression (no aggFn). When the aggregation scope (group/time bucket)
 * contains spans with an instrumentation-provided cost, those are the app's
 * own authoritative per-call reporters and every other dialect's usage rows
 * describe the same calls again — e.g. opencode emits an OpenInference span
 * (with `cost_usd`) *and* Vercel AI SDK spans (with `gen_ai.usage.*`) for
 * each call, in separate traces, so no row-local gate can dedupe them.
 * Summing only the provided-cost rows counts each call once; scopes without
 * provided costs fall back to all usage-reporting rows.
 *
 * Note: rendered as raw SQL, so sample-weight correction does not apply.
 */
export function llmGatedSumExpr(
  expressions: GateExpressions,
  valueExpression: string,
): string {
  return `if(countIf(${expressions.hasProvidedCost}) > 0, sumIf(${valueExpression}, ${expressions.hasProvidedCost}), sumIf(${valueExpression}, ${expressions.hasReportedTokens}))`;
}

/** Election-gated call count (see llmGatedSumExpr). */
export function llmGatedCountExpr(expressions: GateExpressions): string {
  return `if(countIf(${expressions.hasProvidedCost}) > 0, countIf(${expressions.hasProvidedCost}), countIf(${expressions.hasReportedTokens}))`;
}
