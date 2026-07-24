import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Provider-agnostic resolver for the LLM-as-judge model.
 *
 * The eval framework grades runs with an LLM judge. To keep the grader
 * independent from (and less biased than) the model that produced a run, the
 * judge can be pointed at a different provider/model than the runner — e.g.
 * run with Anthropic, grade with OpenAI.
 *
 * A judge spec is a `provider:model` string:
 *   - `anthropic:claude-opus-4-7`
 *   - `openai:gpt-4o`
 *   - `claude-opus-4-7`  (no prefix → defaults to the anthropic provider)
 *
 * Provider clients are configured from environment variables, mirroring the
 * pattern in `packages/api/src/controllers/ai.ts`:
 *   - AI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY — provider API key
 *   - AI_BASE_URL         — custom endpoint (Azure AI, LiteLLM proxy, etc.)
 *   - AI_REQUEST_HEADERS  — extra headers as a JSON object (OpenAI only)
 */

export type JudgeProvider = 'anthropic' | 'openai';

export const DEFAULT_JUDGE_PROVIDER: JudgeProvider = 'anthropic';
export const DEFAULT_JUDGE_MODEL = 'claude-opus-4-7';

/** The fully-qualified default spec, e.g. `anthropic:claude-opus-4-7`. */
export const DEFAULT_JUDGE_SPEC = `${DEFAULT_JUDGE_PROVIDER}:${DEFAULT_JUDGE_MODEL}`;

const SUPPORTED_PROVIDERS: JudgeProvider[] = ['anthropic', 'openai'];

export type ParsedJudgeSpec = {
  provider: JudgeProvider;
  model: string;
  /** Canonical `provider:model` form. */
  spec: string;
};

/**
 * Parse a `provider:model` judge spec. A spec with no `provider:` prefix
 * defaults to the anthropic provider (preserving legacy `--judge-model
 * claude-opus-4-7` behavior).
 */
export function parseJudgeSpec(spec: string): ParsedJudgeSpec {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error('Judge model spec is empty.');
  }

  // Only split on the FIRST colon so model names containing ':' survive.
  const colonIdx = trimmed.indexOf(':');
  let providerRaw: string;
  let model: string;
  if (colonIdx === -1) {
    providerRaw = DEFAULT_JUDGE_PROVIDER;
    model = trimmed;
  } else {
    providerRaw = trimmed.slice(0, colonIdx).trim().toLowerCase();
    model = trimmed.slice(colonIdx + 1).trim();
  }

  if (!isSupportedProvider(providerRaw)) {
    throw new Error(
      `Unknown judge provider "${providerRaw}". Supported: ${SUPPORTED_PROVIDERS.join(
        ', ',
      )}. Use a "provider:model" spec, e.g. "openai:gpt-4o".`,
    );
  }
  if (!model) {
    throw new Error(
      `Judge model spec "${spec}" is missing a model name after the provider.`,
    );
  }

  return { provider: providerRaw, model, spec: `${providerRaw}:${model}` };
}

function isSupportedProvider(value: string): value is JudgeProvider {
  return (SUPPORTED_PROVIDERS as string[]).includes(value);
}

/**
 * Resolve a judge spec into an AI-SDK `LanguageModel`, wiring up provider
 * credentials/endpoints from the environment. Throws a clear error naming the
 * missing key when credentials are absent.
 */
export function resolveJudgeModel(spec: string): LanguageModel {
  const { provider, model } = parseJudgeSpec(spec);
  switch (provider) {
    case 'anthropic':
      return buildAnthropicModel(model);
    case 'openai':
      return buildOpenAIModel(model);
  }
}

function buildAnthropicModel(model: string): LanguageModel {
  // Prefer the provider-specific key over the generic AI_API_KEY. In evals the
  // runner is always Anthropic while the judge may be a DIFFERENT provider, so
  // AI_API_KEY (often the runner's key) must not shadow a provider-specific
  // grader key when the two providers differ.
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || undefined;
  if (!apiKey) {
    throw new Error(
      'No API key defined for the Anthropic judge. Set ANTHROPIC_API_KEY or ' +
        'AI_API_KEY.',
    );
  }
  const anthropic = createAnthropic({
    apiKey,
    ...(process.env.AI_BASE_URL && { baseURL: process.env.AI_BASE_URL }),
  });
  return anthropic(model);
}

function buildOpenAIModel(model: string): LanguageModel {
  // Prefer the provider-specific key over the generic AI_API_KEY (see note in
  // buildAnthropicModel): a runner-scoped AI_API_KEY must not be sent to OpenAI
  // when OPENAI_API_KEY is what identifies the grader.
  const apiKey =
    process.env.OPENAI_API_KEY || process.env.AI_API_KEY || undefined;
  if (!apiKey) {
    throw new Error(
      'No API key defined for the OpenAI judge. Set OPENAI_API_KEY or ' +
        'AI_API_KEY.',
    );
  }
  const headers = parseHeaders(process.env.AI_REQUEST_HEADERS);
  const openai = createOpenAI({
    apiKey,
    ...(process.env.AI_BASE_URL && { baseURL: process.env.AI_BASE_URL }),
    ...(Object.keys(headers).length > 0 && { headers }),
  });
  // Use the Responses API (/v1/responses), matching packages/api.
  return openai.responses(model);
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `AI_REQUEST_HEADERS is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI_REQUEST_HEADERS must be a JSON object of strings.');
  }
  return parsed as Record<string, string>;
}

/**
 * True when credentials for the given judge spec's provider are available in
 * the environment. Used by the grading orchestrator to fail fast with a clear
 * message before attempting to construct the model.
 */
export function judgeCredentialsAvailable(spec: string): boolean {
  const { provider } = parseJudgeSpec(spec);
  switch (provider) {
    case 'anthropic':
      return Boolean(process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY);
    case 'openai':
      return Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  }
}
