import type { GradeRecord } from '../grading/types';
import type { RunRecord } from '../harness/types';
import { buildAggregate, type GradedRunPair } from '../reports/aggregate';

function pair(args: {
  scenario: string;
  mcp: string;
  i: number;
  programmaticScore: number;
  judgeScore: number;
  toolCalls: number;
  outputTokens: number;
  durationMs: number;
}): GradedRunPair {
  const run: RunRecord = {
    schemaVersion: 1,
    runId: `${args.scenario}-${args.mcp}-${args.i}`,
    scenario: args.scenario,
    mcp: args.mcp,
    model: 'claude-sonnet-4-6',
    runIndex: args.i,
    seed: 42,
    startedAt: '2026-05-09T07:50:00.000Z',
    endedAt: '2026-05-09T07:51:00.000Z',
    durationMs: args.durationMs,
    agentPrompt: 'p',
    systemPromptAppend: 's',
    termination: 'final_answer',
    exitCode: 0,
    tools: [],
    toolCalls: Array.from({ length: args.toolCalls }, (_, k) => ({
      name: `t${k}`,
      input: null,
      output: null,
      isError: false,
      startedAt: '',
      endedAt: null,
      durationMs: null,
    })),
    messages: [],
    finalAnswer: 'a',
    tokens: {
      input: 100,
      output: args.outputTokens,
      cacheCreation: 0,
      cacheRead: 0,
    },
    totalCostUsd: 0.01,
    stderr: '',
  };
  const grade: GradeRecord = {
    schemaVersion: 2,
    runId: run.runId,
    scenario: run.scenario,
    mcp: run.mcp,
    programmatic: {
      hits: [
        {
          id: 'check-a',
          weight: 1,
          matched: args.programmaticScore >= 0.5,
          satisfied: args.programmaticScore >= 0.5,
        },
        {
          id: 'check-b',
          weight: 1,
          matched: args.programmaticScore >= 1,
          satisfied: args.programmaticScore >= 1,
        },
      ],
      score: args.programmaticScore,
    },
    judge: {
      model: 'claude-opus-4-7',
      scores: {
        correctness: { score: Math.round(args.judgeScore * 5), rationale: '' },
      },
      weightedScore: args.judgeScore,
      rawResponse: '',
      durationMs: 1000,
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    },
    toolErrors: {
      total: args.toolCalls,
      errors: 0,
      rate: 0,
      penalty: 0,
      samples: [],
    },
    combinedScore: 0.4 * args.programmaticScore + 0.6 * args.judgeScore,
    gradedAt: '',
    judgeModel: 'claude-opus-4-7',
  };
  return { run, grade };
}

