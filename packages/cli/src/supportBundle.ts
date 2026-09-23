import { execFile } from 'child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { promisify } from 'util';

export type BundleClient = {
  getApiUrl(): string;
  get(path: string, signal?: AbortSignal): Promise<Response>;
  post(path: string, signal?: AbortSignal): Promise<Response>;
  getConnections(): Promise<
    { id: string; name: string; isPrometheusEndpoint?: boolean }[]
  >;
  query(connectionId: string, sql: string): Promise<unknown[]>;
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

// Fixed SQL only: nothing here takes user input.
export const CLICKHOUSE_QUERIES: Record<string, string> = {
  version: 'SELECT version() AS version',
  errors: `SELECT name, code, value, last_error_time, ${scrubbed('last_error_message')} FROM system.errors ORDER BY last_error_time DESC LIMIT 100`,
  'failed-queries': `SELECT event_time, query_id, exception_code, ${scrubbed('exception')}, query_duration_ms, user FROM system.query_log WHERE type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing') AND event_time > now() - INTERVAL 1 HOUR ORDER BY event_time DESC LIMIT 200`,
  'table-sizes':
    'SELECT database, table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes_on_disk, count() AS parts FROM system.parts WHERE active GROUP BY database, table ORDER BY bytes_on_disk DESC LIMIT 100',
};

export function redact(text: string): string {
  return (
    text
      .replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s"]+@/g, '$1***@')
      .replace(/(Bearer\s+)[^\s"]+/gi, '$1***')
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
): Promise<{ dir: string; archive?: string; manifest: Manifest }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(opts.outDir, `hdx-support-${stamp}`);
  mkdirSync(dir, { recursive: true });

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    cliVersion: process.env.npm_package_version ?? '0.0.0',
    apiUrl: client.getApiUrl(),
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
      const error = err instanceof Error ? err.message : String(err);
      manifest.steps.push({ name, ok: false, error });
    }
  };

  const unsupported = 'not supported by server';
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
        'disabled on server (set HDX_DIAGNOSTICS_HEAP_SNAPSHOT=true)',
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
    connections = await client.getConnections();
  } catch (err) {
    manifest.steps.push({
      name: 'ch-connections',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Prometheus/Thanos connections can't run ClickHouse SQL.
  for (const { id } of connections.filter(c => !c.isPrometheusEndpoint)) {
    for (const [key, sql] of Object.entries(CLICKHOUSE_QUERIES)) {
      await step(`ch-${id}-${key}`, `ch-${id}-${key}.json`, async () =>
        JSON.stringify(await client.query(id, sql), null, 2),
      );
    }
  }

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const archive = `${dir}.tar.gz`;
  try {
    await promisify(execFile)(opts.tarCommand ?? 'tar', [
      '-czf',
      archive,
      '-C',
      dirname(dir),
      basename(dir),
    ]);
    return { dir, archive, manifest };
  } catch {
    return { dir, manifest };
  }
}
