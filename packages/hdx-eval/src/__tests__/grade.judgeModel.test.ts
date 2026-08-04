/**
 * Verifies that gradeBatch records the fully-qualified `provider:model` judge
 * spec on the GradeRecord and threads the resolved spec into judgeTrajectory.
 * The judge module is mocked so no provider credentials or network are needed.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/grading/judge', () => ({
  judgeTrajectory: jest.fn(),
}));

import { gradeBatch } from '@/grading/grade';
import { judgeTrajectory } from '@/grading/judge';
import type { JudgeResult } from '@/grading/types';
import type { RunRecord } from '@/harness/types';

const mockJudge = judgeTrajectory as jest.MockedFunction<
  typeof judgeTrajectory
>;

const ANSWER =
  'Root cause: payment-service ConnectionTimeoutError on db.payment.connect ' +
  'reaching db-payment.internal — DB connection timeout — cascading into ' +
  'checkout-api 5xx errors. Ruled out concurrent SMTP and CDN bursts ' +
  '(separate trace trees, no checkout parent).';

function buildRun(): RunRecord {
  return {
    schemaVersion: 1,
    runId: 'error-root-cause-test-0',
    scenario: 'error-root-cause',
    mcp: 'hyperdx',
    model: 'claude-sonnet-4-6',
    plugin: 'none',
    runIndex: 0,
    seed: 42,
    startedAt: '2026-05-10T00:00:00.000Z',
    endedAt: '2026-05-10T00:01:00.000Z',
    durationMs: 60_000,
    agentPrompt: 'p',
    systemPromptAppend: 's',
    termination: 'final_answer',
    exitCode: 0,
    tools: [],
    toolCalls: [
      {
        name: 'mcp__hyperdx__hyperdx_query',
        input: null,
        output: null,
        isError: false,
        startedAt: '',
        endedAt: null,
        durationMs: null,
      },
    ],
    messages: [],
    finalAnswer: ANSWER,
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    totalCostUsd: 0,
    stderr: '',
  };
}

function writeBatch(batchDir: string): void {
  const dir = join(batchDir, 'error-root-cause', 'hyperdx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '0.json'), JSON.stringify(buildRun(), null, 2));
}

function fakeJudgeResult(model: string): JudgeResult {
  return {
    model,
    scores: {},
    weightedScore: 0.5,
    rawResponse: '{}',
    durationMs: 1,
    tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
  };
}

describe('gradeBatch judge model spec', () => {
  const tmpRoot = join('/tmp', `hdx-eval-judge-model-test-${Date.now()}`);
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ['AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      savedEnv[k] = process.env[k];
    }
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockJudge.mockReset();
  });

  it('threads the resolved spec to the judge and records it', async () => {
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    delete process.env.AI_API_KEY;
    const batchDir = join(tmpRoot, 'openai');
    writeBatch(batchDir);

    // The judge echoes back the spec it was called with.
    mockJudge.mockImplementation(async opts =>
      fakeJudgeResult(opts.judgeModel as string),
    );

    const result = await gradeBatch(batchDir, { judgeModel: 'openai:gpt-4o' });

    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(mockJudge.mock.calls[0][0].judgeModel).toBe('openai:gpt-4o');
    expect(result.graded[0].judgeModel).toBe('openai:gpt-4o');
    expect(result.graded[0].judge?.model).toBe('openai:gpt-4o');
  });

  it('normalizes a bare model name to the anthropic provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const batchDir = join(tmpRoot, 'anthropic-bare');
    writeBatch(batchDir);

    mockJudge.mockImplementation(async opts =>
      fakeJudgeResult(opts.judgeModel as string),
    );

    const result = await gradeBatch(batchDir, {
      judgeModel: 'claude-opus-4-7',
    });

    expect(mockJudge.mock.calls[0][0].judgeModel).toBe(
      'anthropic:claude-opus-4-7',
    );
    expect(result.graded[0].judgeModel).toBe('anthropic:claude-opus-4-7');
  });

  it('throws a provider-aware error when the grader key is missing', async () => {
    delete process.env.AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const batchDir = join(tmpRoot, 'nokey');
    writeBatch(batchDir);

    await expect(
      gradeBatch(batchDir, { judgeModel: 'openai:gpt-4o' }),
    ).rejects.toThrow(/No API key set for the "openai" judge/);
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it('records "skipped" and never calls the judge with --no-judge', async () => {
    delete process.env.AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const batchDir = join(tmpRoot, 'skipped');
    writeBatch(batchDir);

    const result = await gradeBatch(batchDir, {
      judgeModel: 'openai:gpt-4o',
      skipJudge: true,
    });

    expect(mockJudge).not.toHaveBeenCalled();
    expect(result.graded[0].judge).toBeNull();
    expect(result.graded[0].judgeModel).toBe('skipped');
  });

  it('re-runs the judge when re-grading a batch with a DIFFERENT judge model', async () => {
    // Regression guard for the silent-skip bug: a cached grade from judge A
    // must NOT suppress judge B on a second pass. Without keying needsJudge /
    // the per-run guard on judge identity, pass B returns pass A's stale
    // scores relabeled — which would quietly corrupt an Opus-vs-GPT grader
    // comparison.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    delete process.env.AI_API_KEY;
    const batchDir = join(tmpRoot, 'judge-swap');
    writeBatch(batchDir);

    mockJudge.mockImplementation(async opts =>
      fakeJudgeResult(opts.judgeModel as string),
    );

    // Pass A — Anthropic judge.
    await gradeBatch(batchDir, { judgeModel: 'anthropic:claude-opus-4-7' });
    expect(mockJudge).toHaveBeenCalledTimes(1);

    // Pass B — different judge, NO --rerun-judge. Must re-run, not skip.
    mockJudge.mockClear();
    const passB = await gradeBatch(batchDir, {
      judgeModel: 'openai:gpt-5.6-sol',
    });

    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(mockJudge.mock.calls[0][0].judgeModel).toBe('openai:gpt-5.6-sol');
    expect(passB.graded[0].judgeModel).toBe('openai:gpt-5.6-sol');
    expect(passB.graded[0].judge?.model).toBe('openai:gpt-5.6-sol');

    // Sidecar now reflects judge B, not the stale judge A.
    const sidecar = JSON.parse(
      readFileSync(
        join(batchDir, 'error-root-cause', 'hyperdx', '0.grade.json'),
        'utf8',
      ),
    ) as { judgeModel: string };
    expect(sidecar.judgeModel).toBe('openai:gpt-5.6-sol');
  });

  it('does NOT re-run the judge when re-grading with the SAME judge model', async () => {
    // The other half of the identity check: an unchanged judge should still be
    // cached (no needless re-spend). Only --rerun-judge forces a refresh.
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    delete process.env.AI_API_KEY;
    const batchDir = join(tmpRoot, 'judge-same');
    writeBatch(batchDir);

    mockJudge.mockImplementation(async opts =>
      fakeJudgeResult(opts.judgeModel as string),
    );

    await gradeBatch(batchDir, { judgeModel: 'openai:gpt-5.6-sol' });
    expect(mockJudge).toHaveBeenCalledTimes(1);

    mockJudge.mockClear();
    await gradeBatch(batchDir, { judgeModel: 'openai:gpt-5.6-sol' });
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it('reuses the sidecar-persisted judgeModel spec when re-reading', async () => {
    process.env.OPENAI_API_KEY = 'sk-oai-test';
    delete process.env.AI_API_KEY;
    const batchDir = join(tmpRoot, 'persist');
    writeBatch(batchDir);

    mockJudge.mockImplementation(async opts =>
      fakeJudgeResult(opts.judgeModel as string),
    );

    await gradeBatch(batchDir, { judgeModel: 'openai:gpt-4o' });
    const sidecar = JSON.parse(
      readFileSync(
        join(batchDir, 'error-root-cause', 'hyperdx', '0.grade.json'),
        'utf8',
      ),
    ) as { judgeModel: string };
    expect(sidecar.judgeModel).toBe('openai:gpt-4o');
  });
});