describe('buildAggregate', () => {
  it('groups by scenario and computes per-cell means with baseline delta', () => {
    const pairs: GradedRunPair[] = [
      pair({
        scenario: 'error-root-cause',
        mcp: 'clickhouse',
        i: 0,
        programmaticScore: 1,
        judgeScore: 1,
        toolCalls: 7,
        outputTokens: 1500,
        durationMs: 30_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 0,
        programmaticScore: 1,
        judgeScore: 0.9,
        toolCalls: 13,
        outputTokens: 4000,
        durationMs: 60_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 1,
        programmaticScore: 0.8,
        judgeScore: 0.8,
        toolCalls: 11,
        outputTokens: 3500,
        durationMs: 50_000,
      }),
    ];
    // Baseline defaults to first column alphabetically: 'clickhouse'.
    const summary = buildAggregate({ batchDir: '/tmp/x', pairs });
    expect(summary.scenarios).toHaveLength(1);
    expect(summary.baseline).toBe('clickhouse');
    expect(summary.columnOrder).toEqual(['clickhouse', 'hyperdx']);
    // Deprecated alias:
    expect(summary.mcpOrder).toEqual(['clickhouse', 'hyperdx']);
    expect(summary.multiModel).toBe(false);
    const sc = summary.scenarios[0];
    const h = sc.cells['hyperdx']!;
    const c = sc.cells['clickhouse']!;
    expect(h.n).toBe(2);
    expect(c.n).toBe(1);
    expect(h.toolCalls.mean).toBeCloseTo(12, 5);
    expect(c.toolCalls.mean).toBeCloseTo(7, 5);
    expect(h.programmatic.mean).toBeCloseTo(0.9, 5);
    expect(h.judge.weightedMean).toBeCloseTo(0.85, 5);
    expect(h.combinedScore.mean).toBeCloseTo(0.87, 5);
    // Delta is hyperdx (challenger) - clickhouse (baseline)
    expect(sc.deltas['hyperdx'].toolCalls).toBeCloseTo(5, 5);
    expect(sc.deltas['hyperdx'].combinedScore!).toBeCloseTo(-0.13, 5);
    // No delta for baseline itself
    expect(sc.deltas['clickhouse']).toBeUndefined();
  });

  it('supports explicit baseline selection', () => {
    const pairs: GradedRunPair[] = [
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 0,
        programmaticScore: 1,
        judgeScore: 0.9,
        toolCalls: 13,
        outputTokens: 4000,
        durationMs: 60_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'clickhouse',
        i: 0,
        programmaticScore: 1,
        judgeScore: 1,
        toolCalls: 7,
        outputTokens: 1500,
        durationMs: 30_000,
      }),
    ];
    const summary = buildAggregate({
      batchDir: '/tmp/x',
      pairs,
      baseline: 'hyperdx',
    });
    expect(summary.baseline).toBe('hyperdx');
    const sc = summary.scenarios[0];
    // Delta should be clickhouse (challenger) - hyperdx (baseline)
    expect(sc.deltas['clickhouse']).toBeDefined();
    expect(sc.deltas['hyperdx']).toBeUndefined();
  });

  it('produces an ordered, multi-scenario summary', () => {
    const pairs: GradedRunPair[] = [
      pair({
        scenario: 'noisy-signals',
        mcp: 'hyperdx',
        i: 0,
        programmaticScore: 1,
        judgeScore: 1,
        toolCalls: 9,
        outputTokens: 3200,
        durationMs: 50_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 0,
        programmaticScore: 1,
        judgeScore: 1,
        toolCalls: 13,
        outputTokens: 4000,
        durationMs: 60_000,
      }),
    ];
    const summary = buildAggregate({ batchDir: '/tmp/x', pairs });
    expect(summary.scenarios.map(s => s.scenario)).toEqual([
      'error-root-cause',
      'noisy-signals',
    ]);
  });

  it('handles 3+ MCPs with baseline + challengers model', () => {
    const pairs: GradedRunPair[] = [
      pair({
        scenario: 'error-root-cause',
        mcp: 'alpha',
        i: 0,
        programmaticScore: 0.8,
        judgeScore: 0.8,
        toolCalls: 10,
        outputTokens: 3000,
        durationMs: 40_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'beta',
        i: 0,
        programmaticScore: 0.9,
        judgeScore: 0.9,
        toolCalls: 12,
        outputTokens: 3500,
        durationMs: 50_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'gamma',
        i: 0,
        programmaticScore: 1,
        judgeScore: 1,
        toolCalls: 8,
        outputTokens: 2000,
        durationMs: 25_000,
      }),
    ];
    const summary = buildAggregate({
      batchDir: '/tmp/x',
      pairs,
      baseline: 'alpha',
    });
    expect(summary.columnOrder).toEqual(['alpha', 'beta', 'gamma']);
    expect(summary.mcpOrder).toEqual(['alpha', 'beta', 'gamma']);
    const sc = summary.scenarios[0];
    // Challengers: beta and gamma
    expect(sc.deltas['alpha']).toBeUndefined();
    expect(sc.deltas['beta']).toBeDefined();
    expect(sc.deltas['gamma']).toBeDefined();
    expect(sc.deltas['gamma'].toolCalls).toBeCloseTo(-2, 5);
  });

  it('groups by (mcp, model) when multiple models are present', () => {
    const pairs: GradedRunPair[] = [
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 0,
        programmaticScore: 1,
        judgeScore: 0.9,
        toolCalls: 13,
        outputTokens: 4000,
        durationMs: 60_000,
      }),
      pair({
        scenario: 'error-root-cause',
        mcp: 'hyperdx',
        i: 1,
        programmaticScore: 0.8,
        judgeScore: 0.8,
        toolCalls: 11,
        outputTokens: 3500,
        durationMs: 50_000,
      }),
    ];
    // Change the model on the second pair to trigger multi-model grouping.
    pairs[1].run.model = 'claude-haiku-4-5';
    const summary = buildAggregate({ batchDir: '/tmp/x', pairs });
    expect(summary.multiModel).toBe(true);
    expect(summary.columnOrder).toEqual([
      'hyperdx/claude-haiku-4-5',
      'hyperdx/claude-sonnet-4-6',
    ]);
    const sc = summary.scenarios[0];
    expect(sc.cells['hyperdx/claude-sonnet-4-6']).toBeDefined();
    expect(sc.cells['hyperdx/claude-haiku-4-5']).toBeDefined();
    // Each cell should have n=1
    expect(sc.cells['hyperdx/claude-sonnet-4-6'].n).toBe(1);
    expect(sc.cells['hyperdx/claude-haiku-4-5'].n).toBe(1);
    // Deltas: challenger vs baseline (first alphabetically)
    expect(sc.deltas['hyperdx/claude-sonnet-4-6']?.combinedScore).toBeDefined();
  });
});
