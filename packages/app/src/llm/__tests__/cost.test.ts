import {
  computeCostUsd,
  findModelPrice,
  generateCostSqlExpression,
  resolveSpanCostUsd,
} from '@/llm/lib/cost';
import { MODEL_PRICES } from '@/llm/lib/modelPrices';

describe('MODEL_PRICES catalog', () => {
  it('contains valid, compilable regex patterns', () => {
    for (const price of MODEL_PRICES) {
      expect(() => new RegExp(price.pattern, 'i')).not.toThrow();
      expect(price.inputPricePerToken).toBeGreaterThan(0);
      expect(price.outputPricePerToken).toBeGreaterThan(0);
    }
  });

  it('matches provider-prefixed and vendor-flavored model ids', () => {
    expect(findModelPrice('gpt-4o')?.name).toBe('gpt-4o');
    expect(findModelPrice('openai/gpt-4o')?.name).toBe('gpt-4o');
    expect(findModelPrice('gpt-4o-2024-08-06')?.name).toBe('gpt-4o');
    expect(findModelPrice('gpt-4o-2024-05-13')?.name).toBe('gpt-4o-2024-05-13');
    expect(findModelPrice('GPT-4o-mini')?.name).toBe('gpt-4o-mini');
    expect(findModelPrice('claude-sonnet-4-5-20250929')?.name).toBe(
      'claude-sonnet-4-x',
    );
    expect(
      findModelPrice('us.anthropic.claude-sonnet-4-5-20250929-v1:0')?.name,
    ).toBe('claude-sonnet-4-x');
    expect(findModelPrice('anthropic/claude-opus-4-1')?.name).toBe(
      'claude-opus-4',
    );
    // Bracket variants (1M context window ids from Claude Code).
    expect(findModelPrice('claude-opus-5[1m]')?.name).toBe('claude-opus-5');
    expect(findModelPrice('claude-sonnet-4-5-20250929[1m]')?.name).toBe(
      'claude-sonnet-4-x',
    );
    expect(findModelPrice('gemini-2.5-flash')?.name).toBe('gemini-2.5-flash');
    expect(findModelPrice('googleai/gemini-2.5-pro')?.name).toBe(
      'gemini-2.5-pro',
    );
  });

  it('returns undefined for unknown models', () => {
    expect(findModelPrice('my-custom-finetune')).toBeUndefined();
    expect(findModelPrice('')).toBeUndefined();
  });

  it('does not let family patterns swallow more specific variants', () => {
    // mini/nano variants must not match the base family entry.
    expect(findModelPrice('gpt-5-mini')?.name).toBe('gpt-5-mini');
    expect(findModelPrice('gpt-5')?.name).toBe('gpt-5');
    expect(findModelPrice('o1-mini')?.name).toBe('o1-mini');
    expect(findModelPrice('o3-mini')?.name).toBe('o3-mini');
  });
});

describe('computeCostUsd', () => {
  it('computes input+output cost for a known model', () => {
    // gpt-4o: $2.5/M input, $10/M output
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, outputTokens: 100_000 },
      'gpt-4o',
    );
    expect(cost).toBeCloseTo(2.5 + 1.0, 10);
  });

  it('bills cached input tokens at the cached rate', () => {
    // gpt-4o cached input: $1.25/M
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        cachedInputTokens: 400_000,
        outputTokens: 0,
      },
      'gpt-4o',
    );
    expect(cost).toBeCloseTo(0.6 * 2.5 + 0.4 * 1.25, 10);
  });

  it('never bills more cached tokens than input tokens', () => {
    const cost = computeCostUsd(
      { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 },
      'gpt-4o',
    );
    expect(cost).toBeCloseTo(100 * 1.25e-6, 12);
  });

  it('returns undefined for unknown models or empty usage', () => {
    expect(
      computeCostUsd({ inputTokens: 100, outputTokens: 10 }, 'mystery'),
    ).toBeUndefined();
    expect(computeCostUsd({}, 'gpt-4o')).toBeUndefined();
    expect(computeCostUsd({ inputTokens: 10 }, undefined)).toBeUndefined();
  });
});

describe('resolveSpanCostUsd', () => {
  it('prefers the instrumentation-provided cost', () => {
    const resolved = resolveSpanCostUsd({
      model: 'gpt-4o',
      usage: { inputTokens: 1000, outputTokens: 100 },
      providedCostUsd: 0.42,
      params: {},
    });
    expect(resolved).toEqual({ costUsd: 0.42, estimated: false });
  });

  it('falls back to catalog estimation', () => {
    const resolved = resolveSpanCostUsd({
      model: 'gpt-4o',
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
      params: {},
    });
    expect(resolved.estimated).toBe(true);
    expect(resolved.costUsd).toBeCloseTo(2.5, 10);
  });
});

describe('generateCostSqlExpression', () => {
  it('emits a multiIf over catalog patterns', () => {
    const sql = generateCostSqlExpression({
      modelExpr: 'model',
      inputTokensExpr: 'in_tok',
      outputTokensExpr: 'out_tok',
      maxModels: 2,
    });
    expect(sql.startsWith('multiIf(')).toBe(true);
    expect(sql.endsWith(', 0)')).toBe(true);
    expect(sql).toContain("match(model, '(?i)");
    expect(sql).toContain('(in_tok) *');
    expect(sql).toContain('(out_tok) *');
    // Bounded: exactly 2 branches.
    expect(sql.match(/match\(/g)).toHaveLength(2);
  });

  it('wraps with provided-cost precedence when given', () => {
    const sql = generateCostSqlExpression({
      modelExpr: 'model',
      inputTokensExpr: 'in_tok',
      outputTokensExpr: 'out_tok',
      providedCostExpr: 'provided_cost',
      maxModels: 1,
    });
    expect(sql.startsWith('if((provided_cost) > 0, provided_cost,')).toBe(true);
  });

  it('contains no unescaped single quotes inside patterns', () => {
    const sql = generateCostSqlExpression({
      modelExpr: 'm',
      inputTokensExpr: 'i',
      outputTokensExpr: 'o',
    });
    // Sanity: balanced quotes (every pattern is quoted once).
    expect((sql.match(/'/g) ?? []).length % 2).toBe(0);
  });
});
