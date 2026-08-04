/**
 * Tests for judgeTrajectory. The judge's only external dependency is the AI
 * SDK's `generateObject`, which we mock so these tests are pure (no network).
 * A fake `LanguageModel` is injected via `opts.model` so `resolveJudgeModel`
 * (and thus provider credentials) is never touched.
 */

import type { LanguageModel } from 'ai';

// Mock the AI SDK. jest.mock is hoisted, so keep the factory self-contained
// and reach into the mock via requireMock below.
jest.mock('ai', () => {
  const actual = jest.requireActual('ai');
  return {
    ...actual,
    generateObject: jest.fn(),
  };
});

import { generateObject, NoObjectGeneratedError } from 'ai';

import { judgeTrajectory } from '@/grading/judge';
import type { Rubric } from '@/grading/types';

const mockGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>;

// A dummy model object; judgeTrajectory passes it straight to generateObject,
// which is mocked, so its concrete shape is irrelevant.
const FAKE_MODEL = {
  provider: 'test',
  modelId: 'test',
} as unknown as LanguageModel;

const RUBRIC: Rubric = {
  programmatic: [],
  judge: {
    criteria: [
      { id: 'accuracy', weight: 2, description: 'Is the answer correct?' },
      { id: 'clarity', weight: 1, description: 'Is the answer clear?' },
    ],
  },
};

function mockJudgeResult(args: {
  object: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
}) {
  mockGenerateObject.mockResolvedValueOnce({
    object: args.object,
    usage: args.usage ?? { inputTokens: 0, outputTokens: 0 },
  } as unknown as Awaited<ReturnType<typeof generateObject>>);
}

function baseOpts() {
  return {
    scenarioName: 'test-scenario',
    scenarioPrompt: 'Why did it break?',
    groundTruth: { rubric: RUBRIC },
    rubric: RUBRIC,
    finalAnswer: 'Because the database timed out.',
    model: FAKE_MODEL,
  };
}

beforeEach(() => {
  mockGenerateObject.mockReset();
});

