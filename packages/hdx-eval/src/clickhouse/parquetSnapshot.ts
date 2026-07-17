import { createHash } from 'crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { pipeline } from 'stream/promises';

import { EVAL_DATABASE, type ScenarioTables } from './schema';

/**
 * Milestone 2 — kill the seed bottleneck.
 *
 * Full-volume generation of synthetic telemetry takes hours because it is a
 * CPU-bound JS loop. Instead we generate the data ONCE, export each eval table
 * to a Parquet file, and on subsequent runs load those Parquet files straight
 * into ClickHouse (I/O-bound, ~an order of magnitude faster). The Parquet
 * snapshot is keyed by a hash of the seed-generation source, so it is only
 * regenerated when the seeding logic actually changes.
 *
 * The rollup metadata tables are intentionally NOT part of the snapshot: they
 * are repopulated automatically by the materialized views attached to the raw
 * tables when we INSERT the Parquet rows (same path as a live seed insert).
 */

// ClickHouse HTTP connection derived from the eval client config. We use raw
// HTTP (not the @clickhouse/client insert API) because Parquet is a binary
// stream we want to pipe directly to/from disk without buffering in memory.
export type ChHttp = {
  url: string; // base HTTP URL, e.g. http://localhost:8123
  username: string;
  password: string;
};

/** The raw data tables that make up a snapshot (rollups are excluded). */
export function snapshotTableFields(): Array<keyof ScenarioTables> {
  return [
    'traces',
    'logs',
    'metricsGauge',
    'metricsSum',
    'metricsHistogram',
    'metricsExponentialHistogram',
    'metricsSummary',
  ];
}

function authHeaders(http: ChHttp): Record<string, string> {
  return {
    'X-ClickHouse-User': http.username,
    'X-ClickHouse-Key': http.password,
  };
}

