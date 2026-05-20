/**
 * Tests for the tool-error penalty applied by gradeBatch. We can't easily
 * test the full pipeline (it touches the LLM judge), so instead these tests
 * cover the pure computeToolErrorStats helper by re-implementing the call
 * pattern: build a synthetic RunRecord, write it to a temp batch dir, run
 * gradeBatch with --no-judge, and read back the grade JSON.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { gradeBatch } from '../grading/grade';
import type { GradeRecord } from '../grading/types';
import type { RunRecord } from '../harness/types';

function buildRun(args: {
  scenario: string;
  toolCalls: Array<{ name: string; isError: boolean; output?: string }>;
  finalAnswer: string;
}): RunRecord {
  return {
    schemaVersion: 1,
    runId: `${args.scenario}-test-0`,
    scenario: args.scenario,
    mcp: 'hyperdx',
    model: 'claude-sonnet-4-6',
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
    toolCalls: args.toolCalls.map(c => ({
      name: c.name,
      input: null,
      output: c.output ?? null,
      isError: c.isError,
      startedAt: '',
      endedAt: null,
      durationMs: null,
    })),
    messages: [],
    finalAnswer: args.finalAnswer,
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    totalCostUsd: 0,
    stderr: '',
  };
}

function writeBatch(
  batchDir: string,
  scenario: string,
  mcp: 'hyperdx' | 'clickhouse',
  run: RunRecord,
): void {
  const dir = join(batchDir, scenario, mcp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '0.json'), JSON.stringify(run, null, 2));
}

describe('gradeBatch tool-error penalty', () => {
  const tmpRoot = join('/tmp', `hdx-eval-grade-test-${Date.now()}`);
  // Answer that hits every positive check in the error-root-cause rubric:
  // service, error.type, full db hostname, specific db span, cascade name,
  // ruled-out distractor — without triggering any negative blame-pattern.
  const ANSWER =
    'Root cause: payment-service ConnectionTimeoutError on db.payment.connect ' +
    'reaching db-payment.internal — DB connection timeout — cascading into ' +
    'checkout-api 5xx errors. Ruled out concurrent SMTP and CDN bursts ' +
    '(separate trace trees, no checkout parent).';

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('records zero penalty when all tool calls succeeded', async () => {
    const batchDir = join(tmpRoot, 'ok');
    writeBatch(
      batchDir,
      'error-root-cause',
      'hyperdx',
      buildRun({
        scenario: 'error-root-cause',
        toolCalls: [
          { name: 'mcp__hyperdx__hyperdx_list_sources', isError: false },
          { name: 'mcp__hyperdx__hyperdx_query', isError: false },
        ],
        finalAnswer: ANSWER,
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    expect(result.graded).toHaveLength(1);
    const grade = result.graded[0];
    expect(grade.toolErrors.total).toBe(2);
    expect(grade.toolErrors.errors).toBe(0);
    expect(grade.toolErrors.rate).toBe(0);
    expect(grade.toolErrors.penalty).toBe(0);
  });

  it('penalizes runs where tool calls failed', async () => {
    const batchDir = join(tmpRoot, 'failed');
    writeBatch(
      batchDir,
      'error-root-cause',
      'hyperdx',
      buildRun({
        scenario: 'error-root-cause',
        toolCalls: [
          {
            name: 'mcp__hyperdx__hyperdx_list_sources',
            isError: true,
            output: 'Maximum call stack size exceeded',
          },
          {
            name: 'mcp__hyperdx__hyperdx_list_sources',
            isError: true,
            output: 'Maximum call stack size exceeded',
          },
          {
            name: 'mcp__hyperdx__hyperdx_query',
            isError: true,
            output: 'sourceId must be a 24-char hex ObjectId',
          },
          { name: 'mcp__hyperdx__hyperdx_query', isError: false },
        ],
        finalAnswer: ANSWER,
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    const grade = result.graded[0];
    expect(grade.toolErrors.total).toBe(4);
    expect(grade.toolErrors.errors).toBe(3);
    expect(grade.toolErrors.rate).toBeCloseTo(0.75, 5);
    // Penalty is capped at MAX_ERROR_PENALTY (0.2)
    expect(grade.toolErrors.penalty).toBeCloseTo(0.2, 5);
    expect(grade.toolErrors.samples).toHaveLength(3);
    expect(grade.toolErrors.samples[0].name).toMatch(/list_sources/);
  });

  it('subtracts the penalty from combinedScore (and clamps to [0,1])', async () => {
    const batchDir = join(tmpRoot, 'clamped');
    // Programmatic rubric will hit, but every tool call fails.
    writeBatch(
      batchDir,
      'error-root-cause',
      'hyperdx',
      buildRun({
        scenario: 'error-root-cause',
        toolCalls: Array.from({ length: 5 }, () => ({
          name: 'mcp__hyperdx__hyperdx_list_sources',
          isError: true,
          output: 'fail',
        })),
        finalAnswer: ANSWER,
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    const grade = result.graded[0];
    // Programmatic score = 1.0 (answer hits every positive check). Without
    // judge, raw combined is programmatic.score. Penalty is 0.2. Final:
    // 1.0 - 0.2 = 0.8.
    expect(grade.programmatic.score).toBeCloseTo(1, 5);
    expect(grade.combinedScore).toBeCloseTo(0.8, 5);
  });
});
