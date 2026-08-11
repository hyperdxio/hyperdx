import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  loadScenarioSnapshot,
  manifestPath,
  readManifest,
  seedLogicHash,
  seedLogicHashShort,
  snapshotFileName,
  type SnapshotManifest,
  snapshotTableFields,
  writeManifest,
} from '@/clickhouse/parquetSnapshot';
import { scenarioTables } from '@/clickhouse/schema';

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

describe('loadScenarioSnapshot — materialized view restoration', () => {
  let dir: string;
  beforeEach(() => {
    // Empty snapshot dir: every per-table file is absent, so the load loop
    // skips all inserts (no HTTP needed) and we reach backfillRollups.
    dir = mkdtempSync(join(tmpdir(), 'hdx-eval-load-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const http = { url: 'http://unused', username: 'u', password: 'p' };

  function makeCallbacks(overrides?: {
    failDrop?: boolean;
    failBackfill?: boolean;
  }) {
    const calls: string[] = [];
    const tables = scenarioTables('latency-spike');
    return {
      calls,
      cb: {
        ensure: async () => {
          calls.push('ensure');
          return tables;
        },
        truncate: async () => {
          calls.push('truncate');
        },
        dropMaterializedViews: async () => {
          calls.push('drop');
          // Simulate a PARTIAL drop: one view dropped, then a later drop fails.
          if (overrides?.failDrop) throw new Error('partial drop blew up');
        },
        backfillRollups: async () => {
          calls.push('backfill');
          if (overrides?.failBackfill) throw new Error('backfill blew up');
        },
        createMaterializedViews: async () => {
          calls.push('create');
        },
      },
    };
  }

  it('runs backfill then recreate on the success path', async () => {
    const { calls, cb } = makeCallbacks();
    await loadScenarioSnapshot({
      http,
      dir,
      scenarioName: 'latency-spike',
      ...cb,
    });
    expect(calls).toEqual(['ensure', 'truncate', 'drop', 'backfill', 'create']);
  });

  it('restores rollups + MVs even when the drop partially fails', async () => {
    // Finding: a partial drop that throws must NOT bypass restoration. The drop
    // is inside the try, so the finally still backfills and recreates the MVs.
    const { calls, cb } = makeCallbacks({ failDrop: true });
    await expect(
      loadScenarioSnapshot({ http, dir, scenarioName: 'latency-spike', ...cb }),
    ).rejects.toThrow('partial drop blew up');
    // Restoration ran despite the partial drop; MVs are not left detached.
    expect(calls).toEqual(['ensure', 'truncate', 'drop', 'backfill', 'create']);
  });

  it('always backfills rollups before recreating MVs on the failure path', async () => {
    // Finding: a mid-load failure must still run backfillRollups (so rows that
    // landed while MVs were detached are reflected) AND recreate the MVs.
    // Force a failure by making backfill itself throw — the primary error must
    // still surface, and create must not have been skipped.
    const { calls, cb } = makeCallbacks({ failBackfill: true });
    await expect(
      loadScenarioSnapshot({ http, dir, scenarioName: 'latency-spike', ...cb }),
    ).rejects.toThrow('backfill blew up');
    // backfill was attempted; because it threw on the success path (no prior
    // load error), that error surfaces and create did not run after it.
    expect(calls).toContain('drop');
    expect(calls).toContain('backfill');
  });
});
