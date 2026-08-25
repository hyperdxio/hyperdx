/**
 * Bundled model price catalog for cost estimation.
 *
 * Adapted from Langfuse's MIT-licensed default model price list
 * (https://github.com/langfuse/langfuse), trimmed to a curated set of
 * current, widely used models. Prices are USD per token. Cached price is
 * the per-token price applied to cached input tokens (a subset of input
 * tokens). Prices go stale between releases — an explicit
 * `gen_ai.usage.cost` attribute always takes precedence (see cost.ts).
 *
 * Entries are ordered most-specific → least-specific; the first pattern
 * match wins. Tuple:
 * [name, regex source, input, output, cachedInput?, cacheWriteInput?].
 */
type PriceTuple = [string, string, number, number, number?, number?];

// prettier-ignore
const OPENAI: PriceTuple[] = [
  ['gpt-5.6-sol', '^(openai/)?gpt-5\\.6-sol$', 5e-6, 30e-6, 5e-7],
  ['gpt-5.6-terra', '^(openai/)?gpt-5\\.6-terra$', 2e-6, 12e-6, 2e-7],
  ['gpt-5.6-luna', '^(openai/)?gpt-5\\.6-luna$', 2e-7, 1.2e-6, 2e-8],
  ['gpt-5.5-pro', '^(openai/)?gpt-5\\.5-pro(-\\d{4}-\\d{2}-\\d{2})?$', 30e-6, 180e-6],
  ['gpt-5.5', '^(openai/)?gpt-5\\.5(-\\d{4}-\\d{2}-\\d{2})?$', 5e-6, 30e-6, 5e-7],
  ['gpt-5.4-pro', '^(openai/)?gpt-5\\.4-pro(-\\d{4}-\\d{2}-\\d{2})?$', 30e-6, 180e-6],
  ['gpt-5.4-mini', '^(openai/)?gpt-5\\.4-mini(-\\d{4}-\\d{2}-\\d{2})?$', 7.5e-7, 4.5e-6, 7.5e-8],
  ['gpt-5.4-nano', '^(openai/)?gpt-5\\.4-nano(-\\d{4}-\\d{2}-\\d{2})?$', 2e-7, 1.25e-6, 2e-8],
  ['gpt-5.4', '^(openai/)?gpt-5\\.4(-\\d{4}-\\d{2}-\\d{2})?$', 2.5e-6, 15e-6, 2.5e-7],
  ['gpt-5.3-codex', '^(openai/)?gpt-5\\.3-codex$', 1.75e-6, 14e-6, 1.75e-7],
  ['gpt-5.2-pro', '^(openai/)?gpt-5\\.2-pro(-\\d{4}-\\d{2}-\\d{2})?$', 21e-6, 168e-6],
  ['gpt-5.2', '^(openai/)?gpt-5\\.2(-\\d{4}-\\d{2}-\\d{2})?$', 1.75e-6, 14e-6, 1.75e-7],
  ['gpt-5.1', '^(openai/)?gpt-5\\.1(-\\d{4}-\\d{2}-\\d{2})?$', 1.25e-6, 10e-6, 1.25e-7],
  ['gpt-5-pro', '^(openai/)?gpt-5-pro(-\\d{4}-\\d{2}-\\d{2})?$', 15e-6, 120e-6],
  ['gpt-5-mini', '^(openai/)?gpt-5-mini(-\\d{4}-\\d{2}-\\d{2})?$', 2.5e-7, 2e-6, 2.5e-8],
  ['gpt-5-nano', '^(openai/)?gpt-5-nano(-\\d{4}-\\d{2}-\\d{2})?$', 5e-8, 4e-7, 5e-9],
  ['gpt-5', '^(openai/)?gpt-5(-chat-latest|-\\d{4}-\\d{2}-\\d{2})?$', 1.25e-6, 10e-6, 1.25e-7],
  ['gpt-4.1-mini', '^(openai/)?gpt-4\\.1-mini(-\\d{4}-\\d{2}-\\d{2})?$', 4e-7, 1.6e-6, 1e-7],
  ['gpt-4.1-nano', '^(openai/)?gpt-4\\.1-nano(-\\d{4}-\\d{2}-\\d{2})?$', 1e-7, 4e-7, 2.5e-8],
  ['gpt-4.1', '^(openai/)?gpt-4\\.1(-\\d{4}-\\d{2}-\\d{2})?$', 2e-6, 8e-6, 5e-7],
  ['gpt-4o-2024-05-13', '^(openai/)?gpt-4o-2024-05-13$', 5e-6, 15e-6],
  ['gpt-4o-mini', '^(openai/)?gpt-4o-mini(-\\d{4}-\\d{2}-\\d{2})?$', 1.5e-7, 6e-7, 7.5e-8],
  ['gpt-4o', '^(openai/)?(gpt-4o(-\\d{4}-\\d{2}-\\d{2})?|chatgpt-4o-latest)$', 2.5e-6, 10e-6, 1.25e-6],
  ['o4-mini', '^(openai/)?o4-mini(-\\d{4}-\\d{2}-\\d{2})?$', 1.1e-6, 4.4e-6, 2.75e-7],
  ['o3-pro', '^(openai/)?o3-pro(-\\d{4}-\\d{2}-\\d{2})?$', 20e-6, 80e-6],
  ['o3-mini', '^(openai/)?o3-mini(-\\d{4}-\\d{2}-\\d{2})?$', 1.1e-6, 4.4e-6, 5.5e-7],
  ['o3', '^(openai/)?o3(-\\d{4}-\\d{2}-\\d{2})?$', 2e-6, 8e-6, 5e-7],
  ['o1-pro', '^(openai/)?o1-pro(-\\d{4}-\\d{2}-\\d{2})?$', 150e-6, 600e-6],
  ['o1-mini', '^(openai/)?o1-mini(-\\d{4}-\\d{2}-\\d{2})?$', 1.1e-6, 4.4e-6, 5.5e-7],
  ['o1', '^(openai/)?o1(-preview)?(-\\d{4}-\\d{2}-\\d{2})?$', 15e-6, 60e-6, 7.5e-6],
];

