import { TLogSource, TTraceSource } from '@hyperdx/common-utils/dist/types';

import { makeLogSource, makeTraceSource } from '@/llm/__fixtures__/sources';
import {
  getLLMExpressions,
  getLLMLogExpressions,
  isLLMAttributeKey,
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
      "mapContains(SpanAttributes, 'gen_ai.operation.name')",
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
    // mapContains does not apply to JSON paths.
    expect(expressions.isLLMSpan).not.toContain('mapContains');
    expect(expressions.isToolSpan).not.toContain('mapContains');

    // On JSON there is no key index to prune with, so the gates carry the
    // value test alone rather than doubling their subcolumn reads with a
    // presence term that says the same thing.
    expect(expressions.isToolSpan).not.toContain('indexHint');
    expect(expressions.hasTtft).toBe(
      'greatest(toFloat64OrZero(toString(SpanAttributes.`ttft_ms`)), ' +
        'toFloat64OrZero(toString(SpanAttributes.`ai.response.msToFirstChunk`)), ' +
        'toFloat64OrZero(toString(SpanAttributes.`copilot_chat.time_to_first_token`))) > 0',
    );
    expect(expressions.hasSessionId).toBe(
      "coalesce(nullif(toString(SpanAttributes.`gen_ai.conversation.id`), ''), " +
        "nullif(toString(SpanAttributes.`session.id`), ''), " +
        "nullif(toString(SpanAttributes.`ai.telemetry.metadata.sessionId`), ''), '') != ''",
    );
    // Unhinted on both branches, so pin the JSON form itself — a
    // not.toContain('indexHint') here would hold either way and prove nothing.
    expect(expressions.hasReportedTokens).toBe(
      "coalesce(nullif(toString(SpanAttributes.`gen_ai.usage.input_tokens`), ''), " +
        "nullif(toString(SpanAttributes.`gen_ai.usage.prompt_tokens`), ''), " +
        "nullif(toString(SpanAttributes.`gen_ai.usage.output_tokens`), ''), " +
        "nullif(toString(SpanAttributes.`gen_ai.usage.completion_tokens`), ''), " +
        "nullif(toString(SpanAttributes.`llm.token_count.prompt`), ''), " +
        "nullif(toString(SpanAttributes.`llm.token_count.completion`), ''), " +
        "nullif(toString(SpanAttributes.`llm.token_count.total`), ''), " +
        "nullif(toString(SpanAttributes.`input_tokens`), ''), " +
        "nullif(toString(SpanAttributes.`output_tokens`), ''), '') != ''",
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
    // Presence terms for the index, value term for the meaning: a key set to
    // '' must not pass, or SessionsTab groups it as a blank row whose link
    // carries no session id.
    expect(expressions.hasSessionId).toBe(
      "(indexHint((mapContains(SpanAttributes, 'gen_ai.conversation.id') OR " +
        "mapContains(SpanAttributes, 'session.id') OR " +
        "mapContains(SpanAttributes, 'ai.telemetry.metadata.sessionId'))) AND " +
        "coalesce(nullif(SpanAttributes['gen_ai.conversation.id'], ''), " +
        "nullif(SpanAttributes['session.id'], ''), " +
        "nullif(SpanAttributes['ai.telemetry.metadata.sessionId'], ''), '') != '')",
    );

    // The gate keys on authoritative usage reporters only — wrapper spans
    // carrying just ai.usage.* must not satisfy it.
    expect(expressions.hasReportedTokens).toContain(
      "nullif(SpanAttributes['gen_ai.usage.input_tokens'], '')",
    );
    expect(expressions.hasReportedTokens).toContain(
      "nullif(SpanAttributes['llm.token_count.total'], '')",
    );
    expect(expressions.hasReportedTokens).not.toContain('ai.usage.inputTokens');
    // This gate decides which rows enter every token and cost aggregate, so
    // pin the value test: reverting it to presence-only would let a key set
    // to '' inflate the call count.
    expect(expressions.hasReportedTokens).toMatch(/^coalesce\(nullif\(/);
    expect(expressions.hasReportedTokens).toContain("!= ''");
    // Only ever embedded in select-list aggregates, where a hint cannot prune
    // and would double the length of an already-long expression.
    expect(expressions.hasReportedTokens).not.toContain('indexHint');
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
    // Pinned exactly: the terms must be ANDed. With OR, zero-TTFT rows reach
    // the p50/p95 the value check exists to keep them out of, and a
    // toContain-style assertion would not notice.
    expect(expressions.hasTtft).toBe(
      "(indexHint((mapContains(SpanAttributes, 'ttft_ms') OR " +
        "mapContains(SpanAttributes, 'ai.response.msToFirstChunk') OR " +
        "mapContains(SpanAttributes, 'copilot_chat.time_to_first_token'))) AND " +
        "greatest(toFloat64OrZero(SpanAttributes['ttft_ms']), " +
        "toFloat64OrZero(SpanAttributes['ai.response.msToFirstChunk']), " +
        "toFloat64OrZero(SpanAttributes['copilot_chat.time_to_first_token'])) > 0)",
    );

    // Tool name coalesce includes the flat form.
    expect(expressions.toolName).toContain("SpanAttributes['tool_name']");

    // Agent attribution across semconv and CLI-agent forms.
    expect(expressions.agentName).toContain(
      "SpanAttributes['gen_ai.agent.name']",
    );
    expect(expressions.agentName).toContain("SpanAttributes['agent.name']");
    expect(expressions.hasAgentName).toBe(
      "(indexHint((mapContains(SpanAttributes, 'gen_ai.agent.name') OR " +
        "mapContains(SpanAttributes, 'agent.name'))) AND " +
        "coalesce(nullif(SpanAttributes['gen_ai.agent.name'], ''), " +
        "nullif(SpanAttributes['agent.name'], ''), '') != '')",
    );

    // Finish reasons normalized out of their JSON-array encoding.
    expect(expressions.finishReason).toMatch(/^replaceRegexpAll\(/);
    expect(expressions.finishReason).toContain("SpanAttributes['stop_reason']");

    // Drives the finish-reason breakdown, so it needs the value term to keep
    // a blank slice out of the chart.
    expect(expressions.hasFinishReason).toBe(
      "(indexHint((mapContains(SpanAttributes, 'gen_ai.response.finish_reasons') OR " +
        "mapContains(SpanAttributes, 'stop_reason') OR " +
        "mapContains(SpanAttributes, 'llm.finish_reason') OR " +
        "mapContains(SpanAttributes, 'ai.response.finishReason'))) AND " +
        "coalesce(nullif(SpanAttributes['gen_ai.response.finish_reasons'], ''), " +
        "nullif(SpanAttributes['stop_reason'], ''), " +
        "nullif(SpanAttributes['llm.finish_reason'], ''), " +
        "nullif(SpanAttributes['ai.response.finishReason'], ''), '') != '')",
    );

    // User attribution coalesce.
    expect(expressions.userId).toContain("SpanAttributes['user.email']");
    expect(expressions.userId).toContain("SpanAttributes['enduser.id']");
    expect(expressions.hasUserId).toContain(
      "mapContains(SpanAttributes, 'user.email')",
    );
    // The value term keeps a blank user out of the Top Users group-by.
    expect(expressions.hasUserId).toContain(
      "AND coalesce(nullif(SpanAttributes['user.email'], '')",
    );

    // The span-kind term must stay an equality: widening it to a presence
    // check would pull every OpenInference span into the tool charts.
    // The hint covers the span-kind key and sits above the OR: a skip index
    // cannot prune an OR whose other arm it can't decide, so nesting it inside
    // would silently stop pruning the tool charts.
    expect(expressions.isToolSpan).toBe(
      "(indexHint((mapContains(SpanAttributes, 'openinference.span.kind') OR " +
        "mapContains(SpanAttributes, 'gen_ai.tool.name') OR " +
        "mapContains(SpanAttributes, 'ai.toolCall.name') OR " +
        "mapContains(SpanAttributes, 'tool_name') OR " +
        "mapContains(SpanAttributes, 'gen_ai.tool.call.id'))) AND " +
        "(SpanAttributes['openinference.span.kind'] = 'TOOL' OR " +
        "coalesce(nullif(SpanAttributes['gen_ai.tool.name'], ''), " +
        "nullif(SpanAttributes['ai.toolCall.name'], ''), " +
        "nullif(SpanAttributes['tool_name'], ''), " +
        "nullif(SpanAttributes['gen_ai.tool.call.id'], ''), '') != ''))",
    );
    // Every key the tool-name expression can resolve must also satisfy the
    // gate, or the span is dropped from the tool charts under a name the
    // dashboard could have shown.
    for (const key of ['gen_ai.tool.name', 'ai.toolCall.name', 'tool_name']) {
      expect(expressions.toolName).toContain(`SpanAttributes['${key}']`);
      expect(expressions.isToolSpan).toContain(`SpanAttributes['${key}']`);
    }
    // SessionsTab uses this one as an aggCondition, where a hint folds to a
    // constant. It must stay the bare match, and must still be the same
    // predicate the hinted form wraps.
    expect(expressions.isToolSpanUnhinted).not.toContain('indexHint');
    expect(expressions.isToolSpan).toContain(expressions.isToolSpanUnhinted);

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

  it('elects per service: provided-cost rows when the service has any, else all usage reporters', () => {
    // A scope-wide election would drop token-only apps whenever any other
    // app in the same scope reports provided costs (regression).
    const sql = llmGatedSumExpr(expressions, 'x');
    const providedCountMap = `sumMap(map(${expressions.service}, toUInt64(${expressions.hasProvidedCost})))`;
    const tokenCountMap = `sumMap(map(${expressions.service}, toUInt64(${expressions.hasReportedTokens})))`;
    const providedSumMap = `sumMap(map(${expressions.service}, if(${expressions.hasProvidedCost}, toFloat64(x), 0.)))`;
    const tokenSumMap = `sumMap(map(${expressions.service}, if(${expressions.hasReportedTokens}, toFloat64(x), 0.)))`;
    expect(sql).toBe(
      `arraySum(arrayMap(k -> if(${providedCountMap}[k] > 0, ${providedSumMap}[k], ${tokenSumMap}[k]), arrayDistinct(arrayConcat(mapKeys(${providedCountMap}), mapKeys(${tokenCountMap})))))`,
    );
  });

  it('counts calls with the same per-service election', () => {
    const sql = llmGatedCountExpr(expressions);
    expect(sql).toBe(llmGatedSumExpr(expressions, '1'));
    expect(sql).toContain('toFloat64(1)');
  });
});

describe('isLLMAttributeKey', () => {
  it('matches AI namespaces under any attribute column', () => {
    expect(isLLMAttributeKey('SpanAttributes.gen_ai.request.model')).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.gen_ai.usage.input_tokens')).toBe(
      true,
    );
    expect(isLLMAttributeKey('SpanAttributes.llm.token_count.prompt')).toBe(
      true,
    );
    expect(isLLMAttributeKey('SpanAttributes.ai.usage.inputTokens')).toBe(true);
    expect(
      isLLMAttributeKey('SpanAttributes.copilot_chat.time_to_first_token'),
    ).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.openinference.span.kind')).toBe(
      true,
    );
  });

  it('matches flat dialect keys nested under the attribute column', () => {
    expect(isLLMAttributeKey('SpanAttributes.input_tokens')).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.cost_usd')).toBe(true);
    // Bare `model` counts only directly under the attribute column.
    expect(isLLMAttributeKey('SpanAttributes.model')).toBe(true);
    expect(isLLMAttributeKey('ResourceAttributes.device.model')).toBe(false);
    expect(isLLMAttributeKey('SpanAttributes.ttft_ms')).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.tool_name')).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.agent.name')).toBe(true);
    expect(isLLMAttributeKey('SpanAttributes.session.id')).toBe(true);
  });

  it('rejects non-AI attributes and top-level columns', () => {
    expect(isLLMAttributeKey('ServiceName')).toBe(false);
    expect(isLLMAttributeKey('Duration')).toBe(false);
    expect(isLLMAttributeKey('ResourceAttributes.service.name')).toBe(false);
    expect(isLLMAttributeKey('ResourceAttributes.host.name')).toBe(false);
    expect(isLLMAttributeKey('SpanAttributes.http.method')).toBe(false);
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
      "mapContains(LogAttributes, 'gen_ai.provider.name')",
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
