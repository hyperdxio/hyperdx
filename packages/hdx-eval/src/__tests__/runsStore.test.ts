import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import type { RunRecord } from '@/harness/types';
import { runsRoot } from '@/runs/path';
import { listRunsInBatch, writeRun } from '@/runs/store';

function buildRun(plugin: string, runIndex: number): RunRecord {
  return {
    schemaVersion: 1,
    runId: `run-${plugin}-${runIndex}`,
    scenario: 'error-root-cause',
    mcp: 'hyperdx',
    model: 'claude-sonnet-4-6',
    plugin,
    runIndex,
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
    tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    totalCostUsd: 0,
    stderr: '',
  };
}

describe('writeRun / listRunsInBatch round-trip', () => {
  const batch = `test-batch-runs-store-${Date.now()}`;

  afterAll(() => {
    rmSync(join(runsRoot(), batch), { recursive: true, force: true });
  });

  it('writes every arm under <model>/<plugin>/ and lists them back', () => {
    const nonePath = writeRun({ record: buildRun('none', 0), batchDir: batch });
    const pluginPath = writeRun({
      record: buildRun('myplugin', 0),
      batchDir: batch,
    });

    // Model and plugin each get a directory level; the no-plugin arm lives
    // under the literal `none` directory.
    expect(nonePath).toContain(join('claude-sonnet-4-6', 'none', '0.json'));
    expect(pluginPath).toContain(
      join('claude-sonnet-4-6', 'myplugin', '0.json'),
    );
    expect(existsSync(nonePath)).toBe(true);
    expect(existsSync(pluginPath)).toBe(true);

    // The batch walker finds exactly what the writer produced.
    expect(listRunsInBatch(batch).sort()).toEqual(
      [nonePath, pluginPath].sort(),
    );
  });
});
