import { Session } from 'node:inspector/promises';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import v8 from 'node:v8';

import express from 'express';
import { z } from 'zod';
import { processRequest } from 'zod-express-middleware';

import { CODE_VERSION, DIAGNOSTICS_HEAP_SNAPSHOT_ENABLED } from '@/config';
import { Api404Error, BaseError, StatusCode } from '@/utils/errors';
import { recordOperationOutcome, withSpan } from '@/utils/instrumentation';
import rateLimiter from '@/utils/rateLimiter';

const router = express.Router();

// Generating a report blocks the event loop briefly and every route here
// costs CPU, so one user cannot call them in a tight loop.
router.use(
  rateLimiter({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // Mounted behind isUserAuthenticated, so there is always a user.
    keyGenerator: req => String(req.user?._id),
  }),
);

// Stays under the 60s load balancer idle timeout the server is tuned for.
const MAX_PROFILE_SECONDS = 50;
const DEFAULT_PROFILE_SECONDS = 30;
const secondsSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PROFILE_SECONDS)
  .default(DEFAULT_PROFILE_SECONDS);

// processRequest answers 400 in the shape every other route uses. It types the
// parsed query with the pre-default shape, hence the fallback at each use.
const validateSeconds = processRequest({
  query: z.object({ seconds: secondsSchema }),
});

type DiagnosticKind =
  | 'report'
  | 'cpu-profile'
  | 'heap-profile'
  | 'heap-snapshot';

// Infrastructure detail a support bundle does not need: the environment (Mongo
// URI, API keys), launch flags, interface addresses and socket peers. They
// appear on the report and on every workers[] entry, so drop them at any depth.
const REDACTED_REPORT_KEYS = new Set([
  'environmentVariables',
  'commandLine',
  'networkInterfaces',
  'localEndpoint',
  'remoteEndpoint',
]);

// Two profilers running at once distort each other's samples, so one per process.
let profiling = false;

const isBusy = (err: unknown) =>
  err instanceof BaseError && err.statusCode === StatusCode.CONFLICT;

// A client that hangs up, or a request refused because another profile is
// running, is expected: it is neither an SLI failure nor an error span.
async function collect<T>(
  kind: DiagnosticKind,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const result = await withSpan(
    'diagnostics.collect',
    async span => {
      const start = performance.now();
      const record = (outcome: 'success' | 'error') =>
        recordOperationOutcome({
          operation: 'diagnostics.collect',
          outcome,
          durationMs: performance.now() - start,
          attributes: { kind },
        });
      try {
        const value = await fn();
        record('success');
        return { value };
      } catch (err) {
        if (signal?.aborted || isBusy(err)) {
          span.setAttribute(
            'hyperdx.diagnostics.outcome',
            signal?.aborted ? 'cancelled' : 'busy',
          );
          return { expected: err };
        }
        record('error');
        throw err;
      }
    },
    { attributes: { 'hyperdx.diagnostics.kind': kind } },
  );
  if ('expected' in result) throw result.expected;
  return result.value;
}

async function withProfilingLock<T>(fn: () => Promise<T>): Promise<T> {
  if (profiling) {
    const message = 'A profile is already running on this process';
    throw new BaseError(message, StatusCode.CONFLICT, true, message);
  }
  profiling = true;
  try {
    return await fn();
  } finally {
    profiling = false;
  }
}

async function withInspector<T>(fn: (session: Session) => Promise<T>) {
  const session = new Session();
  session.connect();
  try {
    return await fn(session);
  } finally {
    session.disconnect();
  }
}

// attachment() derives Content-Type from the extension; these files are JSON.
// pid alone is 1 in every container, so the hostname tells replicas apart.
function attachment(res: express.Response, extension: string) {
  const source = `${os.hostname()}-${process.pid}`;
  res
    .attachment(`api-${source}.${extension}`)
    .type('application/json')
    .set('X-HDX-Diagnostics-Source', `${os.hostname()}/${process.pid}`);
}

// Aborts when the client goes away, so an abandoned profile frees the lock.
function abortOnDisconnect(res: express.Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

type Profiler = {
  kind: 'cpu-profile' | 'heap-profile';
  extension: string;
  start: (session: Session) => Promise<unknown>;
  stop: (session: Session) => Promise<unknown>;
};

const CPU_PROFILER: Profiler = {
  kind: 'cpu-profile',
  extension: 'cpuprofile',
  start: async session => {
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
  },
  stop: async session => (await session.post('Profiler.stop')).profile,
};

const HEAP_PROFILER: Profiler = {
  kind: 'heap-profile',
  extension: 'heapprofile',
  start: session => session.post('HeapProfiler.startSampling'),
  stop: async session =>
    (await session.post('HeapProfiler.stopSampling')).profile,
};

async function sendProfile(
  profiler: Profiler,
  seconds: number,
  res: express.Response,
  next: express.NextFunction,
) {
  const signal = abortOnDisconnect(res);
  try {
    const profile = await collect(
      profiler.kind,
      () =>
        withProfilingLock(() =>
          withInspector(async session => {
            await profiler.start(session);
            await sleep(seconds * 1000, undefined, { signal });
            return profiler.stop(session);
          }),
        ),
      signal,
    );
    attachment(res, profiler.extension);
    res.json(profile);
  } catch (e) {
    // Nobody is left to answer, and a disconnect is not a server fault.
    if (signal.aborted) return;
    next(e);
  }
}

router.get('/report', async (req, res, next) => {
  try {
    // One serialisation pass: this runs on a process that may be struggling.
    const body = await collect('report', async () =>
      JSON.stringify(
        {
          codeVersion: CODE_VERSION,
          hostname: os.hostname(),
          pid: process.pid,
          uptimeSeconds: process.uptime(),
          report: process.report.getReport(),
        },
        (key, value) => (REDACTED_REPORT_KEYS.has(key) ? undefined : value),
      ),
    );
    res.type('json').send(body);
  } catch (e) {
    next(e);
  }
});

router.post('/cpu-profile', validateSeconds, (req, res, next) =>
  sendProfile(
    CPU_PROFILER,
    req.query.seconds ?? DEFAULT_PROFILE_SECONDS,
    res,
    next,
  ),
);

router.post('/heap-profile', validateSeconds, (req, res, next) =>
  sendProfile(
    HEAP_PROFILER,
    req.query.seconds ?? DEFAULT_PROFILE_SECONDS,
    res,
    next,
  ),
);

router.post('/heap-snapshot', async (req, res, next) => {
  const signal = abortOnDisconnect(res);
  try {
    // Off by default: a snapshot is raw process memory, secrets and decrypted
    // tokens included, and it pauses the event loop and can roughly double
    // memory, which can OOMKill a pod that is already struggling.
    if (!DIAGNOSTICS_HEAP_SNAPSHOT_ENABLED) {
      throw new Api404Error('Heap snapshots are disabled');
    }
    await collect(
      'heap-snapshot',
      () =>
        withProfilingLock(async () => {
          attachment(res, 'heapsnapshot');
          await pipeline(v8.getHeapSnapshot(), res);
        }),
      signal,
    );
  } catch (e) {
    if (signal.aborted) return;
    next(e);
  }
});

export default router;