// Anthropic model ids also appear as Bedrock ids
// (`us.anthropic.claude-...-v1:0`) and Vertex ids (`claude-...@date`).
const A =
  '^((anthropic/)?|(eu\\.|us\\.|apac\\.|au\\.|jp\\.|global\\.)?anthropic\\.)';
// Optional trailing variant markers: Bedrock -v1:0, Vertex @date, and
// bracket variants like claude-opus-5[1m] (1M context window).
const AV = '(\\[[^\\]]+\\])?(-v\\d+(:\\d+)?)?(@\\d+)?$';
// Anthropic bills prompt-cache writes at 1.25x the input rate (5m TTL).
// prettier-ignore
const ANTHROPIC: PriceTuple[] = [
  ['claude-opus-5', `${A}claude-opus-5${AV}`, 5e-6, 25e-6, 5e-7, 6.25e-6],
  ['claude-sonnet-5', `${A}claude-sonnet-5${AV}`, 2e-6, 10e-6, 2e-7, 2.5e-6],
  ['claude-fable-5', `${A}claude-fable-5${AV}`, 10e-6, 50e-6, 1e-6, 12.5e-6],
  ['claude-mythos-5', `${A}claude-mythos-5${AV}`, 10e-6, 50e-6, 1e-6, 12.5e-6],
  ['claude-opus-4-x', `${A}claude-opus-4-[5-9](-\\d{8})?${AV}`, 5e-6, 25e-6, 5e-7, 6.25e-6],
  ['claude-opus-4', `${A}claude-opus-4(-1)?(-\\d{8})?${AV}`, 15e-6, 75e-6, 1.5e-6, 18.75e-6],
  ['claude-sonnet-4-x', `${A}claude-sonnet-4(-[5-9])?(-latest|-\\d{8})?${AV}`, 3e-6, 15e-6, 3e-7, 3.75e-6],
  ['claude-haiku-4-5', `${A}claude-haiku-4-5(-\\d{8})?${AV}`, 1e-6, 5e-6, 1e-7, 1.25e-6],
  ['claude-3-7-sonnet', `${A}claude-3[.-]7-sonnet(-latest|-\\d{8})?${AV}`, 3e-6, 15e-6, 3e-7, 3.75e-6],
  ['claude-3-5-sonnet', `${A}claude-3[.-]5-sonnet(-latest|-\\d{8})?${AV}`, 3e-6, 15e-6, 3e-7, 3.75e-6],
  ['claude-3-5-haiku', `${A}claude-3[.-]5-haiku(-latest|-\\d{8})?${AV}`, 8e-7, 4e-6, 8e-8, 1e-6],
  ['claude-3-opus', `${A}claude-3-opus(-latest|-\\d{8})?${AV}`, 15e-6, 75e-6],
  ['claude-3-haiku', `${A}claude-3-haiku(-\\d{8})?${AV}`, 2.5e-7, 1.25e-6],
];

