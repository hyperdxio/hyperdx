import { execFile } from 'child_process';
import {
  chmodSync,
  createWriteStream,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { promisify } from 'util';

import type { ConnectionResponse } from '@/api/client';

export type BundleClient = {
  getApiUrl(): string;
  get(path: string, signal?: AbortSignal): Promise<Response>;
  post(path: string, signal?: AbortSignal): Promise<Response>;
  getConnections(
    signal?: AbortSignal,
  ): Promise<
    Pick<ConnectionResponse, 'id' | 'name' | 'isPrometheusEndpoint'>[]
  >;
  query(
    connectionId: string,
    sql: string,
    signal?: AbortSignal,
  ): Promise<unknown[]>;
};

type BundleStep = {
  name: string;
  file?: string;
  source?: string;
  ok: boolean;
  error?: string;
};

export type Manifest = {
  createdAt: string;
  cliVersion: string;
  apiUrl: string;
  // ClickHouse files are named by connection id; this maps them to names.
  connections: { id: string; name: string }[];
  steps: BundleStep[];
};

export type BundleOptions = {
  seconds: number;
  heapSnapshot: boolean;
  outDir: string;
  collectorPprofUrl?: string;
  tarCommand?: string;
};

// ClickHouse quotes the failing query, filter values included, in error text:
// cut from the query marker onward and blank out quoted literals.
const scrubbed = (column: string) =>
  String.raw`replaceRegexpAll(replaceRegexpAll(${column}, '(?is)(\\s*In scope |\\s*while processing query|\\s*\\(in query:|\\s*failed at position).*$', ''), '''[^'']*''', '''?''') AS ${column}`;

// Explicit UTC ISO timestamps: the settings lookup that would set the output
// format is skipped (see cli.tsx), and SETTINGS would fail for readonly users.
// A separate alias: reusing the column name would shadow it in WHERE/ORDER BY.
const isoTime = (column: string) =>
  `formatDateTime(${column}, '%FT%TZ', 'UTC') AS ${column}_utc`;

// Fixed SQL only: nothing here takes user input.
export const CLICKHOUSE_QUERIES: Record<string, string> = {
  version: 'SELECT version() AS version',
  errors: `SELECT name, code, value, ${isoTime('last_error_time')}, ${scrubbed('last_error_message')} FROM system.errors ORDER BY last_error_time DESC LIMIT 100`,
  'failed-queries': `SELECT ${isoTime('event_time')}, query_id, exception_code, ${scrubbed('exception')}, query_duration_ms, user FROM system.query_log WHERE type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing') AND event_time > now() - INTERVAL 1 HOUR ORDER BY event_time DESC LIMIT 200`,
  'table-sizes':
    'SELECT database, table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes_on_disk, count() AS parts FROM system.parts WHERE active GROUP BY database, table ORDER BY bytes_on_disk DESC LIMIT 100',
};

// Deliberately separate from the API's redactSecrets, which is scoped to LLM
// input and documented as unsuitable for export pipelines like this one.
export function redact(text: string): string {
  return (
    text
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s"]+@/gi, '$1***@')
      .replace(/((?:Bearer|Basic)\s+)[^\s"]+/gi, '$1***')
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***')
      .replace(/\b(\w*(?:password|secret|token|key)=)[^\s&"]+/gi, '$1***')
      .replace(/("\w*(?:password|secret|token|key)"\s*:\s*")[^"]*"/gi, '$1***"')
      // The same, inside a JSON-encoded string such as DEFAULT_CONNECTIONS.
      .replace(
        /(\\"\w*(?:password|secret|token|key)\\"\s*:\s*\\").*?(\\")/gi,
        '$1***$2',
      )
  );
}

// setTimeout-based rather than AbortSignal.timeout so it can be tested with
// fake timers. Unref'd so a finished bundle does not wait for it.
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${ms / 1000}s`)),
    ms,
  );
  timer.unref?.();
  return controller.signal;
}

function checkApi(res: Response, notFound: string): Response {
  if (res.status === 404) throw new Error(notFound);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function runSupportBundle(
  client: BundleClient,
  opts: BundleOptions,
): Promise<{
  dir: string;
  archive?: string;
  archiveError?: string;
  manifest: Manifest;
}> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(opts.outDir, `hdx-support-${stamp}`);
  // Owner-only: a bundle can hold a heap snapshot full of secrets.
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    cliVersion: process.env.npm_package_version ?? '0.0.0',
    apiUrl: client.getApiUrl(),
    connections: [],
    steps: [],
  };

  // Text is redacted before it is written. A Response is streamed to disk
  // untouched (profiles and snapshots), keeping multi-GB files out of memory,
  // unless it is marked as text to redact.
  const step = async (
    name: string,
    file: string,
    fetchContent: () => Promise<string | Response>,
    { redactText = false } = {},
  ) => {
    try {
      const content = await fetchContent();
      const path = join(dir, file);
      let source: string | undefined;
      if (typeof content === 'string') {
        writeFileSync(path, redact(content));
      } else if (redactText) {
        source = content.headers.get('X-HDX-Diagnostics-Source') ?? undefined;
        writeFileSync(path, redact(await content.text()));
      } else {
        source = content.headers.get('X-HDX-Diagnostics-Source') ?? undefined;
        if (!content.body) throw new Error('empty response');
        await pipeline(
          Readable.fromWeb(content.body as NodeReadableStream),
          createWriteStream(path),
        );
      }
      manifest.steps.push({ name, file, ok: true, ...(source && { source }) });
    } catch (err) {
      // A stream that failed part way leaves a truncated file; drop it so the
      // bundle only holds files the manifest vouches for.
      rmSync(join(dir, file), { force: true });
      const error = err instanceof Error ? err.message : String(err);
      manifest.steps.push({ name, ok: false, error });
    }
  };

  // A 404 means diagnostics are off (the default) or the API predates them.
  const unsupported =
    'not available: set HDX_DIAGNOSTICS_ENABLED=true on the API, or upgrade it';
  const q = `seconds=${opts.seconds}`;
  // A stuck API is the main reason to run this, so every call is bounded.
  const profileTimeoutMs = (opts.seconds + 30) * 1000;

  await step(
    'api-report',
    'api-report.json',
    async () =>
      checkApi(
        await client.get('/diagnostics/report', timeoutSignal(30_000)),
        unsupported,
      ),
    { redactText: true },
  );
  await step('api-cpu-profile', 'api-cpu.cpuprofile', async () =>
    checkApi(
      await client.post(
        `/diagnostics/cpu-profile?${q}`,
        timeoutSignal(profileTimeoutMs),
      ),
      unsupported,
    ),
  );
  await step('api-heap-profile', 'api-heap.heapprofile', async () =>
    checkApi(
      await client.post(
        `/diagnostics/heap-profile?${q}`,
        timeoutSignal(profileTimeoutMs),
      ),
      unsupported,
    ),
  );
  if (opts.heapSnapshot) {
    // Written unredacted: rewriting a snapshot would corrupt it, and it holds
    // every string in memory anyway. The CLI warns about this before running.
    await step('api-heap-snapshot', 'api.heapsnapshot', async () =>
      checkApi(
        // Large heaps take minutes to snapshot and download.
        await client.post('/diagnostics/heap-snapshot', timeoutSignal(600_000)),
        'not available: set HDX_DIAGNOSTICS_ENABLED=true and HDX_DIAGNOSTICS_HEAP_SNAPSHOT=true on the API',
      ),
    );
  }

  if (opts.collectorPprofUrl) {
    const base = opts.collectorPprofUrl.replace(/\/+$/, '');
    const pprof = async (path: string) => {
      const res = await fetch(`${base}${path}`, {
        signal: timeoutSignal(profileTimeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    };
    await step('collector-heap', 'collector-heap.pb.gz', () =>
      pprof('/debug/pprof/heap'),
    );
    await step('collector-cpu', 'collector-cpu.pb.gz', () =>
      pprof(`/debug/pprof/profile?${q}`),
    );
  }

  let connections: Awaited<ReturnType<BundleClient['getConnections']>> = [];
  try {
    connections = await client.getConnections(timeoutSignal(30_000));
  } catch (err) {
    manifest.steps.push({
      name: 'ch-connections',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Prometheus/Thanos connections can't run ClickHouse SQL.
  const clickhouse = connections.filter(c => !c.isPrometheusEndpoint);
  manifest.connections = clickhouse.map(({ id, name }) => ({ id, name }));
  for (const { id } of clickhouse) {
    for (const [key, sql] of Object.entries(CLICKHOUSE_QUERIES)) {
      await step(`ch-${id}-${key}`, `ch-${id}-${key}.json`, async () =>
        JSON.stringify(
          await client.query(id, sql, timeoutSignal(60_000)),
          null,
          2,
        ),
      );
    }
  }

  // apiUrl can carry basic-auth credentials and step errors are server text.
  writeFileSync(
    join(dir, 'manifest.json'),
    redact(JSON.stringify(manifest, null, 2)),
  );

  const archive = `${dir}.tar.gz`;
  try {
    await promisify(execFile)(opts.tarCommand ?? 'tar', [
      '-czf',
      archive,
      '-C',
      dirname(dir),
      basename(dir),
    ]);
    // The archive is the result; a second loose copy (maybe a multi-GB heap
    // snapshot) would only be left behind unnoticed.
    rmSync(dir, { recursive: true, force: true });
    chmodSync(archive, 0o600);
    return { dir, archive, manifest };
  } catch (err) {
    // tar may have created a truncated archive before failing (e.g. ENOSPC).
    rmSync(archive, { force: true });
    return {
      dir,
      manifest,
      archiveError: err instanceof Error ? err.message : String(err),
    };
  }
}
