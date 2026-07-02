import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { GradeRecord } from '@/grading/types';
import type { RunRecord } from '@/harness/types';
import type { BatchSummary } from '@/reports/aggregate';
import { writeBatchSummary } from '@/reports/store';

function buildRun(plugin: string): RunRecord {
  return {
    schemaVersion: 1,
    runId: `run-${plugin}-0`,
    scenario: 'error-root-cause',
    mcp: 'hyperdx',
    model: 'claude-sonnet-4-6',
    plugin,
    runIndex: 0,
    seed: 42,
    startedAt: '2026-07-02T00:00:00.000Z',
    endedAt: '2026-07-02T00:01:00.000Z',
    durationMs: 60_000,
    agentPrompt: 'p',
    systemPromptAppend: 's',
    termination: 'final_answer',
    exitCode: 0,
    tools: [],
    toolCalls: [],
    messages: [],
    finalAnswer: 'a',
    tokens: { input: 100, output: 1000, cacheCreation: 0, cacheRead: 0 },
    totalCostUsd: 0.01,
    stderr: '',
  };
}

function buildGrade(run: RunRecord, combined: number): GradeRecord {
  return {
    schemaVersion: 2,
    runId: run.runId,
    scenario: run.scenario,
    mcp: run.mcp,
    programmatic: {
      hits: [{ id: 'check-a', weight: 1, matched: true, satisfied: true }],
      score: combined,
    },
    judge: {
      model: 'claude-opus-4-7',
      scores: { correctness: { score: 5, rationale: '' } },
      weightedScore: combined,
      rawResponse: '',
      durationMs: 1000,
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    },
    toolErrors: { total: 0, errors: 0, rate: 0, penalty: 0, samples: [] },
    combinedScore: combined,
    gradedAt: '',
    judgeModel: 'claude-opus-4-7',
  };
}

describe('writeBatchSummary over a plugin-arm batch', () => {
  const tmpRoot = join('/tmp', `hdx-eval-reports-store-test-${Date.now()}`);
  const batchDir = join(tmpRoot, 'batch');

  beforeAll(() => {
    // Current layout: <scenario>/<mcp>/<model>/<plugin>/<index>.json with a
    // .grade.json sidecar next to each run.
    for (const [plugin, combined] of [
      ['none', 0.8],
      ['myplugin', 0.9],
    ] as const) {
      const dir = join(
        batchDir,
        'error-root-cause',
        'hyperdx',
        'claude-sonnet-4-6',
        plugin,
      );
      mkdirSync(dir, { recursive: true });
      const run = buildRun(plugin);
      writeFileSync(join(dir, '0.json'), JSON.stringify(run, null, 2));
      writeFileSync(
        join(dir, '0.grade.json'),
        JSON.stringify(buildGrade(run, combined), null, 2),
      );
    }
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('aggregates plugin arms into plugin-keyed columns', () => {
    const outPath = join(batchDir, '_summary.md');
    const result = writeBatchSummary(batchDir, outPath);
    expect(result.pairsCount).toBe(2);

    const summary = JSON.parse(
      readFileSync(result.jsonPath, 'utf8'),
    ) as BatchSummary;
    expect(summary.multiModel).toBe(false);
    expect(summary.multiPlugin).toBe(true);
    expect(summary.columnOrder).toEqual(['hyperdx/myplugin', 'hyperdx/none']);
    // Default baseline: first column.
    expect(summary.baseline).toBe('hyperdx/myplugin');

    const scenario = summary.scenarios[0];
    expect(scenario.cells['hyperdx/none'].plugin).toBe('none');
    expect(scenario.cells['hyperdx/myplugin'].plugin).toBe('myplugin');
    // Delta = challenger (none, 0.8) − baseline (myplugin, 0.9).
    expect(scenario.deltas['hyperdx/none'].combinedScore).toBeCloseTo(-0.1, 5);

    const md = readFileSync(result.mdPath, 'utf8');
    expect(md).toContain('hyperdx/myplugin');
    expect(md).toContain('Δ (hyperdx/none)');
  });

  it('honors an explicit column-key baseline', () => {
    const outPath = join(batchDir, '_summary-explicit.md');
    const result = writeBatchSummary(batchDir, outPath, 'hyperdx/none');
    const summary = JSON.parse(
      readFileSync(result.jsonPath, 'utf8'),
    ) as BatchSummary;
    expect(summary.baseline).toBe('hyperdx/none');
    expect(
      summary.scenarios[0].deltas['hyperdx/myplugin'].combinedScore,
    ).toBeCloseTo(0.1, 5);
  });
});
