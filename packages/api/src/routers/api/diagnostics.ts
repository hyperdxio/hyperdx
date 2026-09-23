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

const router = express.Router();

// Stays under the 60s load balancer idle timeout the server is tuned for.
const MAX_PROFILE_SECONDS = 50;
const DEFAULT_PROFILE_SECONDS = 30;
const secondsSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PROFILE_SECONDS)
  .default(DEFAULT_PROFILE_SECONDS);

type DiagnosticKind =
  | 'report'
  | 'cpu-profile'
  | 'heap-profile'
  | 'heap-snapshot';

// Two profilers running at once distort each other's samples, so one per process.
let profiling = false;

// processRequest answers 400 in the shape every other route uses. It types the
// parsed query with the pre-default shape, hence the fallback at each use.
const validateSeconds = processRequest({
  query: z.object({ seconds: secondsSchema }),
});

const isBusy = (err: unknown) =>
  err instanceof BaseError && err.statusCode === StatusCode.CONFLICT;

// A client that hangs up, or a request refused because another profile is
// running, is expected: neither counts against the availability SLI.
function collect<T>(
  kind: DiagnosticKind,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withSpan(
    'diagnostics.collect',
    async () => {
      const start = performance.now();
      const record = (outcome: 'success' | 'error') =>
        recordOperationOutcome({
          operation: 'diagnostics.collect',
          outcome,
          durationMs: performance.now() - start,
          attributes: { kind },
        });
      try {
        const result = await fn();
        record('success');
        return result;
      } catch (err) {
        if (!signal?.aborted && !isBusy(err)) record('error');
        throw err;
      }
    },
    { attributes: { 'hyperdx.diagnostics.kind': kind } },
  );
}

async function withProfilingLock<T>(fn: () => Promise<T>): Promise<T> {
  if (profiling) {
    throw new BaseError(
      'DiagnosticsBusy',
      StatusCode.CONFLICT,
      true,
      'A profile is already running on this process',
    );
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
// The source header lets a bundle show which replica each file came from.
function attachment(res: express.Response, extension: string) {
  res
    .attachment(`api-${process.pid}.${extension}`)
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

router.get('/report', async (req, res, next) => {
  try {
    const body = await collect('report', async () => {
      // The report and each workers[] entry embed the full environment (Mongo
      // URI, API keys), so drop the key at every depth.
      const report: unknown = JSON.parse(
        JSON.stringify(process.report.getReport(), (key, value) =>
          key === 'environmentVariables' ? undefined : value,
        ),
      );
      return {
        codeVersion: CODE_VERSION,
        hostname: os.hostname(),
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        report,
      };
    });
    res.json(body);
  } catch (e) {
    next(e);
  }
});

router.post('/cpu-profile', validateSeconds, async (req, res, next) => {
  const signal = abortOnDisconnect(res);
  try {
    const seconds = req.query.seconds ?? DEFAULT_PROFILE_SECONDS;
    const profile = await collect(
      'cpu-profile',
      () =>
        withProfilingLock(() =>
          withInspector(async session => {
            await session.post('Profiler.enable');
            await session.post('Profiler.start');
            await sleep(seconds * 1000, undefined, { signal });
            const { profile } = await session.post('Profiler.stop');
            return profile;
          }),
        ),
      signal,
    );
    attachment(res, 'cpuprofile');
    res.json(profile);
  } catch (e) {
    // Nobody is left to answer, and a disconnect is not a server fault.
    if (signal.aborted) return;
    next(e);
  }
});

router.post('/heap-profile', validateSeconds, async (req, res, next) => {
  const signal = abortOnDisconnect(res);
  try {
    const seconds = req.query.seconds ?? DEFAULT_PROFILE_SECONDS;
    const profile = await collect(
      'heap-profile',
      () =>
        withProfilingLock(() =>
          withInspector(async session => {
            await session.post('HeapProfiler.startSampling');
            await sleep(seconds * 1000, undefined, { signal });
            const { profile } = await session.post('HeapProfiler.stopSampling');
            return profile;
          }),
        ),
      signal,
    );
    attachment(res, 'heapprofile');
    res.json(profile);
  } catch (e) {
    if (signal.aborted) return;
    next(e);
  }
});

router.post('/heap-snapshot', async (req, res, next) => {
  const signal = abortOnDisconnect(res);
  try {
    // Off by default: a snapshot pauses the event loop and can roughly double
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
