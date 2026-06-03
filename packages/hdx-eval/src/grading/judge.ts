import Anthropic from '@anthropic-ai/sdk';

import { blindAnswer, type BlindingEntry } from './blind';
import {
  buildJudgeSystem,
  buildJudgeUser,
  formatGroundTruthFacts,
} from './judgePrompt';
import type { JudgeCriterionScore, JudgeResult, Rubric } from './types';

const DEFAULT_JUDGE_MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 1500;

export type JudgeOptions = {
  scenarioName: string;
  scenarioPrompt: string;
  groundTruth: unknown;
  rubric: Rubric;
  finalAnswer: string;
  judgeModel?: string;
  client?: Anthropic;
  /** Blinding entries for anonymizing MCP identity in the answer. */
  blindingEntries?: BlindingEntry[];
};

export async function judgeTrajectory(
  opts: JudgeOptions,
): Promise<JudgeResult> {
  const model = opts.judgeModel ?? DEFAULT_JUDGE_MODEL;
  const client =
    opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = buildJudgeSystem(opts.scenarioName, opts.rubric);
  const userPrompt = buildJudgeUser({
    scenarioPrompt: opts.scenarioPrompt,
    groundTruthFacts: formatGroundTruthFacts(opts.groundTruth),
    candidateAnswer: blindAnswer(opts.finalAnswer, opts.blindingEntries),
  });

  const startedMs = Date.now();
  const result = await callJudgeWithRetry({
    client,
    model,
    systemPrompt,
    userPrompt,
  });
  const durationMs = Date.now() - startedMs;

  if (result.error) {
    return {
      model,
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
      model,
      scores: validated.scores,
      weightedScore: 0,
      rawResponse: result.rawResponse,
      durationMs,
      tokens: result.tokens,
      error: validated.error,
    };
  }

  return {
    model,
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

async function callJudgeWithRetry(args: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<JudgeApiOutcome> {
  const first = await callJudgeOnce(args);
  if (!first.error) return first;

  // Retry once with a stricter reminder appended.
  const retry = await callJudgeOnce({
    ...args,
    userPrompt:
      args.userPrompt +
      '\n\nReturn STRICT JSON only — no Markdown fences, no prose.',
  });
  if (retry.error) {
    // Surface the second error but accumulate tokens from both attempts.
    retry.tokens = sumTokens(first.tokens, retry.tokens);
  }
  return retry;
}

async function callJudgeOnce(args: {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<JudgeApiOutcome> {
  let response: Anthropic.Message;
  try {
    response = await args.client.messages.create({
      model: args.model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: args.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: args.userPrompt }],
    });
  } catch (err) {
    return {
      parsed: null,
      rawResponse: '',
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      error:
        err instanceof Anthropic.APIError
          ? `${err.constructor.name} (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const tokens = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheCreation: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  };

  const parsed = tryParseJson(text);
  if (parsed === null) {
    return {
      parsed: null,
      rawResponse: text,
      tokens,
      error: 'judge response was not valid JSON',
    };
  }
  return { parsed, rawResponse: text, tokens };
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  // Direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  // Extract the first {...} block in case the model wrapped JSON in prose.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
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
