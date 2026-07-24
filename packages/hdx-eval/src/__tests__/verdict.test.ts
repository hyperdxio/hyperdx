import type { GradeRecord } from '@/grading/types';
import type { RunRecord, Termination } from '@/harness/types';
import { buildAggregate, type GradedRunPair } from '@/reports/aggregate';
import { computeVerdict, renderVerdictComment } from '@/reports/verdict';

function pair(
  scenario: string,
  mcp: string,
  i: number,
  termination: Termination = 'final_answer',
): GradedRunPair {
  const run: RunRecord = {
    schemaVersion: 1,
    runId: `${scenario}-${mcp}-none-${i}`,
    scenario,
    mcp,
    model: 'claude-opus-4-6',
    plugin: 'none',
    runIndex: i,
    seed: 42,
    startedAt: '2026-05-09T07:50:00.000Z',
    endedAt: '2026-05-09T07:51:00.000Z',
    durationMs: 60_000,
    agentPrompt: 'p',
    systemPromptAppend: 's',
    termination,
    exitCode: 0,
    tools: [],
    toolCalls: [],
    messages: [],
    finalAnswer: 'a',
    tokens: { input: 50, output: 1000, cacheCreation: 0, cacheRead: 5000 },
    totalCostUsd: 0.01,
    stderr: '',
  };
  const grade: GradeRecord = {
    schemaVersion: 2,
    runId: run.runId,
    scenario,
    mcp,
    programmatic: { hits: [], score: 0.5 },
    judge: null,
    toolErrors: { total: 0, errors: 0, rate: 0, penalty: 0, samples: [] },
    combinedScore: 0.5,
    gradedAt: '',
    judgeModel: 'claude-opus-4-7',
  };
  return { run, grade };
}

describe('computeVerdict (M1 completion-only)', () => {
  it('passes when at least one run reached a final answer', () => {
    const summary = buildAggregate({
      batchDir: '/tmp/2026-05-09T07-50-58-566Z',
      pairs: [pair('latency-spike', 'hyperdx', 0, 'final_answer')],
    });
    const v = computeVerdict(summary);
    expect(v.pass).toBe(true);
    expect(v.totalRuns).toBe(1);
    expect(v.completedRuns).toBe(1);
    expect(v.scenarios).toHaveLength(1);
    expect(v.scenarios[0].scenario).toBe('latency-spike');
    expect(v.scenarios[0].completed).toBe(1);
  });

  it('fails when no run reached a final answer', () => {
    const summary = buildAggregate({
      batchDir: '/tmp/b',
      pairs: [
        pair('latency-spike', 'hyperdx', 0, 'timeout'),
        pair('latency-spike', 'hyperdx', 1, 'max_turns'),
      ],
    });
    const v = computeVerdict(summary);
    expect(v.pass).toBe(false);
    expect(v.totalRuns).toBe(2);
    expect(v.completedRuns).toBe(0);
    expect(v.reason).toMatch(/no run reached a final answer/i);
  });

  it('fails when there are no graded runs at all', () => {
    const summary = buildAggregate({ batchDir: '/tmp/empty', pairs: [] });
    const v = computeVerdict(summary);
    expect(v.pass).toBe(false);
    expect(v.totalRuns).toBe(0);
    expect(v.reason).toMatch(/did not complete/i);
  });

  it('counts completion per scenario across mixed terminations', () => {
    const summary = buildAggregate({
      batchDir: '/tmp/mixed',
      pairs: [
        pair('latency-spike', 'hyperdx', 0, 'final_answer'),
        pair('latency-spike', 'hyperdx', 1, 'timeout'),
      ],
    });
    const v = computeVerdict(summary);
    expect(v.pass).toBe(true);
    expect(v.scenarios[0].runs).toBe(2);
    expect(v.scenarios[0].completed).toBe(1);
  });
});

describe('renderVerdictComment', () => {
  const summary = buildAggregate({
    batchDir: '/tmp/2026-05-09T07-50-58-566Z',
    pairs: [pair('latency-spike', 'hyperdx', 0, 'final_answer')],
  });

  it('includes the stable marker so CI can update in place', () => {
    const md = renderVerdictComment(computeVerdict(summary));
    expect(md).toContain('<!-- hdx-eval-verdict -->');
  });

  it('renders a PASS badge and advisory note', () => {
    const md = renderVerdictComment(computeVerdict(summary));
    expect(md).toContain('✅ PASS');
    expect(md).toMatch(/advisory only/i);
    expect(md).toContain('does not block merges');
  });

  it('renders a FAIL badge when the verdict fails', () => {
    const failing = buildAggregate({
      batchDir: '/tmp/b',
      pairs: [pair('latency-spike', 'hyperdx', 0, 'error')],
    });
    const md = renderVerdictComment(computeVerdict(failing));
    expect(md).toContain('❌ FAIL');
  });

  it('includes optional run URL and commit metadata', () => {
    const md = renderVerdictComment(computeVerdict(summary), {
      runUrl: 'https://github.com/o/r/actions/runs/1',
      commitSha: 'abcdef1234567890',
    });
    expect(md).toContain('https://github.com/o/r/actions/runs/1');
    expect(md).toContain('abcdef1');
  });
});
