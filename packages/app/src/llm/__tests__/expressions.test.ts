import { TLogSource, TTraceSource } from '@hyperdx/common-utils/dist/types';

import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  getLLMExpressions,
  getLLMLogExpressions,
  llmGatedCountExpr,
  llmGatedSumExpr,
} from '@/llm/lib/expressions';

const TRACE_SOURCE = makeTraceSource();

describe('getLLMExpressions', () => {
  it('derives map-column expressions', () => {
    const expressions = getLLMExpressions(TRACE_SOURCE, []);

    expect(expressions.model).toContain(
      "nullif(SpanAttributes['gen_ai.response.model'], '')",
    );
    expect(expressions.model).toContain(
      "nullif(SpanAttributes['llm.model_name'], '')",
    );
    expect(expressions.inputTokens).toContain(
      "toFloat64OrZero(SpanAttributes['gen_ai.usage.input_tokens'])",
    );
    expect(expressions.inputTokens.startsWith('greatest(')).toBe(true);
    // Total = full context processed (effective input) + output.
    expect(expressions.totalTokens).toBe(
      `${expressions.effectiveInputTokens} + ${expressions.outputTokens}`,
    );
    expect(expressions.isLLMSpan).toContain(
      "SpanAttributes['gen_ai.operation.name'] != ''",
    );
    expect(expressions.isError).toBe("lower(StatusCode) = 'error'");
    expect(expressions.durationInMillis).toBe('Duration/1e6');
    // Provided cost takes precedence in the cost expression.
    expect(expressions.costUsd.startsWith('if((greatest(')).toBe(true);
    expect(expressions.costUsd).toContain('multiIf(');
  });

  it('derives JSON-column expressions with backtick paths', () => {
    const expressions = getLLMExpressions(TRACE_SOURCE, ['SpanAttributes']);

    expect(expressions.model).toContain(
      "nullif(toString(SpanAttributes.`gen_ai.response.model`), '')",
    );
    expect(expressions.inputTokens).toContain(
      'toFloat64OrZero(toString(SpanAttributes.`gen_ai.usage.input_tokens`))',
    );
    expect(expressions.isLLMSpan).toContain(
      "toString(SpanAttributes.`gen_ai.operation.name`) != ''",
    );
  });

  it('derives session id and reported-token gate expressions', () => {
    const expressions = getLLMExpressions(TRACE_SOURCE, []);

    expect(expressions.sessionId).toContain(
      "nullif(SpanAttributes['gen_ai.conversation.id'], '')",
    );
    expect(expressions.sessionId).toContain(
      "nullif(SpanAttributes['session.id'], '')",
    );
    expect(expressions.sessionId).toContain(
      "nullif(SpanAttributes['ai.telemetry.metadata.sessionId'], '')",
    );
    expect(expressions.hasSessionId).toContain("!= ''");

    // The gate keys on authoritative usage reporters only — wrapper spans
    // carrying just ai.usage.* must not satisfy it.
    expect(expressions.hasReportedTokens).toContain(
      "SpanAttributes['gen_ai.usage.input_tokens'] != ''",
    );
    expect(expressions.hasReportedTokens).toContain(
      "SpanAttributes['llm.token_count.total'] != ''",
    );
    expect(expressions.hasReportedTokens).not.toContain('ai.usage.inputTokens');
  });

  it('derives efficiency, attribution, and agent expressions', () => {
    const expressions = getLLMExpressions(TRACE_SOURCE, []);

    // Cached tokens across conventions, incl. the current-registry dotted
    // key (emitted by GitHub Copilot Chat).
    expect(expressions.cachedInputTokens).toContain(
      "SpanAttributes['gen_ai.usage.cache_read.input_tokens']",
    );
    expect(expressions.cachedInputTokens).toContain(
      "SpanAttributes['gen_ai.usage.cached_input_tokens']",
    );
    expect(expressions.cachedInputTokens).toContain(
      "SpanAttributes['cache_read_tokens']",
    );
    expect(expressions.reasoningTokens).toContain(
      "SpanAttributes['gen_ai.usage.reasoning.output_tokens']",
    );
    // Cache-write tokens across conventions (billed at a premium).
    expect(expressions.cacheWriteInputTokens).toContain(
      "SpanAttributes['llm.token_count.prompt_details.cache_write']",
    );
    expect(expressions.cacheWriteInputTokens).toContain(
      "SpanAttributes['ai.usage.inputTokenDetails.cacheWriteTokens']",
    );
    expect(expressions.cacheWriteInputTokens).toContain(
      "SpanAttributes['cache_creation_tokens']",
    );

    // Convention-aware denominator: exclusive-style rows add cache
    // reads/writes to input; inclusive-style rows subtract them.
    expect(expressions.effectiveInputTokens).toMatch(/^if\(/);
    expect(expressions.uncachedInputTokens).toMatch(/^greatest\(if\(/);
    expect(expressions.effectiveInputTokens).toContain(
      expressions.cacheWriteInputTokens,
    );

    // The cost estimate prices cache reads and writes separately.
    expect(expressions.costUsd).toContain(expressions.uncachedInputTokens);
    expect(expressions.costUsd).toContain(expressions.cacheWriteInputTokens);

    // TTFT across Claude Code, Vercel AI SDK, and Copilot Chat (all ms).
    expect(expressions.ttftMs).toContain("SpanAttributes['ttft_ms']");
    expect(expressions.ttftMs).toContain(
      "SpanAttributes['ai.response.msToFirstChunk']",
    );
    expect(expressions.ttftMs).toContain(
      "SpanAttributes['copilot_chat.time_to_first_token']",
    );
    expect(expressions.hasTtft).toContain('> 0');

    // Tool name coalesce includes the flat form.
    expect(expressions.toolName).toContain("SpanAttributes['tool_name']");

    // Agent attribution across semconv and CLI-agent forms.
    expect(expressions.agentName).toContain(
      "SpanAttributes['gen_ai.agent.name']",
    );
    expect(expressions.agentName).toContain("SpanAttributes['agent.name']");
    expect(expressions.hasAgentName).toContain("!= ''");

    // Finish reasons normalized out of their JSON-array encoding.
    expect(expressions.finishReason).toMatch(/^replaceRegexpAll\(/);
    expect(expressions.finishReason).toContain("SpanAttributes['stop_reason']");

    // User attribution coalesce.
    expect(expressions.userId).toContain("SpanAttributes['user.email']");
    expect(expressions.userId).toContain("SpanAttributes['enduser.id']");
    expect(expressions.hasUserId).toContain("!= ''");

    expect(expressions.statusMessage).toBe('StatusMessage');
  });

  it('respects source expression overrides', () => {
    const expressions = getLLMExpressions(
      {
        ...TRACE_SOURCE,
        eventAttributesExpression: 'Attrs',
        durationExpression: 'DurationNs',
        statusCodeExpression: 'Status',
      } as TTraceSource,
      [],
    );
    expect(expressions.model).toContain("Attrs['gen_ai.response.model']");
    expect(expressions.isError).toBe("lower(Status) = 'error'");
    expect(expressions.durationInMillis).toBe('DurationNs/1e6');
  });
});

describe('election-gated aggregates', () => {
  const expressions = getLLMExpressions(TRACE_SOURCE, []);

  it('exposes the provided-cost gate', () => {
    expect(expressions.hasProvidedCost).toMatch(/^\(greatest\(/);
    expect(expressions.hasProvidedCost).toContain(
      "SpanAttributes['llm.cost.total']",
    );
    expect(expressions.hasProvidedCost).toContain("SpanAttributes['cost_usd']");
    expect(expressions.hasProvidedCost).toMatch(/> 0\)$/);
  });

  it('sums provided-cost rows when present, else all usage reporters', () => {
    const sql = llmGatedSumExpr(expressions, 'x');
    expect(sql).toBe(
      `if(countIf(${expressions.hasProvidedCost}) > 0, sumIf(x, ${expressions.hasProvidedCost}), sumIf(x, ${expressions.hasReportedTokens}))`,
    );
  });

  it('counts calls with the same election', () => {
    const sql = llmGatedCountExpr(expressions);
    expect(sql).toBe(
      `if(countIf(${expressions.hasProvidedCost}) > 0, countIf(${expressions.hasProvidedCost}), countIf(${expressions.hasReportedTokens}))`,
    );
  });
});

const LOG_SOURCE = makeLogSource();

describe('getLLMLogExpressions', () => {
  it('derives expressions over the log attribute column', () => {
    const expressions = getLLMLogExpressions(LOG_SOURCE, []);

    expect(expressions.sessionId).toContain(
      "nullif(LogAttributes['session.id'], '')",
    );
    expect(expressions.isLLMSpan).toContain(
      "LogAttributes['gen_ai.provider.name'] != ''",
    );
    // LLM-related = LLM markers OR any session id, so tool_result /
    // lifecycle log events that only carry session.id are included.
    expect(expressions.isLLMRelated).toContain(expressions.isLLMSpan);
    expect(expressions.isLLMRelated).toContain(expressions.hasSessionId);
    expect(expressions.severityText).toBe('SeverityText');
  });

  it('falls back to LogAttributes when no expression is configured', () => {
    const expressions = getLLMLogExpressions(
      { ...LOG_SOURCE, eventAttributesExpression: undefined } as TLogSource,
      [],
    );
    expect(expressions.sessionId).toContain("LogAttributes['session.id']");
  });
});
