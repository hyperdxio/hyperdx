import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  type BundleClient,
  CLICKHOUSE_QUERIES,
  redact,
  runSupportBundle,
} from '@/supportBundle';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function fakeClient(overrides: Partial<BundleClient> = {}): BundleClient {
  return {
    getApiUrl: () => 'http://api.test',
    get: async () => json({ pid: 1, report: { header: {} } }),
    post: async path => json({ path }),
    getConnections: async () => [{ id: 'c1', name: 'Local' }],
    query: async () => [{ ok: 1 }],
    ...overrides,
  };
}

describe('redact', () => {
  it('masks credentials in mongodb URIs', () => {
    expect(redact('mongodb://admin:hunter2@db:27017/hdx')).toBe(
      'mongodb://***@db:27017/hdx',
    );
    expect(redact('mongodb+srv://u:p@cluster/x')).toBe(
      'mongodb+srv://***@cluster/x',
    );
  });

  it('masks bearer tokens', () => {
    expect(redact('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: Bearer ***',
    );
  });

  it('masks secret-looking JSON values', () => {
    expect(
      redact('{"apiKey":"k-1","api_key":"k-2","password":"p","name":"ok"}'),
    ).toBe('{"apiKey":"***","api_key":"***","password":"***","name":"ok"}');
  });

  it('masks env-style secret keys', () => {
    expect(
      redact(
        '{"CLICKHOUSE_PASSWORD":"p","HYPERDX_API_KEY":"k","HOME":"/root"}',
      ),
    ).toBe(
      '{"CLICKHOUSE_PASSWORD":"***","HYPERDX_API_KEY":"***","HOME":"/root"}',
    );
  });

  it('masks key-named secrets and secrets inside JSON-encoded strings', () => {
    expect(redact('{"TOKEN_ENCRYPTION_KEY":"k"}')).toBe(
      '{"TOKEN_ENCRYPTION_KEY":"***"}',
    );
    expect(redact('{"DEFAULT_CONNECTIONS":"[{\\"password\\":\\"p\\"}]"}')).toBe(
      '{"DEFAULT_CONNECTIONS":"[{\\"password\\":\\"***\\"}]"}',
    );
  });

  it('leaves profile function names alone', () => {
    const text = '{"functionName":"getToken","url":"file:///app/auth.js"}';
    expect(redact(text)).toBe(text);
  });
});

describe('runSupportBundle', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'hdx-bundle-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const run = (client: BundleClient, extra = {}) =>
    runSupportBundle(client, {
      seconds: 1,
      heapSnapshot: false,
      outDir,
      ...extra,
    });

  it('collects API and ClickHouse diagnostics into an archive', async () => {
    const { dir, archive, manifest } = await run(fakeClient());

    const names = manifest.steps.map(s => s.name);
    expect(names).toEqual([
      'api-report',
      'api-cpu-profile',
      'api-heap-profile',
      'ch-c1-version',
      'ch-c1-errors',
      'ch-c1-failed-queries',
      'ch-c1-table-sizes',
    ]);
    expect(manifest.steps.every(s => s.ok)).toBe(true);
    expect(existsSync(join(dir, 'api-cpu.cpuprofile'))).toBe(true);
    expect(archive).toBe(`${dir}.tar.gz`);
    expect(existsSync(archive!)).toBe(true);
  });

  it('asks the API for the requested profile window', async () => {
    const paths: string[] = [];
    await run(
      fakeClient({
        post: async path => {
          paths.push(path);
          return json({});
        },
      }),
      { seconds: 7 },
    );

    expect(paths).toEqual([
      '/diagnostics/cpu-profile?seconds=7',
      '/diagnostics/heap-profile?seconds=7',
    ]);
  });

  it('records a failed step and carries on with the rest', async () => {
    const { manifest } = await run(
      fakeClient({
        query: async (_id, sql) => {
          if (sql.includes('system.errors')) throw new Error('ACCESS_DENIED');
          return [];
        },
      }),
    );

    const errors = manifest.steps.find(s => s.name === 'ch-c1-errors');
    expect(errors).toMatchObject({ ok: false, error: 'ACCESS_DENIED' });
    expect(manifest.steps.find(s => s.name === 'ch-c1-table-sizes')?.ok).toBe(
      true,
    );
  });

  it('marks API steps unsupported when the server has no diagnostics endpoint', async () => {
    const { manifest } = await run(
      fakeClient({
        get: async () => json({}, 404),
        post: async () => json({}, 404),
      }),
    );

    expect(manifest.steps.find(s => s.name === 'api-report')).toMatchObject({
      ok: false,
      error: 'not supported by server',
    });
  });

  it('redacts secrets in written files', async () => {
    const { dir } = await run(
      fakeClient({
        get: async () =>
          json({ report: { header: { commandLine: ['mongodb://a:b@db/x'] } } }),
      }),
    );

    const written = readFileSync(join(dir, 'api-report.json'), 'utf8');
    expect(written).toContain('mongodb://***@db/x');
    expect(written).not.toContain('a:b@');
  });

  it('collects collector pprof only when a URL is given', async () => {
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      fetched.push(url);
      return new Response('pprof-bytes');
    }) as typeof fetch;
    try {
      const { manifest, dir } = await run(fakeClient(), {
        collectorPprofUrl: 'http://127.0.0.1:1777/',
      });

      expect(fetched).toEqual([
        'http://127.0.0.1:1777/debug/pprof/heap',
        'http://127.0.0.1:1777/debug/pprof/profile?seconds=1',
      ]);
      expect(manifest.steps.map(s => s.name)).toContain('collector-cpu');
      expect(readFileSync(join(dir, 'collector-heap.pb.gz'), 'utf8')).toBe(
        'pprof-bytes',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('records which API replica each file came from', async () => {
    const { manifest } = await run(
      fakeClient({
        post: async () =>
          new Response('{}', {
            headers: { 'X-HDX-Diagnostics-Source': 'api-7f9c/42' },
          }),
      }),
    );

    expect(
      manifest.steps.find(s => s.name === 'api-cpu-profile'),
    ).toMatchObject({ ok: true, source: 'api-7f9c/42' });
  });

  it('writes the heap snapshot as-is, without redaction', async () => {
    const { dir, manifest } = await run(
      fakeClient({
        post: async path =>
          path === '/diagnostics/heap-snapshot'
            ? new Response('{"strings":["Bearer keep-me"]}')
            : json({}),
      }),
      { heapSnapshot: true },
    );

    expect(manifest.steps.find(s => s.name === 'api-heap-snapshot')?.ok).toBe(
      true,
    );
    expect(readFileSync(join(dir, 'api.heapsnapshot'), 'utf8')).toBe(
      '{"strings":["Bearer keep-me"]}',
    );
  });

  it('explains how to enable heap snapshots when the server has them off', async () => {
    const { manifest } = await run(
      fakeClient({
        post: async path =>
          path === '/diagnostics/heap-snapshot' ? json({}, 404) : json({}),
      }),
      { heapSnapshot: true },
    );

    expect(
      manifest.steps.find(s => s.name === 'api-heap-snapshot')?.error,
    ).toContain('HDX_DIAGNOSTICS_HEAP_SNAPSHOT=true');
  });

  it('keeps the API steps when connections cannot be listed', async () => {
    const { manifest } = await run(
      fakeClient({
        getConnections: async () => {
          throw new Error('unauthorized');
        },
      }),
    );

    expect(manifest.steps.find(s => s.name === 'ch-connections')).toMatchObject(
      { ok: false, error: 'unauthorized' },
    );
    expect(manifest.steps.some(s => s.name.startsWith('ch-c1'))).toBe(false);
    expect(manifest.steps.find(s => s.name === 'api-report')?.ok).toBe(true);
  });

  it('skips Prometheus connections, which cannot run ClickHouse SQL', async () => {
    const queried: string[] = [];
    const { manifest } = await run(
      fakeClient({
        getConnections: async () => [
          { id: 'c1', name: 'Local' },
          { id: 'p1', name: 'Thanos', isPrometheusEndpoint: true },
        ],
        query: async id => {
          queried.push(id);
          return [];
        },
      }),
    );

    expect(new Set(queried)).toEqual(new Set(['c1']));
    expect(manifest.steps.some(s => s.name.startsWith('ch-p1'))).toBe(false);
  });

  describe('timeouts', () => {
    // Resolves only when the caller's signal aborts, like a wedged server.
    const hang = (signal?: AbortSignal) =>
      new Promise<Response>((_, reject) =>
        signal?.addEventListener('abort', () => reject(signal.reason)),
      );

    beforeEach(() => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('fails API steps on a hung API instead of waiting forever', async () => {
      const done = run(
        fakeClient({
          get: (_path, signal) => hang(signal),
          post: (_path, signal) => hang(signal),
        }),
      );
      await jest.advanceTimersByTimeAsync(3 * 31_000);
      const { manifest } = await done;

      for (const name of [
        'api-report',
        'api-cpu-profile',
        'api-heap-profile',
      ]) {
        expect(manifest.steps.find(s => s.name === name)).toMatchObject({
          ok: false,
          error: expect.stringContaining('timed out'),
        });
      }
      expect(manifest.steps.find(s => s.name === 'ch-c1-version')?.ok).toBe(
        true,
      );
    });

    it('fails collector steps on an unreachable collector', async () => {
      const realFetch = globalThis.fetch;
      // Collector fetches start only after the API files are written, so the
      // clock is advanced once each fetch is actually waiting.
      let fetchStarted: () => void = () => {};
      const nextFetch = () =>
        new Promise<void>(resolve => {
          fetchStarted = resolve;
        });
      let started = nextFetch();
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        fetchStarted();
        return hang(init?.signal ?? undefined);
      }) as typeof fetch;
      try {
        const done = run(fakeClient(), {
          collectorPprofUrl: 'http://127.0.0.1:1777',
        });
        for (let i = 0; i < 2; i++) {
          await started;
          started = nextFetch();
          await jest.advanceTimersByTimeAsync(31_000);
        }
        const { manifest } = await done;

        expect(
          manifest.steps.find(s => s.name === 'collector-cpu'),
        ).toMatchObject({
          ok: false,
          error: expect.stringContaining('timed out'),
        });
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });

  it('records which API replica served the report', async () => {
    const { manifest } = await run(
      fakeClient({
        get: async () =>
          new Response('{}', {
            headers: { 'X-HDX-Diagnostics-Source': 'api-7f9c/42' },
          }),
      }),
    );

    expect(manifest.steps.find(s => s.name === 'api-report')).toMatchObject({
      ok: true,
      source: 'api-7f9c/42',
    });
  });

  it('keeps the directory when tar is unavailable', async () => {
    const { dir, archive } = await run(fakeClient(), {
      tarCommand: 'definitely-not-tar',
    });

    expect(archive).toBeUndefined();
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });
});

describe('CLICKHOUSE_QUERIES', () => {
  // ClickHouse quotes the failing query, filter values included, in these columns.
  it.each([
    ['failed-queries', 'exception'],
    ['errors', 'last_error_message'],
  ])('%s scrubs query text out of %s', (key, column) => {
    const sql = CLICKHOUSE_QUERIES[key];
    expect(sql).toContain(`replaceRegexpAll(replaceRegexpAll(${column},`);
    const withoutScrub = sql.replace(/replaceRegexpAll\(.*\) AS \w+/, '');
    expect(withoutScrub).not.toMatch(new RegExp(`\\b${column}\\b`));
  });
});