describe('judgeTrajectory', () => {
  it('maps per-criterion scores to a weighted score in [0,1]', async () => {
    // accuracy=4 (weight 2), clarity=5 (weight 1).
    // weighted = (4*2 + 5*1) / (5 * (2+1)) = 13/15 ≈ 0.8667
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 4, rationale: 'mostly right' },
          clarity: { score: 5, rationale: 'crystal clear' },
        },
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toBeUndefined();
    expect(result.weightedScore).toBeCloseTo(13 / 15, 5);
    expect(result.scores.accuracy.score).toBe(4);
    expect(result.scores.clarity.score).toBe(5);
  });

  it('builds a CLOSED schema keyed by rubric criteria (OpenAI strict-mode safe)', async () => {
    // OpenAI's strict structured-output mode rejects open `z.record` maps and
    // any object property missing from `required`. The judge must therefore
    // pass generateObject a closed object with an explicit, required key per
    // criterion. Validate the schema passed to generateObject accepts a
    // complete response and rejects one that omits a criterion or a field.
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 3, rationale: '' },
          clarity: { score: 3, rationale: '' },
        },
      },
    });

    await judgeTrajectory(baseOpts());

    const callArg = mockGenerateObject.mock.calls[0][0] as {
      schema: { safeParse: (v: unknown) => { success: boolean } };
    };
    const schema = callArg.schema;
    // Complete response for every criterion, all fields present → valid.
    expect(
      schema.safeParse({
        scores: {
          accuracy: { score: 4, rationale: 'ok' },
          clarity: { score: 5, rationale: 'clear' },
        },
      }).success,
    ).toBe(true);
    // Missing a criterion key → rejected (keys are required, not open).
    expect(
      schema.safeParse({ scores: { accuracy: { score: 4, rationale: 'ok' } } })
        .success,
    ).toBe(false);
    // Missing the rationale field → rejected (all fields required).
    expect(
      schema.safeParse({
        scores: {
          accuracy: { score: 4 },
          clarity: { score: 5, rationale: 'clear' },
        },
      }).success,
    ).toBe(false);
  });

  it('records the fully-qualified provider:model spec', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 3, rationale: '' },
          clarity: { score: 3, rationale: '' },
        },
      },
    });

    const result = await judgeTrajectory({
      ...baseOpts(),
      judgeModel: 'openai:gpt-4o',
    });

    expect(result.model).toBe('openai:gpt-4o');
  });

  it('defaults a bare judgeModel to the anthropic provider', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 3, rationale: '' },
          clarity: { score: 3, rationale: '' },
        },
      },
    });

    const result = await judgeTrajectory({
      ...baseOpts(),
      judgeModel: 'claude-opus-4-7',
    });

    expect(result.model).toBe('anthropic:claude-opus-4-7');
  });

  it('errors (weightedScore 0) when a criterion is omitted', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 5, rationale: 'great' },
          // clarity missing
        },
      },
    });

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toMatch(/omitted criteria: clarity/);
    expect(result.weightedScore).toBe(0);
    // The score it did return is still captured.
    expect(result.scores.accuracy.score).toBe(5);
  });

  it('clamps scores into the 0..5 range and rounds', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 9.4, rationale: 'over' },
          clarity: { score: -2, rationale: 'under' },
        },
      },
    });

    const result = await judgeTrajectory(baseOpts());

    expect(result.scores.accuracy.score).toBe(5);
    expect(result.scores.clarity.score).toBe(0);
  });

  it('maps AI-SDK cache token details onto the persisted token shape', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 3, rationale: '' },
          clarity: { score: 3, rationale: '' },
        },
      },
      usage: {
        inputTokens: 500,
        outputTokens: 40,
        inputTokenDetails: { cacheReadTokens: 120, cacheWriteTokens: 300 },
      },
    });

    const result = await judgeTrajectory(baseOpts());

    expect(result.tokens).toEqual({
      input: 500,
      output: 40,
      cacheCreation: 300,
      cacheRead: 120,
    });
  });

  it('zero-fills cache tokens for providers that do not report caching (e.g. OpenAI)', async () => {
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 4, rationale: '' },
          clarity: { score: 4, rationale: '' },
        },
      },
      usage: { inputTokens: 200, outputTokens: 30 },
    });

    const result = await judgeTrajectory({
      ...baseOpts(),
      judgeModel: 'openai:gpt-4o',
    });

    expect(result.error).toBeUndefined();
    expect(result.tokens.cacheCreation).toBe(0);
    expect(result.tokens.cacheRead).toBe(0);
    expect(result.tokens.input).toBe(200);
    expect(result.tokens.output).toBe(30);
    expect(result.model).toBe('openai:gpt-4o');
  });

  it('surfaces a generation error without throwing (after the retry also fails)', async () => {
    // Both the initial attempt and the retry fail.
    mockGenerateObject.mockRejectedValue(new Error('provider exploded'));

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toBe('provider exploded');
    expect(result.weightedScore).toBe(0);
    expect(result.tokens).toEqual({
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
    });
    // Confirms the retry path ran (initial + 1 retry).
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('retries once on a schema failure and succeeds on the second attempt', async () => {
    // First attempt: unsalvageable malformation → NoObjectGeneratedError.
    mockGenerateObject.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'schema validation failed',
        text: '{"scores": "totally broken', // truncated/invalid, cannot salvage
        response: {} as never,
        usage: { inputTokens: 100, outputTokens: 10 } as never,
        finishReason: 'length',
      }),
    );
    // Retry: well-formed.
    mockJudgeResult({
      object: {
        scores: {
          accuracy: { score: 4, rationale: 'ok' },
          clarity: { score: 4, rationale: 'ok' },
        },
      },
      usage: { inputTokens: 120, outputTokens: 20 },
    });

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toBeUndefined();
    expect(result.scores.accuracy.score).toBe(4);
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    // Tokens accumulate across the failed attempt + the successful retry.
    expect(result.tokens.input).toBe(100 + 120);
    expect(result.tokens.output).toBe(10 + 20);
  });

  it('salvages a doubly-nested scores.scores response (intermittent provider quirk)', async () => {
    // Some providers wrap the criteria under an extra `scores` key because the
    // judge system prompt also describes a { "scores": {...} } envelope.
    // generateObject rejects this against the strict schema and throws
    // NoObjectGeneratedError; judgeTrajectory must recover from err.text.
    const nested = JSON.stringify({
      scores: {
        scores: {
          accuracy: { score: 4, rationale: 'good' },
          clarity: { score: 5, rationale: 'clear' },
        },
      },
    });
    const err = new NoObjectGeneratedError({
      message: 'schema validation failed',
      text: nested,
      response: {} as never,
      usage: {
        inputTokens: 300,
        outputTokens: 50,
      } as never,
      finishReason: 'stop',
    });
    mockGenerateObject.mockRejectedValueOnce(err);

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toBeUndefined();
    expect(result.scores.accuracy.score).toBe(4);
    expect(result.scores.clarity.score).toBe(5);
    // weighted = (4*2 + 5*1) / (5*3) = 13/15
    expect(result.weightedScore).toBeCloseTo(13 / 15, 5);
    expect(result.tokens.input).toBe(300);
    expect(result.tokens.output).toBe(50);
  });

  it('salvages a string-encoded scores payload (provider stringified the JSON)', async () => {
    // Variant: the model returned the criteria as a JSON *string* inside the
    // schema's `scores` field, e.g. {"scores":"{\"scores\":{...}}"}.
    const innerJson = JSON.stringify({
      scores: {
        accuracy: { score: 2, rationale: 'partial' },
        clarity: { score: 3, rationale: 'okay' },
      },
    });
    const err = new NoObjectGeneratedError({
      message: 'schema validation failed',
      text: JSON.stringify({ scores: innerJson }),
      response: {} as never,
      usage: { inputTokens: 80, outputTokens: 15 } as never,
      finishReason: 'stop',
    });
    mockGenerateObject.mockRejectedValueOnce(err);

    const result = await judgeTrajectory(baseOpts());

    expect(result.error).toBeUndefined();
    expect(result.scores.accuracy.score).toBe(2);
    expect(result.scores.clarity.score).toBe(3);
    // Salvaged on the first attempt — no retry needed.
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it('does NOT unwrap a legitimate criterion literally named "scores"', async () => {
    // Guard against over-eager salvage: a single-nested object whose inner
    // `scores` is a leaf {score,rationale} must not be treated as double-nested.
    // Both the initial attempt and the retry return the same unsalvageable text.
    const err = new NoObjectGeneratedError({
      message: 'schema validation failed',
      text: JSON.stringify({
        scores: { scores: { score: 3, rationale: 'x' } },
      }),
      response: {} as never,
      usage: { inputTokens: 10, outputTokens: 5 } as never,
      finishReason: 'stop',
    });
    mockGenerateObject.mockRejectedValue(err);

    const result = await judgeTrajectory(baseOpts());

    // Not salvageable into the rubric's criteria → surfaces the schema error.
    expect(result.error).toMatch(/did not match the expected schema/);
  });
});
