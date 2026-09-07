import {
  NON_LLM_FIXTURE,
  OPENINFERENCE_FIXTURE,
  OPENLLMETRY_FIXTURE,
  SEMCONV_ATTRIBUTES_FIXTURE,
  SEMCONV_EVENTS_ATTRIBUTES_FIXTURE,
  SEMCONV_EVENTS_FIXTURE,
  VERCEL_AI_FIXTURE,
} from '@/llm/__fixtures__/spans';
import { buildLLMSpanSqlPredicate, isLLMSpan } from '@/llm/lib/detect';

describe('isLLMSpan', () => {
  it('detects each supported dialect', () => {
    expect(isLLMSpan(SEMCONV_ATTRIBUTES_FIXTURE)).toBe(true);
    expect(isLLMSpan(OPENLLMETRY_FIXTURE)).toBe(true);
    expect(isLLMSpan(OPENINFERENCE_FIXTURE)).toBe(true);
    expect(isLLMSpan(VERCEL_AI_FIXTURE)).toBe(true);
    expect(isLLMSpan(SEMCONV_EVENTS_ATTRIBUTES_FIXTURE)).toBe(true);
  });

  it('detects spans that only carry gen_ai span events', () => {
    expect(isLLMSpan({}, SEMCONV_EVENTS_FIXTURE)).toBe(true);
    expect(isLLMSpan(undefined, SEMCONV_EVENTS_FIXTURE)).toBe(true);
  });

  it('does not detect ordinary spans', () => {
    expect(isLLMSpan(NON_LLM_FIXTURE)).toBe(false);
    expect(isLLMSpan({})).toBe(false);
    expect(isLLMSpan(undefined)).toBe(false);
    expect(isLLMSpan(null, [])).toBe(false);
  });

  it('does not detect non-LLM openinference span kinds', () => {
    expect(isLLMSpan({ 'openinference.span.kind': 'UNKNOWN' })).toBe(false);
    expect(isLLMSpan({ 'openinference.span.kind': 'LLM' })).toBe(true);
    expect(isLLMSpan({ 'openinference.span.kind': 'AGENT' })).toBe(true);
  });

  it('detects Vercel AI SDK spans without gen_ai attributes', () => {
    expect(
      isLLMSpan({ 'ai.operationId': 'ai.generateText', 'ai.model.id': 'x' }),
    ).toBe(true);
  });
});

describe('buildLLMSpanSqlPredicate', () => {
  it('builds a map-column predicate', () => {
    const predicate = buildLLMSpanSqlPredicate({
      attributeField: 'SpanAttributes',
      isJsonColumn: false,
    });
    expect(predicate).toContain(
      "SpanAttributes['gen_ai.operation.name'] != ''",
    );
    expect(predicate).toContain("SpanAttributes['llm.model_name'] != ''");
    expect(predicate.startsWith('(')).toBe(true);
    expect(predicate.endsWith(')')).toBe(true);
  });

  it('builds a JSON-column predicate with backtick paths', () => {
    const predicate = buildLLMSpanSqlPredicate({
      attributeField: 'SpanAttributes',
      isJsonColumn: true,
    });
    expect(predicate).toContain(
      "toString(SpanAttributes.`gen_ai.operation.name`) != ''",
    );
  });
});