async function chExec(http: ChHttp, sql: string): Promise<string> {
  const res = await fetch(http.url, {
    method: 'POST',
    headers: { ...authHeaders(http), 'Content-Type': 'text/plain' },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ClickHouse query failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  return text;
}

async function tableRowCount(http: ChHttp, table: string): Promise<number> {
  const out = await chExec(
    http,
    `SELECT count() FROM ${EVAL_DATABASE}.${table}`,
  );
  return Number(out.trim()) || 0;
}

/** Filename for a table's Parquet file within a snapshot directory. */
export function snapshotFileName(table: string): string {
  return `${table}.parquet`;
}

export type ExportResult = {
  files: Array<{ table: string; path: string; rows: number; bytes: number }>;
  totalRows: number;
  totalBytes: number;
};

/**
 * Export every non-empty snapshot table for a scenario to Parquet files under
 * `dir`. Empty tables are skipped (no file written) so the loader can treat a
 * missing file as "zero rows".
 */
export async function exportScenarioSnapshot(args: {
  http: ChHttp;
  scenarioName: string;
  dir: string;
  tables: ScenarioTables;
}): Promise<ExportResult> {
  mkdirSync(args.dir, { recursive: true });
  const files: ExportResult['files'] = [];
  let totalRows = 0;
  let totalBytes = 0;

  for (const field of snapshotTableFields()) {
    const table = args.tables[field];
    const rows = await tableRowCount(args.http, table);
    if (rows === 0) continue;

    const outPath = join(args.dir, snapshotFileName(table));
    // zstd is ClickHouse's default Parquet codec and already near the size
    // floor for this data; set it explicitly so snapshots are reproducible
    // regardless of server defaults.
    const sql =
      `SELECT * FROM ${EVAL_DATABASE}.${table} ` +
      `FORMAT Parquet ` +
      `SETTINGS output_format_parquet_compression_method='zstd'`;
    const res = await fetch(args.http.url, {
      method: 'POST',
      headers: { ...authHeaders(args.http), 'Content-Type': 'text/plain' },
      body: sql,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `Parquet export of ${table} failed (${res.status}): ${errText.slice(0, 500)}`,
      );
    }
    mkdirSync(dirname(outPath), { recursive: true });
    // Pipe the response stream directly to disk to avoid buffering large
    // Parquet payloads in memory.
    await pipeline(res.body, createWriteStream(outPath));
    const bytes = statSync(outPath).size;
    files.push({ table, path: outPath, rows, bytes });
    totalRows += rows;
    totalBytes += bytes;
  }

  return { files, totalRows, totalBytes };
}

export type LoadResult = {
  files: Array<{ table: string; rows: number }>;
  totalRows: number;
};

/** Stream one Parquet file from disk into an INSERT over the HTTP interface. */
async function insertParquetFile(
  http: ChHttp,
  table: string,
  filePath: string,
): Promise<void> {
  const query = `INSERT INTO ${EVAL_DATABASE}.${table} FORMAT Parquet`;
  const url = `${http.url}/?query=${encodeURIComponent(query)}`;
  // Node's fetch accepts a Readable body but requires `duplex: 'half'`; neither
  // is in the DOM RequestInit type, so build the init as `unknown` and cast.
  const init = {
    method: 'POST',
    headers: {
      ...authHeaders(http),
      'Content-Type': 'application/octet-stream',
    },
    body: createReadStream(filePath),
    duplex: 'half',
  } as unknown as RequestInit;
  const res = await fetch(url, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Parquet load of ${table} failed (${res.status}): ${errText.slice(0, 500)}`,
    );
  }
}

/**
 * Load a previously exported Parquet snapshot for a scenario into ClickHouse.
 *
 * Fast path: rather than let the rollup materialized views fan out on the bulk
 * insert (aggregating + writing the SummingMergeTree rollups per insert block,
 * the dominant cost of a large load), we
 *   1. drop the rollup MVs,
 *   2. bulk-insert the raw Parquet with no fan-out,
 *   3. backfill the rollups in one shot (same SELECTs the MVs run), and
 *   4. recreate the MVs so any later inserts still maintain them.
 * This produces byte-identical rollup content and is meaningfully faster at
 * scale. The drop/backfill/recreate steps are supplied by the caller (they
 * need the @clickhouse/client instance) via the same callback pattern as
 * ensure/truncate.
 */
export async function loadScenarioSnapshot(args: {
  http: ChHttp;
  // DDL callbacks backed by the @clickhouse/client instance.
  ensure: () => Promise<ScenarioTables>;
  truncate: () => Promise<void>;
  dropMaterializedViews: (tables: ScenarioTables) => Promise<void>;
  backfillRollups: (tables: ScenarioTables) => Promise<void>;
  createMaterializedViews: (tables: ScenarioTables) => Promise<void>;
  scenarioName: string;
  dir: string;
}): Promise<LoadResult> {
  if (!existsSync(args.dir)) {
    throw new Error(`Snapshot directory not found: ${args.dir}`);
  }
  const tables = await args.ensure();
  await args.truncate();

  // Detach the MVs so the raw bulk insert below does not trigger per-block
  // rollup maintenance.
  await args.dropMaterializedViews(tables);

  const files: LoadResult['files'] = [];
  let totalRows = 0;

  for (const field of snapshotTableFields()) {
    const table = tables[field];
    const filePath = join(args.dir, snapshotFileName(table));
    if (!existsSync(filePath)) continue; // table had zero rows at export time

    await insertParquetFile(args.http, table, filePath);
    const rows = await tableRowCount(args.http, table);
    files.push({ table, rows });
    totalRows += rows;
  }

  // Rebuild the rollups in one shot from the loaded raw tables, then re-attach
  // the MVs for consistency with a live-seeded scenario.
  await args.backfillRollups(tables);
  await args.createMaterializedViews(tables);

  return { files, totalRows };
}

/**
 * Metadata written next to a snapshot so a loader can verify what it is
 * loading (scenario, anchor, volume, and the seed-logic hash it was built
 * from).
 */
export type SnapshotManifest = {
  scenarioName: string;
  seedLogicHash: string;
  volumeFactor: number;
  seed: number;
  anchorMs: number;
  anchorIso: string;
  createdAt: string;
  tables: Array<{ table: string; rows: number; bytes: number }>;
  totalRows: number;
  totalBytes: number;
};

export function manifestPath(dir: string): string {
  return join(dir, 'manifest.json');
}

export function writeManifest(dir: string, manifest: SnapshotManifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    manifestPath(dir),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

export function readManifest(dir: string): SnapshotManifest | null {
  const p = manifestPath(dir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SnapshotManifest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed-logic hash
// ---------------------------------------------------------------------------

/**
 * Files whose content determines the generated seed data. When ANY of these
 * change, the Parquet snapshot must be regenerated. Used as the cache key in
 * CI so the snapshot is reused only while the seeding logic is unchanged.
 *
 * Paths are relative to the hdx-eval package root (src/...).
 */
const SEED_LOGIC_GLOBS: string[] = [
  'src/generators',
  'src/scenarios',
  'src/rng',
  'src/clickhouse/insert.ts',
  'src/clickhouse/schema.ts',
  'src/clickhouse/parquetSnapshot.ts',
];

function packageRoot(): string {
  // dist/clickhouse/parquetSnapshot.js → dist → packageRoot, or
  // src/clickhouse/parquetSnapshot.ts via tsx → src → packageRoot.
  return resolve(__dirname, '..', '..');
}

/** Recursively collect .ts/.json files under a path (or a single file). */
function collectFiles(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  const st = statSync(absPath);
  if (st.isFile()) return [absPath];
  const out: string[] = [];
  for (const entry of readdirSync(absPath).sort()) {
    const child = join(absPath, entry);
    const cst = statSync(child);
    if (cst.isDirectory()) {
      out.push(...collectFiles(child));
    } else if (/\.(ts|json)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Deterministic hash of all seed-generation source files. Stable across
 * machines: hashes file contents (not mtimes) in sorted path order, with the
 * package-relative path mixed in so renames change the hash.
 */
export function seedLogicHash(): string {
  const root = packageRoot();
  const hash = createHash('sha256');
  const files: string[] = [];
  for (const glob of SEED_LOGIC_GLOBS) {
    files.push(...collectFiles(join(root, glob)));
  }
  files.sort();
  for (const abs of files) {
    const rel = abs.slice(root.length + 1).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(abs));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Short (12-char) form of the seed-logic hash for cache keys / tags. */
export function seedLogicHashShort(): string {
  return seedLogicHash().slice(0, 12);
}
