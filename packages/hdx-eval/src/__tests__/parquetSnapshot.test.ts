import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  manifestPath,
  readManifest,
  seedLogicHash,
  seedLogicHashShort,
  snapshotFileName,
  type SnapshotManifest,
  snapshotTableFields,
  writeManifest,
} from '@/clickhouse/parquetSnapshot';

describe('seedLogicHash', () => {
  it('is a stable 64-char hex sha256', () => {
    const h = seedLogicHash();
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls (content-based, not time-based)', () => {
    expect(seedLogicHash()).toBe(seedLogicHash());
  });

  it('short form is the 12-char prefix', () => {
    expect(seedLogicHashShort()).toBe(seedLogicHash().slice(0, 12));
    expect(seedLogicHashShort()).toHaveLength(12);
  });
});

describe('snapshot table fields', () => {
  it('covers the raw data tables and excludes rollups', () => {
    const fields = snapshotTableFields();
    expect(fields).toContain('traces');
    expect(fields).toContain('logs');
    expect(fields).toContain('metricsGauge');
    // Rollup tables must NOT be snapshotted — they repopulate via MVs on load.
    expect(fields).not.toContain('tracesKvRollup');
    expect(fields).not.toContain('tracesKeyRollup');
    expect(fields).not.toContain('logsKvRollup');
    expect(fields).not.toContain('logsKeyRollup');
  });
});

describe('snapshotFileName', () => {
  it('maps a table name to <table>.parquet', () => {
    expect(snapshotFileName('eval_latency_spike_otel_traces')).toBe(
      'eval_latency_spike_otel_traces.parquet',
    );
  });
});

describe('manifest round-trip', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hdx-eval-snap-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads back an identical manifest', () => {
    const manifest: SnapshotManifest = {
      scenarioName: 'latency-spike',
      seedLogicHash: seedLogicHash(),
      volumeFactor: 1,
      seed: 42,
      anchorMs: Date.parse('2026-06-01T00:00:00Z'),
      anchorIso: '2026-06-01T00:00:00.000Z',
      createdAt: new Date().toISOString(),
      tables: [
        { table: 'eval_latency_spike_otel_traces', rows: 1000, bytes: 5000 },
      ],
      totalRows: 1000,
      totalBytes: 5000,
    };
    writeManifest(dir, manifest);
    expect(readManifest(dir)).toEqual(manifest);
    expect(manifestPath(dir)).toBe(join(dir, 'manifest.json'));
  });

  it('returns null when no manifest is present', () => {
    expect(readManifest(dir)).toBeNull();
  });
});
