import {
  NON_LLM_FIXTURE,
  OPENINFERENCE_FIXTURE,
  OPENLLMETRY_FIXTURE,
  SEMCONV_ATTRIBUTES_FIXTURE,
  VERCEL_AI_FIXTURE,
} from '@/llm/__fixtures__/spans';
import {
  extractLLMSpanInfo,
  formatCostUsd,
  formatTokenCount,
} from '@/llm/lib/extract';

describe('extractLLMSpanInfo', () => {
  it('returns undefined for non-LLM spans', () => {
    expect(extractLLMSpanInfo(NON_LLM_FIXTURE)).toBeUndefined();
  });

  it('extracts semconv attribute spans', () => {
    const info = extractLLMSpanInfo(SEMCONV_ATTRIBUTES_FIXTURE);
    expect(info).toMatchObject({
      model: 'gpt-4o-2024-08-06', // response model preferred
      requestModel: 'gpt-4o',
      responseModel: 'gpt-4o-2024-08-06',
      provider: 'openai',
      operation: 'chat',
      conversationId: 'conv-123',
      finishReasons: '["stop"]',
      usage: { inputTokens: 150, outputTokens: 42, totalTokens: 192 },
    });
    expect(info?.params).toMatchObject({
      temperature: '0.7',
      max_tokens: '1024',
    });
  });

  it('extracts OpenLLMetry spans with legacy token keys and cache reads', () => {
    const info = extractLLMSpanInfo(OPENLLMETRY_FIXTURE);
    expect(info).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      provider: 'anthropic',
      usage: {
        inputTokens: 3200,
        outputTokens: 180,
        totalTokens: 3380,
        cachedInputTokens: 3000,
      },
    });
  });

  it('extracts OpenInference spans including invocation parameters', () => {
    const info = extractLLMSpanInfo(OPENINFERENCE_FIXTURE);
    expect(info).toMatchObject({
      model: 'gpt-4o-mini',
      provider: 'openai',
      operation: 'llm',
      usage: { inputTokens: 90, outputTokens: 12, totalTokens: 102 },
    });
    expect(info?.params).toMatchObject({
      temperature: '0.2',
      max_tokens: '256',
    });
  });

  it('extracts Vercel AI SDK spans with cached input tokens', () => {
    const info = extractLLMSpanInfo(VERCEL_AI_FIXTURE);
    expect(info).toMatchObject({
      model: 'gpt-4o',
      provider: 'openai.chat',
      operation: 'ai.generateText.doGenerate',
      usage: {
        inputTokens: 512,
        outputTokens: 64,
        totalTokens: 576,
        cachedInputTokens: 256,
      },
    });
  });

  it('honors provided cost attributes', () => {
    const info = extractLLMSpanInfo({
      'gen_ai.request.model': 'custom-model',
      'gen_ai.usage.cost': '0.0123',
    });
    expect(info?.providedCostUsd).toBeCloseTo(0.0123);
  });

  it('tolerates numeric values from JSON-typed columns', () => {
    const info = extractLLMSpanInfo({
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 25,
      'gen_ai.request.temperature': 0.5,
    });
    expect(info?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
    });
    expect(info?.params.temperature).toBe('0.5');
  });
});

describe('formatters', () => {
  it('formats token counts', () => {
    expect(formatTokenCount(42)).toBe('42 tok');
    expect(formatTokenCount(12_345)).toBe('12.3k tok');
    expect(formatTokenCount(2_000_000)).toBe('2M tok');
  });

  it('formats costs', () => {
    expect(formatCostUsd(0)).toBe('$0.00');
    expect(formatCostUsd(0.000375)).toBe('$0.000375');
    expect(formatCostUsd(0.1234)).toBe('$0.1234');
    expect(formatCostUsd(12.345)).toBe('$12.35');
  });
});