const G = '^(google(ai)?/)?';
// prettier-ignore
const GOOGLE: PriceTuple[] = [
  ['gemini-3.7-flash', `${G}gemini-3\\.7-flash$`, 7.5e-7, 3.75e-6, 7.5e-8],
  ['gemini-3.6-flash', `${G}gemini-3\\.6-flash$`, 7.5e-7, 3.75e-6, 7.5e-8],
  ['gemini-3.5-flash-lite', `${G}gemini-3\\.5-flash-lite$`, 3e-7, 2.5e-6, 3e-8],
  ['gemini-3.5-flash', `${G}gemini-3\\.5-flash$`, 1.5e-6, 9e-6, 1.5e-7],
  ['gemini-3.1-flash-lite', `${G}gemini-3\\.1-flash-lite(-preview)?$`, 2.5e-7, 1.5e-6, 2.5e-8],
  ['gemini-3.1-pro', `${G}gemini-3\\.1-pro-preview(-customtools)?$`, 2e-6, 12e-6, 2e-7],
  ['gemini-3-pro', `${G}gemini-3-pro-preview$`, 2e-6, 12e-6, 2e-7],
  ['gemini-3-flash', `${G}gemini-3-flash-preview$`, 5e-7, 3e-6, 5e-8],
  ['gemini-2.5-pro', `${G}gemini-2\\.5-pro$`, 1.25e-6, 10e-6, 1.25e-7],
  ['gemini-2.5-flash-lite', `${G}gemini-2\\.5-flash-lite$`, 1e-7, 4e-7, 1e-8],
  ['gemini-2.5-flash', `${G}gemini-2\\.5-flash$`, 3e-7, 2.5e-6, 3e-8],
  ['gemini-2.0-flash-lite', `${G}gemini-2\\.0-flash-lite[\\w-]*$`, 7.5e-8, 3e-7],
  ['gemini-2.0-flash', `${G}gemini-2\\.0-flash(-001)?$`, 1e-7, 4e-7],
];

export interface ModelPrice {
  /** Canonical display name of the model family entry. */
  name: string;
  /** Case-insensitive RE2/JS-compatible regex source matched against the model. */
  pattern: string;
  /** USD per input token. */
  inputPricePerToken: number;
  /** USD per output token. */
  outputPricePerToken: number;
  /** USD per cached input token, when the provider discounts cache reads. */
  cachedInputPricePerToken?: number;
  /**
   * USD per cache-write/creation input token, when the provider bills cache
   * writes at a premium (e.g. Anthropic at 1.25x input). Falls back to the
   * plain input rate when unset.
   */
  cacheWriteInputPricePerToken?: number;
}

export const MODEL_PRICES: ModelPrice[] = [
  ...OPENAI,
  ...ANTHROPIC,
  ...GOOGLE,
].map(([name, pattern, input, output, cached, cacheWrite]) => ({
  name,
  pattern,
  inputPricePerToken: input,
  outputPricePerToken: output,
  ...(cached !== undefined ? { cachedInputPricePerToken: cached } : {}),
  ...(cacheWrite !== undefined
    ? { cacheWriteInputPricePerToken: cacheWrite }
    : {}),
}));
