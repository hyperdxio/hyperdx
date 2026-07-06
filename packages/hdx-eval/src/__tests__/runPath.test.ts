import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getRunFilesInBatch, runFilePath, runsRoot } from '@/runs/path';

describe('runFilePath', () => {
  it('always includes a plugin directory level, using "none" for the no-plugin arm', () => {
    const p = runFilePath({
      batchDir: 'batch',
      scenario: 'error-root-cause',
      mcp: 'hyperdx',
      model: 'claude-sonnet-4-6',
      plugin: 'none',
      runIndex: 0,
    });
    expect(p).toBe(
      join(
        runsRoot(),
        'batch',
        'error-root-cause',
        'hyperdx',
        'claude-sonnet-4-6',
        'none',
        '0.json',
      ),
    );
  });

  it('defaults an omitted plugin to the "none" directory', () => {
    const p = runFilePath({
      batchDir: 'batch',
      scenario: 'error-root-cause',
      mcp: 'hyperdx',
      model: 'claude-sonnet-4-6',
      runIndex: 1,
    });
    expect(p).toContain(join('claude-sonnet-4-6', 'none', '1.json'));
  });

  it('sanitizes model and plugin segments the same way', () => {
    const p = runFilePath({
      batchDir: 'batch',
      scenario: 'error-root-cause',
      mcp: 'hyperdx',
      model: 'claude-sonnet-4.5',
      plugin: 'my.plugin',
      runIndex: 2,
    });
    expect(p).toContain(join('claude-sonnet-4-5', 'my-plugin', '2.json'));
  });
});

describe('getRunFilesInBatch', () => {
  const tmpRoot = join('/tmp', `hdx-eval-run-path-test-${Date.now()}`);
  const batchDir = join(tmpRoot, 'batch');
  const mcpDir = join(batchDir, 'error-root-cause', 'hyperdx');
  const modelDir = join(mcpDir, 'claude-sonnet-4-6');

  beforeAll(() => {
    mkdirSync(join(modelDir, 'none'), { recursive: true });
    mkdirSync(join(modelDir, 'myplugin'), { recursive: true });
    // Current layout: per-plugin subdirs, no-plugin arm under none/.
    writeFileSync(join(modelDir, 'none', '0.json'), '{}');
    writeFileSync(join(modelDir, 'myplugin', '1.json'), '{}');
    // Legacy layout: run directly in the model dir (pre-plugin-level).
    writeFileSync(join(modelDir, '2.json'), '{}');
    // Legacy layout: run directly in the mcp dir (pre-multi-model).
    writeFileSync(join(mcpDir, '3.json'), '{}');
    // Sidecars — excluded everywhere.
    writeFileSync(join(modelDir, 'none', '0.grade.json'), '{}');
    writeFileSync(join(modelDir, '2.timing.json'), '{}');
    // A second scenario, for scenarioFilter.
    const otherDir = join(
      batchDir,
      'latency-spike',
      'hyperdx',
      'model',
      'none',
    );
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, '0.json'), '{}');
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('collects runs from the current layout and both legacy layouts, skipping sidecars', () => {
    const files = getRunFilesInBatch(batchDir);
    expect(files).toEqual(
      [
        join(modelDir, 'none', '0.json'),
        join(modelDir, 'myplugin', '1.json'),
        join(modelDir, '2.json'),
        join(mcpDir, '3.json'),
        join(batchDir, 'latency-spike', 'hyperdx', 'model', 'none', '0.json'),
      ].sort(),
    );
  });

  it('restricts walking to scenarios matching scenarioFilter', () => {
    const files = getRunFilesInBatch(batchDir, {
      scenarioFilter: s => s === 'latency-spike',
    });
    expect(files).toEqual([
      join(batchDir, 'latency-spike', 'hyperdx', 'model', 'none', '0.json'),
    ]);
  });

  it('returns [] for a missing batch directory', () => {
    expect(getRunFilesInBatch(join(tmpRoot, 'does-not-exist'))).toEqual([]);
  });
});
