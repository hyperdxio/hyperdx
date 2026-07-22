import { generateObject, type LanguageModel, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';

import { blindAnswer, type BlindingEntry } from './blind';
import {
  DEFAULT_JUDGE_SPEC,
  parseJudgeSpec,
  resolveJudgeModel,
} from './judgeModel';
import {
  buildJudgeSystem,
  buildJudgeUser,
  formatGroundTruthFacts,
} from './judgePrompt';
import type { JudgeCriterionScore, JudgeResult, Rubric } from './types';

// Output-token budget for the judge's JSON response. Raised from the original
// 1500 because reasoning models (e.g. OpenAI gpt-5.x) spend a large, hidden
// portion of the output budget on internal reasoning BEFORE emitting the
// structured JSON — too small a cap truncates the answer and yields an empty /
// invalid object. Non-reasoning models comfortably fit the JSON in far less.
const MAX_TOKENS = 4000;
// Reasoning models need extra headroom on top of MAX_TOKENS for their hidden
// reasoning tokens, which are billed against the same output budget.
const REASONING_MAX_TOKENS = 16000;

/**
 * Detect models that emit hidden reasoning tokens (OpenAI o-series and gpt-5.x
 * reasoning variants). These need a larger output budget so the reasoning does
 * not starve the structured JSON. The check is intentionally broad — an
 * over-generous cap is harmless (it only bounds, never forces, output) whereas
 * an under-provisioned reasoning model fails to return valid JSON.
 */
function maxOutputTokensFor(spec: string): number {
  const model = spec.slice(spec.indexOf(':') + 1).toLowerCase();
  const isReasoning =
    /(^|[^a-z])o[134]([^a-z]|$)/.test(model) || // o1 / o3 / o4 families
    /gpt-5/.test(model); // gpt-5.x reasoning variants
  return isReasoning ? REASONING_MAX_TOKENS : MAX_TOKENS;
}

export type JudgeOptions = {
  scenarioName: string;
  scenarioPrompt: string;
  groundTruth: unknown;
  rubric: Rubric;
  finalAnswer: string;
  /**
   * Judge model spec in `provider:model` form (e.g. `openai:gpt-4o`). A bare
   * model name defaults to the anthropic provider. Defaults to
   * {@link DEFAULT_JUDGE_SPEC}.
   */
  judgeModel?: string;
  /**
   * Inject a pre-built AI-SDK model (test seam). When omitted the model is
   * resolved from `judgeModel` + the environment via `resolveJudgeModel`.
   */
  model?: LanguageModel;
  /** Blinding entries for anonymizing MCP identity in the answer. */
  blindingEntries?: BlindingEntry[];
  /** Custom judge system preamble from a scenario hook. */
  judgeSystemPreamble?: string;
  /** Post-run inspection evidence to append to the judge prompt. */
  inspectionEvidence?: string;
};

// One criterion's score. Every field is REQUIRED (no `.optional()`/`.default()`)
// because OpenAI's strict structured-output mode rejects a schema whose object
// properties are not all listed in `required`. Empty rationales are tolerated
// downstream in validateAndScore.
const JudgeCriterionSchema = z.object({
  score: z.number(),
  rationale: z.string(),
});

/**
 * Build the judge response schema from the rubric's criteria. We use an
 * explicit key per criterion (a CLOSED object) rather than an open
 * `z.record(...)` map: OpenAI's strict structured-output mode (the Responses
 * API) rejects the open-record `additionalProperties` form, whereas a closed
 * object with every key in `required` is accepted by both OpenAI and Anthropic.
 * The criterion IDs are always known up front (they come from the rubric), so
 * enumerating them costs nothing and keeps the judge provider-portable.
 */
function buildResponseSchema(rubric: Rubric) {
  const shape: Record<string, typeof JudgeCriterionSchema> = {};
  for (const criterion of rubric.judge.criteria) {
    shape[criterion.id] = JudgeCriterionSchema;
  }
  return z.object({ scores: z.object(shape) });
}

export async function judgeTrajectory(
  opts: JudgeOptions,
): Promise<JudgeResult> {
  // Record the fully-qualified spec (e.g. `openai:gpt-4o`) so reports and the
  // viewer can disambiguate the grader provider.
  const spec = parseJudgeSpec(opts.judgeModel ?? DEFAULT_JUDGE_SPEC).spec;

  const systemPrompt = buildJudgeSystem(
    opts.scenarioName,
    opts.rubric,
    opts.judgeSystemPreamble,
  );
  const userPrompt = buildJudgeUser({
    scenarioPrompt: opts.scenarioPrompt,
    groundTruthFacts: formatGroundTruthFacts(opts.groundTruth),
    candidateAnswer: blindAnswer(opts.finalAnswer, opts.blindingEntries),
    dashboardEvidence: opts.inspectionEvidence,
  });

  const model = opts.model ?? resolveJudgeModel(spec);
  const schema = buildResponseSchema(opts.rubric);
  const maxOutputTokens = maxOutputTokensFor(spec);

  const startedMs = Date.now();
  // Structured-output generation is intermittently malformed (providers
  // occasionally wrap or stringify the JSON in ways strict validation rejects).
  // salvageNestedScores recovers the well-formed nesting variants; for anything
  // it can't repair we retry once with a corrective reminder before giving up.
  // Tokens accumulate across attempts so cost tracking stays accurate.
  let result = await callJudge({
    model,
    schema,
    maxOutputTokens,
    systemPrompt,
    userPrompt,
  });
  if (result.error) {
    const retry = await callJudge({
      model,
      schema,
      maxOutputTokens,
      systemPrompt,
      userPrompt:
        userPrompt +
        '\n\nIMPORTANT: return ONLY the JSON object described above — a single ' +
        'top-level "scores" object mapping each criterion id directly to ' +
        '{ "score": N, "rationale": "..." }. Do not wrap it in an extra ' +
        '"scores" key, do not stringify it, and emit no text outside the JSON.',
    });
    retry.tokens = sumTokens(result.tokens, retry.tokens);
    result = retry;
  }
  const durationMs = Date.now() - startedMs;

  if (result.error) {
    return {
      model: spec,
      scores: {},
      weightedScore: 0,
      rawResponse: result.rawResponse,
      durationMs,
      tokens: result.tokens,
      error: result.error,
    };
  }

  const validated = validateAndScore(result.parsed, opts.rubric);
  if (validated.error) {
    return {
      model: spec,
      scores: validated.scores,
      weightedScore: 0,
      rawResponse: result.rawResponse,
      durationMs,
      tokens: result.tokens,
      error: validated.error,
    };
  }

  return {
    model: spec,
    scores: validated.scores,
    weightedScore: validated.weightedScore,
    rawResponse: result.rawResponse,
    durationMs,
    tokens: result.tokens,
  };
}

type JudgeApiOutcome = {
  parsed: unknown;
  rawResponse: string;
  tokens: JudgeResult['tokens'];
  error?: string;
};

const ZERO_TOKENS: JudgeResult['tokens'] = {
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheRead: 0,
};

/** Accumulate token usage across retry attempts for accurate cost tracking. */
function sumTokens(
  a: JudgeResult['tokens'],
  b: JudgeResult['tokens'],
): JudgeResult['tokens'] {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

async function callJudge(args: {
  model: LanguageModel;
  schema: z.ZodType<{
    scores: Record<string, { score: number; rationale: string }>;
  }>;
  maxOutputTokens: number;
  systemPrompt: string;
  userPrompt: string;
}): Promise<JudgeApiOutcome> {
  try {
    const result = await generateObject({
      model: args.model,
      schema: args.schema,
      maxOutputTokens: args.maxOutputTokens,
      system: args.systemPrompt,
      prompt: args.userPrompt,
    });
    return {
      parsed: result.object,
      rawResponse: JSON.stringify(result.object),
      tokens: mapUsage(result.usage),
    };
  } catch (err) {
    // generateObject throws NoObjectGeneratedError when the model returned text
    // that failed schema validation. Surface the raw text + partial usage so
    // cost tracking and debugging still work.
    if (NoObjectGeneratedError.isInstance(err)) {
      const tokens = err.usage ? mapUsage(err.usage) : ZERO_TOKENS;
      // Salvage a common, intermittent malformation: the model wraps the
      // criteria under an extra `scores` key, yielding `{scores:{scores:{…}}}`.
      // This happens because the judge system prompt also describes a
      // `{ "scores": {…} }` envelope, which some providers nest inside the SDK's
      // own `scores`-keyed schema. Downstream validateAndScore only needs the
      // criteria object, so unwrap it when present.
      const salvaged = salvageNestedScores(err.text);
      if (salvaged !== null) {
        return { parsed: salvaged, rawResponse: err.text ?? '', tokens };
      }
      return {
        parsed: null,
        rawResponse: err.text ?? '',
        tokens,
        error: 'judge response did not match the expected schema',
      };
    }
    return {
      parsed: null,
      rawResponse: '',
      tokens: ZERO_TOKENS,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Recover a `{ scores: {...} }` object from raw judge text that failed strict
 * schema validation because the model wrapped the criteria in an extra `scores`
 * layer. Two intermittent malformations are handled (both seen in practice):
 *   1. Object nesting:  { "scores": { "scores": { <criteria> } } }
 *   2. String nesting:  { "scores": "{ \"scores\": { <criteria> } }" }  (or the
 *      inner criteria object itself JSON-encoded as a string)
 * Returns the normalized `{ scores: <criteria> }` shape, or null when the text
 * can't be salvaged. These arise because the judge prompt describes a
 * `{ "scores": {…} }` envelope that some providers re-emit inside the SDK's own
 * `scores`-keyed schema.
 */
function salvageNestedScores(text: string | undefined): unknown {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const outer = (parsed as Record<string, unknown>).scores;

  // Variant 2a: the whole inner payload was emitted as a JSON string.
  if (typeof outer === 'string') {
    const reparsed = tryJsonParse(outer);
    // The string may itself be `{ "scores": {…} }` or the bare criteria map.
    const criteria =
      reparsed &&
      typeof reparsed === 'object' &&
      'scores' in (reparsed as Record<string, unknown>)
        ? (reparsed as Record<string, unknown>).scores
        : reparsed;
    return isCriteriaMap(criteria) ? { scores: criteria } : null;
  }

  if (!outer || typeof outer !== 'object') return null;
  let inner = (outer as Record<string, unknown>).scores;
  // Variant 2b: scores.scores is a JSON string of the criteria map.
  if (typeof inner === 'string') {
    inner = tryJsonParse(inner) as typeof inner;
  }
  // Variant 1: genuine object double-nesting (scores.scores is a criteria map,
  // not a leaf {score,rationale}).
  if (isCriteriaMap(inner)) {
    return { scores: inner };
  }
  return null;
}

/** A criteria map is an object of criterion objects, not a leaf score entry. */
function isCriteriaMap(v: unknown): v is Record<string, unknown> {
  return (
    !!v && typeof v === 'object' && !('score' in (v as Record<string, unknown>))
  );
}

function tryJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Map the AI SDK's provider-normalized usage onto the framework's persisted
 * token shape. Providers that don't report prompt caching (e.g. OpenAI) leave
 * the cache fields at 0.
 */
function mapUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}): JudgeResult['tokens'] {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  };
}

function validateAndScore(
  parsed: unknown,
  rubric: Rubric,
): {
  scores: Record<string, JudgeCriterionScore>;
  weightedScore: number;
  error?: string;
} {
  if (!parsed || typeof parsed !== 'object') {
    return { scores: {}, weightedScore: 0, error: 'judge JSON not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  const rawScores = obj.scores;
  if (!rawScores || typeof rawScores !== 'object') {
    return {
      scores: {},
      weightedScore: 0,
      error: 'judge response missing `scores` object',
    };
  }
  const scoresMap = rawScores as Record<string, unknown>;

  const scores: Record<string, JudgeCriterionScore> = {};
  let weightedSum = 0;
  let totalWeight = 0;
  const missing: string[] = [];

  for (const criterion of rubric.judge.criteria) {
    const entry = scoresMap[criterion.id];
    if (!entry || typeof entry !== 'object') {
      missing.push(criterion.id);
      continue;
    }
    const e = entry as Record<string, unknown>;
    const rawScore = typeof e.score === 'number' ? e.score : Number(e.score);
    if (!Number.isFinite(rawScore)) {
      missing.push(criterion.id);
      continue;
    }
    const clamped = Math.max(0, Math.min(5, Math.round(rawScore)));
    scores[criterion.id] = {
      score: clamped,
      rationale: typeof e.rationale === 'string' ? e.rationale : '',
    };
    weightedSum += clamped * criterion.weight;
    totalWeight += criterion.weight;
  }

  if (missing.length > 0) {
    return {
      scores,
      weightedScore: 0,
      error: `judge omitted criteria: ${missing.join(', ')}`,
    };
  }

  const weightedScore = totalWeight === 0 ? 0 : weightedSum / (5 * totalWeight);
  return { scores, weightedScore };
}
