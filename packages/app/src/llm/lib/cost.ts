import { MODEL_PRICES, ModelPrice } from './modelPrices';
import { LLMSpanInfo, LLMUsage } from './types';

const compiledPatterns = new Map<string, RegExp | null>();

/** Find the bundled price entry matching a model name (first match wins). */
export function findModelPrice(model: string): ModelPrice | undefined {
  for (const price of MODEL_PRICES) {
    let regex = compiledPatterns.get(price.pattern);
    if (regex === undefined) {
      try {
        regex = new RegExp(price.pattern, 'i');
      } catch {
        regex = null;
      }
      compiledPatterns.set(price.pattern, regex);
    }
    if (regex?.test(model)) return price;
  }
  return undefined;
}

/**
 * Estimate the USD cost of a call from token usage and the bundled catalog.
 * Cached input tokens are treated as a subset of input tokens (OTel GenAI
 * `gen_ai.usage.input_tokens` includes cached reads) and billed at the
 * cached rate when the catalog has one. Returns undefined when the model is
 * unknown or there is no usage to price.
 */
export function computeCostUsd(
  usage: LLMUsage,
  model: string | undefined,
): number | undefined {
  if (!model) return undefined;
  const price = findModelPrice(model);
  if (!price) return undefined;

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;

  const cachedTokens = Math.min(usage.cachedInputTokens ?? 0, inputTokens);
  const cachedRate = price.cachedInputPricePerToken ?? price.inputPricePerToken;

  return (
    (inputTokens - cachedTokens) * price.inputPricePerToken +
    cachedTokens * cachedRate +
    outputTokens * price.outputPricePerToken
  );
}

/**
 * Resolve the cost of a span: an instrumentation-provided cost always wins;
 * otherwise estimate from usage + catalog.
 */
export function resolveSpanCostUsd(info: LLMSpanInfo): {
  costUsd: number | undefined;
  estimated: boolean;
} {
  if (info.providedCostUsd !== undefined) {
    return { costUsd: info.providedCostUsd, estimated: false };
  }
  return {
    costUsd: computeCostUsd(info.usage, info.model),
    estimated: true,
  };
}

const escapeSqlString = (value: string) => value.replace(/'/g, "\\'");

/**
 * Generate a ClickHouse SQL expression estimating per-row cost in USD for
 * dashboard aggregation. Emits a `multiIf` over the bundled catalog's
 * patterns (RE2-compatible, matched case-insensitively) with the
 * instrumentation-provided cost taking precedence. `maxModels` bounds the
 * expression size; entries beyond it fall through to 0.
 */
export function generateCostSqlExpression({
  modelExpr,
  inputTokensExpr,
  outputTokensExpr,
  providedCostExpr,
  maxModels = MODEL_PRICES.length,
}: {
  /** SQL expression producing the model name (String). */
  modelExpr: string;
  /** SQL expression producing input token count (Float64/UInt64). */
  inputTokensExpr: string;
  /** SQL expression producing output token count (Float64/UInt64). */
  outputTokensExpr: string;
  /** Optional SQL expression producing the provided cost (Float64, 0 = none). */
  providedCostExpr?: string;
  maxModels?: number;
}): string {
  const branches = MODEL_PRICES.slice(0, maxModels)
    .map(price => {
      const pattern = escapeSqlString(`(?i)${price.pattern}`);
      const cost = `(${inputTokensExpr}) * ${price.inputPricePerToken} + (${outputTokensExpr}) * ${price.outputPricePerToken}`;
      return `match(${modelExpr}, '${pattern}'), ${cost}`;
    })
    .join(', ');
  const estimate = `multiIf(${branches}, 0)`;
  if (!providedCostExpr) return estimate;
  return `if((${providedCostExpr}) > 0, ${providedCostExpr}, ${estimate})`;
}
