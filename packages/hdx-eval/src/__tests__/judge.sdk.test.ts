/**
 * Runs the judge against the real AI SDK with a mock model (judge.test.ts
 * mocks generateObject itself), so a broken option binding such as the
 * rubric not reaching the model as its system message fails here.
 */
import { MockLanguageModelV4 } from 'ai/test';

import { judgeTrajectory } from '@/grading/judge';
import type { Rubric } from '@/grading/types';

const RUBRIC: Rubric = {
  programmatic: [],
  judge: {
    criteria: [
      { id: 'accuracy', weight: 1, description: 'Is the answer correct?' },
    ],
  },
};

describe('judgeTrajectory with the real AI SDK', () => {
  it('sends the rubric to the model as the system message', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              scores: { accuracy: { score: 5, rationale: 'correct' } },
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 5,
            cacheRead: 3,
            cacheWrite: 2,
          },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const result = await judgeTrajectory({
      scenarioName: 'test-scenario',
      scenarioPrompt: 'Why did it break?',
      groundTruth: { rubric: RUBRIC },
      rubric: RUBRIC,
      finalAnswer: 'Because the database timed out.',
      model,
    });

    expect(result.error).toBeUndefined();
    expect(result.scores.accuracy.score).toBe(5);
    // Cost tracking depends on the v7 usage shape (inputTokenDetails).
    expect(result.tokens).toEqual({
      input: 10,
      output: 5,
      cacheCreation: 2,
      cacheRead: 3,
    });

    const [system, ...rest] = model.doGenerateCalls[0].prompt;
    expect(system.role).toBe('system');
    expect(system.content).toContain(
      '- "accuracy" (weight 1): Is the answer correct?',
    );
    expect(JSON.stringify(rest)).toContain('Because the database timed out.');
  });
});
