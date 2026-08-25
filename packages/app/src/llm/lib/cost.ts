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
 * Cache reads are billed at the cached rate and cache writes at the
 * cache-write rate when the catalog has them. Handles both usage
 * conventions: inclusive-style (OpenAI/Vercel: cache reads/writes are a
 * subset of inputTokens) and exclusive-style (Anthropic/OpenInference:
 * inputTokens excludes them) — when reads + writes exceed inputTokens the
 * usage must be exclusive-style. Returns undefined when the model is
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
  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheRead === 0 &&
    cacheWrite === 0
  ) {
    return undefined;
  }

  const isExclusiveStyle = cacheRead + cacheWrite > inputTokens;
  const uncachedTokens = isExclusiveStyle
    ? inputTokens
    : Math.max(inputTokens - cacheRead - cacheWrite, 0);
  const cachedRate = price.cachedInputPricePerToken ?? price.inputPricePerToken;
  const cacheWriteRate =
    price.cacheWriteInputPricePerToken ?? price.inputPricePerToken;

  return (
    uncachedTokens * price.inputPricePerToken +
    cacheRead * cachedRate +
    cacheWrite * cacheWriteRate +
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
 * dashboard aggregation. Prices cache reads and cache writes at their
 * discounted/premium rates when the catalog has them (mirrors
 * computeCostUsd), with the instrumentation-provided cost taking
 * precedence.
 *
 * Shape: each token-count expression appears exactly once, multiplied by a
 * rate-only `multiIf` over the catalog's patterns (RE2-compatible, matched
 * case-insensitively). Embedding the token expressions inside every model
 * branch instead would multiply their (large) coalesce chains by the
 * catalog size and blow past ClickHouse's default 256 KiB max_query_size
 * once a query sums the cost more than once. `maxModels` bounds the
 * expression size; entries beyond it fall through to 0.
 */
export function generateCostSqlExpression({
  modelExpr,
  uncachedInputTokensExpr,
  cachedInputTokensExpr,
  cacheWriteInputTokensExpr,
  outputTokensExpr,
  providedCostExpr,
  maxModels = MODEL_PRICES.length,
}: {
  /** SQL expression producing the model name (String). */
  modelExpr: string;
  /** SQL expression producing the uncached input token count. */
  uncachedInputTokensExpr: string;
  /** SQL expression producing the cache-read input token count. */
  cachedInputTokensExpr: string;
  /** SQL expression producing the cache-write input token count. */
  cacheWriteInputTokensExpr: string;
  /** SQL expression producing output token count (Float64/UInt64). */
  outputTokensExpr: string;
  /** Optional SQL expression producing the provided cost (Float64, 0 = none). */
  providedCostExpr?: string;
  maxModels?: number;
}): string {
  const prices = MODEL_PRICES.slice(0, maxModels);
  const rateMultiIf = (rateOf: (price: ModelPrice) => number): string => {
    const branches = prices
      .map(price => {
        const pattern = escapeSqlString(`(?i)${price.pattern}`);
        return `match(${modelExpr}, '${pattern}'), ${rateOf(price)}`;
      })
      .join(', ');
    return `multiIf(${branches}, 0)`;
  };

  const estimate = [
    `(${uncachedInputTokensExpr}) * ${rateMultiIf(p => p.inputPricePerToken)}`,
    `(${cachedInputTokensExpr}) * ${rateMultiIf(p => p.cachedInputPricePerToken ?? p.inputPricePerToken)}`,
    `(${cacheWriteInputTokensExpr}) * ${rateMultiIf(p => p.cacheWriteInputPricePerToken ?? p.inputPricePerToken)}`,
    `(${outputTokensExpr}) * ${rateMultiIf(p => p.outputPricePerToken)}`,
  ].join(' + ');
  if (!providedCostExpr) return estimate;
  return `if((${providedCostExpr}) > 0, ${providedCostExpr}, ${estimate})`;
}
