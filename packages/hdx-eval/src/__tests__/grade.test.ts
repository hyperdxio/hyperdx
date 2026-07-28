/**
 * Tests for the tool-error penalty applied by gradeBatch. We can't easily
 * test the full pipeline (it touches the LLM judge), so instead these tests
 * cover the pure computeToolErrorStats helper by re-implementing the call
 * pattern: build a synthetic RunRecord, write it to a temp batch dir, run
 * gradeBatch with --no-judge, and read back the grade JSON.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { gradeBatch } from '@/grading/grade';
import type { GradeRecord } from '@/grading/types';
import type { RunRecord } from '@/harness/types';

function buildRun(args: {
  scenario: string;
  toolCalls: Array<{
    name: string;
    isError: boolean;
    output?: string;
    input?: unknown;
  }>;
  finalAnswer: string;
}): RunRecord {
  return {
    schemaVersion: 1,
    runId: `${args.scenario}-test-0`,
    scenario: args.scenario,
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
    toolCalls: args.toolCalls.map(c => ({
      name: c.name,
      input: c.input ?? null,
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
  mcp: string,
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

  it('grades runs stored in the current <mcp>/<model>/<plugin>/ layout', async () => {
    const batchDir = join(tmpRoot, 'plugin-layout');
    const run = buildRun({
      scenario: 'error-root-cause',
      toolCalls: [{ name: 'mcp__hyperdx__hyperdx_query', isError: false }],
      finalAnswer: ANSWER,
    });
    run.plugin = 'myplugin';
    const dir = join(
      batchDir,
      'error-root-cause',
      'hyperdx',
      'claude-sonnet-4-6',
      'myplugin',
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0.json'), JSON.stringify(run, null, 2));

    const result = await gradeBatch(batchDir, { skipJudge: true });
    expect(result.errors).toHaveLength(0);
    expect(result.graded).toHaveLength(1);
    expect(result.graded[0].programmatic.score).toBeCloseTo(1, 5);
    // The grade sidecar lands next to the run file, inside the plugin dir.
    const sidecar = JSON.parse(
      readFileSync(join(dir, '0.grade.json'), 'utf8'),
    ) as { runId: string };
    expect(sidecar.runId).toBe(run.runId);
  });

  it('labels log lines with the plugin column key when plugin arms vary', async () => {
    const batchDir = join(tmpRoot, 'plugin-arm-labels');
    for (const plugin of ['none', 'myplugin']) {
      const run = buildRun({
        scenario: 'error-root-cause',
        toolCalls: [{ name: 'mcp__hyperdx__hyperdx_query', isError: false }],
        finalAnswer: ANSWER,
      });
      run.plugin = plugin;
      const dir = join(
        batchDir,
        'error-root-cause',
        'hyperdx',
        'claude-sonnet-4-6',
        plugin,
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '0.json'), JSON.stringify(run, null, 2));
    }

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[] = [];
    try {
      await gradeBatch(batchDir, { skipJudge: true });
      lines = logSpy.mock.calls.map(c => String(c[0]));
    } finally {
      logSpy.mockRestore();
    }
    expect(lines.some(l => l.includes('error-root-cause/hyperdx/none/0'))).toBe(
      true,
    );
    expect(
      lines.some(l => l.includes('error-root-cause/hyperdx/myplugin/0')),
    ).toBe(true);
  });
});

describe('gradeBatch transcript-aware adoption checks', () => {
  const tmpRoot = join('/tmp', `hdx-eval-adoption-test-${Date.now()}`);

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('populates the adoption block from the tool-call transcript', async () => {
    const batchDir = join(tmpRoot, 'adopted');
    writeBatch(
      batchDir,
      'metric-saturation',
      'hyperdx',
      buildRun({
        scenario: 'metric-saturation',
        toolCalls: [
          {
            name: 'mcp__hyperdx__clickstack_list_metrics',
            isError: false,
            input: { sourceId: 's1' },
          },
          {
            name: 'mcp__hyperdx__clickstack_describe_metric',
            isError: false,
            input: { name: 'process.runtime.jvm.memory.used' },
          },
          {
            name: 'mcp__hyperdx__clickstack_describe_metric',
            isError: false,
            input: { name: 'process.runtime.jvm.gc.pause' },
          },
          {
            name: 'mcp__hyperdx__clickstack_timeseries',
            isError: false,
            input: {
              metricType: 'gauge',
              metric: 'process.runtime.jvm.memory.used',
              groupBy: ['k8s.pod.name', 'jvm.memory.pool.name'],
            },
          },
        ],
        finalAnswer: 'JVM heap leak on recommendation-service.',
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    const grade: GradeRecord = result.graded[0];
    // All four transcript checks hit (used a metric tool, described the JVM
    // memory metric, described the GC-pause metric, grouped memory by
    // pod/pool).
    expect(grade.adoption).toBeDefined();
    expect(grade.adoption!.score).toBeCloseTo(1, 5);
    expect(grade.adoption!.hits.every(h => h.satisfied)).toBe(true);
  });

  it('scores zero adoption when no metric tools were used, without touching combinedScore', async () => {
    const batchDir = join(tmpRoot, 'not-adopted');
    writeBatch(
      batchDir,
      'metric-saturation',
      'hyperdx',
      buildRun({
        scenario: 'metric-saturation',
        toolCalls: [
          {
            name: 'mcp__hyperdx__clickstack_sql',
            isError: false,
            input: { sql: 'SELECT * FROM eval_metric-saturation_otel_traces' },
          },
        ],
        finalAnswer: 'JVM heap leak on recommendation-service.',
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    const grade = result.graded[0];
    expect(grade.adoption).toBeDefined();
    expect(grade.adoption!.score).toBe(0);
    // Adoption is an independent signal: combinedScore tracks the outcome
    // (programmatic, no judge, no tool errors) and ignores adoption entirely.
    expect(grade.combinedScore).toBeCloseTo(grade.programmatic.score, 5);
  });

  it('adoption does NOT inflate combinedScore even at full adoption', async () => {
    const batchDir = join(tmpRoot, 'adopt-vs-combined');
    writeBatch(
      batchDir,
      'metric-saturation',
      'hyperdx',
      buildRun({
        scenario: 'metric-saturation',
        toolCalls: [
          {
            name: 'mcp__hyperdx__clickstack_describe_metric',
            isError: false,
            input: { name: 'process.runtime.jvm.memory.used' },
          },
          {
            name: 'mcp__hyperdx__clickstack_describe_metric',
            isError: false,
            input: { name: 'process.runtime.jvm.gc.pause' },
          },
        ],
        // Intentionally weak answer: adoption is high but the outcome score is
        // low, proving the two axes are decoupled.
        finalAnswer: 'Something is wrong somewhere.',
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    const grade = result.graded[0];
    expect(grade.adoption!.score).toBeGreaterThan(0);
    expect(grade.combinedScore).toBeCloseTo(grade.programmatic.score, 5);
    expect(grade.combinedScore).toBeLessThan(grade.adoption!.score);
  });

  it('omits the adoption block for scenarios without a transcript rubric', async () => {
    const batchDir = join(tmpRoot, 'no-transcript-rubric');
    writeBatch(
      batchDir,
      'error-root-cause',
      'hyperdx',
      buildRun({
        scenario: 'error-root-cause',
        toolCalls: [{ name: 'mcp__hyperdx__hyperdx_query', isError: false }],
        finalAnswer: 'Root cause: payment-service connection timeout.',
      }),
    );
    const result = await gradeBatch(batchDir, { skipJudge: true });
    expect(result.graded[0].adoption).toBeUndefined();
  });
});
