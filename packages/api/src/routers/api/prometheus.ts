import express from 'express';
import { performance } from 'perf_hooks';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import z from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import {
  PROMETHEUS_MAX_EXECUTION_SEC,
  PROMETHEUS_MAX_RESULT_ROWS,
  queryLabelValues,
} from '@/controllers/timeseriesEngine';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { getCounter, getHistogram } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

// The proxy handlers catch their own errors and return Prometheus-shaped 4xx
// bodies, so failures never reach the API error middleware. Track them here
// instead. `endpoint` and `backend` are bounded enums (see
// agent_docs/observability.md), never raw queries.
type PrometheusBackend = 'prometheus' | 'clickhouse' | 'unknown';

const prometheusQueryDuration = getHistogram(
  'hyperdx.prometheus.query.duration_ms',
  {
    description:
      'Duration of a Prometheus-compatible proxy request, labeled by endpoint and backend.',
    unit: 'ms',
  },
);
const prometheusQueryErrors = getCounter('hyperdx.prometheus.query_errors', {
  description:
    'Count of Prometheus-compatible proxy requests that failed, labeled by endpoint and backend.',
});

// Accept URL-encoded form bodies (Prometheus standard) and JSON
router.use(express.urlencoded({ extended: true }));

// Every response from this router either streams a member-configured upstream or
// echoes caller-supplied text back in an error body. Set here rather than in the
// proxy helper so the handlers' own catch blocks are covered too.
router.use((_req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  next();
});

// --------------------------
// Param parsing helpers
// --------------------------

/** Parse a Prometheus timestamp: RFC3339 string or unix seconds (float) */
export function parseTimestamp(value: string | number): number {
  if (typeof value === 'number') return value;
  const num = Number(value);
  if (!isNaN(num)) return num;
  const date = new Date(value);
  if (isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return date.getTime() / 1000;
}

/** Parse a Prometheus duration string (e.g. "15s", "1m", "1h") to seconds */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;
  const num = Number(value);
  if (!isNaN(num)) return num;
  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const n = parseFloat(match[1]);
  switch (match[2]) {
    case 'ms':
      return n / 1000;
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    case 'w':
      return n * 604800;
    case 'y':
      return n * 31536000;
    default:
      return n;
  }
}

/** Merge query params and body (supports both GET and POST) */
function getParams(req: express.Request): Record<string, string> {
  return {
    ...(req.query as Record<string, string>),
    ...(req.body as Record<string, string>),
  };
}

// --------------------------
// Prometheus-compatible response types
// --------------------------

type PrometheusMetric = Record<string, string>;
type PrometheusMatrixResult = {
  metric: PrometheusMetric;
  values: [number, string][];
};
type PrometheusVectorResult = {
  metric: PrometheusMetric;
  value: [number, string];
};

// --------------------------
// ClickHouse → Prometheus response formatters
// --------------------------

export function formatMatrixResponse(
  rows: { tags: [string, string][]; time_series: [string, number][] }[],
): PrometheusMatrixResult[] {
  return rows.map(row => {
    const metric: PrometheusMetric = {};
    for (const [key, value] of row.tags) {
      metric[key] = value;
    }
    const values: [number, string][] = row.time_series.map(
      ([timestamp, value]) => {
        const ts =
          typeof timestamp === 'string'
            ? new Date(timestamp).getTime() / 1000
            : Number(timestamp);
        return [ts, String(value)];
      },
    );
    return { metric, values };
  });
}

export function formatVectorResponse(
  rows: { tags: [string, string][]; timestamp: string; value: number }[],
): PrometheusVectorResult[] {
  return rows.map(row => {
    const metric: PrometheusMetric = {};
    for (const [key, value] of row.tags) {
      metric[key] = value;
    }
    const ts =
      typeof row.timestamp === 'string'
        ? new Date(row.timestamp).getTime() / 1000
        : Number(row.timestamp);
    return { metric, value: [ts, String(row.value)] };
  });
}

// --------------------------
// Prometheus proxy (for real Prometheus backends)
// --------------------------

const PROMETHEUS_PROXY_TIMEOUT_MS = 90_000;
const PROMETHEUS_CH_TIMEOUT_MS = 30_000;
const PROMETHEUS_MAX_RESOLUTION = 11_000;
// Widest window /query_exemplars will proxy. Prometheus's exemplar store is a
// small circular buffer, so a wider range mostly costs a bigger streamed body
// for no extra markers — the chart's own thinning caps what's rendered anyway.
export const PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC = 7 * 24 * 60 * 60;

/**
 * Whether a rejection from streaming the upstream body means the client hung up
 * rather than the backend failing.
 *
 * The error code is the only usable signal. `pipeline` destroys every stream it
 * touches before rejecting — the destination included, whichever end actually
 * failed — so `res.destroyed` is true either way and testing it would classify
 * every upstream fault as a user cancellation. Node also resolves the race in
 * our favour: a real error always beats the ERR_STREAM_PREMATURE_CLOSE that the
 * cascading destroy raises, never the other way round.
 */
export function isClientDisconnect(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE'
  );
}

/**
 * Join a Connection host with an absolute Prometheus API path.
 *
 * `new URL('/api/v1/query_range', 'http://host:8481/select/0/prometheus')`
 * discards `/select/0/prometheus` because an absolute path replaces the base
 * pathname. VictoriaMetrics cluster (and any Prometheus-compatible server
 * mounted under a prefix) needs that prefix kept. Host userinfo, query, and
 * hash are left untouched.
 *
 * `path` must be an absolute path (every call site passes a literal starting
 * with `/`) -- this is not a general-purpose URL joiner.
 *
 * @see https://github.com/hyperdxio/hyperdx/issues/3046
 */
export function joinPrometheusUpstreamUrl(
  upstreamHost: string,
  path: string,
): URL {
  const url = new URL(upstreamHost);
  // `new URL('prometheus:9090')` succeeds with an opaque path (`prometheus:`
  // scheme). The pathname setter is a no-op there, so without this guard the
  // helper would return the host unchanged, `fetch` would fail, and the proxy
  // would 502 / increment query_errors for a user misconfiguration. Same check
  // as clickhouseProxy.ts.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Connection host must be http(s)');
  }
  // Strip ALL trailing slashes, not just one -- a host saved with a doubled
  // trailing slash (e.g. `http://prom:9090//`) would otherwise leave a `//`
  // in the joined path, which most servers treat as a distinct (404) path.
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${path}`;
  return url;
}

// Forwards the response straight from the upstream Prometheus to the
// HyperDX client. Returns the HTTP status it wrote, so callers can record an
// error metric: this helper handles its own failures by writing 400/502/504 and
// returning normally, so a caller's `catch` never sees an upstream outage and
// would otherwise report zero errors while still recording duration. The response can be multi-megabyte (e.g. `/label/__name__/
// values` on a large Prometheus), so we avoid `await resp.json()` +
// `res.json(...)` which would parse + re-serialize the whole body in memory.
// Prometheus's native response shape (`{status, data}` / `{status, errorType,
// error}`) is already what HyperDX clients expect, so we forward the status code
// as-is — but never the content-type, which is always relabelled (see below).
async function proxyToPrometheus(
  upstreamHost: string,
  path: string,
  params: Record<string, string | string[] | undefined>,
  res: express.Response,
): Promise<number> {
  let url: URL;
  try {
    url = joinPrometheusUpstreamUrl(upstreamHost, path);
  } catch (err) {
    // Redact userinfo the same way `redactedTarget` does below -- this branch
    // runs before `url` exists, so it can't reuse that helper, but the raw
    // host is still shown to the browser and may carry `user:pw@`. Surface
    // the caught error's own message (e.g. the scheme guard's "Connection
    // host must be http(s)") instead of a single generic string, so a wrong
    // scheme isn't reported identically to a host that fails to parse at all.
    const redactedHost = upstreamHost.replace(/:\/\/[^/@]*@/, '://');
    res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: `Invalid Connection host ${JSON.stringify(redactedHost)}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return 400;
  }
  // Every param the request supplies wins outright, including repeatable
  // ones like `match[]` -- so a Connection host can never silently override
  // (or, for `match[]`, narrow) a value the caller or this proxy explicitly
  // sets. A host-only param the request never mentions (e.g. VictoriaMetrics
  // `?extra_label=namespace%3Dprod` pinning a tenant scope) is left as-is.
  for (const [k, v] of Object.entries(params)) {
    if (['connectionId', 'database', 'table'].includes(k)) continue;
    if (v == null) continue;
    // Clear any host-pinned value at this key first: for a repeatable param
    // this prevents an `append` from leaving the host's value(s) alongside
    // the request's rather than replacing them.
    url.searchParams.delete(k);
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }
  const target = url.toString();

  // A connection host may carry basic-auth credentials (`http://user:pw@host`),
  // and the error bodies below are shown in the browser. Strip them for display
  // only — `target` itself still needs them to authenticate.
  const redactedTarget = (() => {
    const safe = new URL(url);
    safe.username = '';
    safe.password = '';
    return safe.toString();
  })();

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(target, {
      signal: AbortSignal.timeout(PROMETHEUS_PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      res.status(504).json({
        status: 'error',
        errorType: 'timeout',
        error: `Prometheus request to ${redactedTarget} timed out after ${PROMETHEUS_PROXY_TIMEOUT_MS}ms`,
      });
      return 504;
    }
    // Node's fetch wraps the real network error (ECONNREFUSED, ENOTFOUND, TLS,
    // …) in `.cause`. Without unwrapping it the client only sees a useless
    // `"fetch failed"`.
    const cause = err instanceof Error ? (err.cause ?? err) : err;
    let detail: string;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      const c = cause as { code: string; message?: string };
      detail = c.message ? `${c.code}: ${c.message}` : c.code;
    } else if (cause instanceof Error) {
      detail = cause.message;
    } else {
      detail = String(cause);
    }
    res.status(502).json({
      status: 'error',
      errorType: 'unavailable',
      error: `Failed to reach Prometheus at ${redactedTarget} (${detail})`,
    });
    return 502;
  }

  res.status(upstreamResp.status);

  // The connection host is member-configured, so its response is untrusted output
  // on our own origin: the app same-origin-proxies /api/*, and the session cookie
  // is sameSite lax. Forwarding the upstream content-type would let a text/html
  // body render as script here, so it is never forwarded — every response is
  // relabelled, which keeps a genuine Prometheus error body readable while making
  // a hostile one inert.
  //
  // An allowlist was tried first and is not worth it. Prometheus only ever
  // answers application/json, so passing anything through buys nothing, and
  // getting the check right is easy to botch: `Content-Type: application/json,
  // text/html` (which is also what Headers.get() produces from two separate
  // headers) passes a prefix-anchored JSON test, while the browser's MIME
  // extraction keeps the *last* essence — text/html.
  res.setHeader('content-type', 'application/json; charset=utf-8');

  if (!upstreamResp.body) {
    res.end();
    return upstreamResp.status;
  }

  try {
    await pipeline(Readable.fromWeb(upstreamResp.body as any), res);
  } catch (err) {
    // A client that navigates away mid-body makes `pipeline` reject too. That is
    // not a backend failure, and returning 502 for it would have the caller count
    // ordinary user cancellations against Prometheus's health. Report the
    // upstream's own status in that case; only a genuine stream failure is 502.
    const clientGone = isClientDisconnect(err);

    // Headers are already sent at this point — best we can do is destroy the
    // socket so the client sees a truncated response instead of a hung
    // connection.
    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
    return clientGone ? upstreamResp.status : 502;
  }
  return upstreamResp.status;
}

/**
 * Records an error for a proxied response that failed server-side.
 * proxyToPrometheus never throws, so this is the only place the error counter
 * gets incremented on the proxy path.
 *
 * 5xx only. An upstream 4xx is almost always a malformed PromQL expression the
 * user typed, and counting those would make this counter track user typos rather
 * than backend health — which is what alerts and SLOs read it for. The helper's
 * own failure statuses (502 unreachable, 504 timeout) are 5xx and so are counted.
 */
export function recordProxyOutcome(
  status: number,
  endpoint: string,
  backend: PrometheusBackend,
) {
  if (status >= 500) {
    prometheusQueryErrors.add(1, { endpoint, backend });
  }
}

// --------------------------
// GET|POST /query_range
// --------------------------

const queryRangeHandler: express.RequestHandler = async (req, res) => {
  const startedAt = performance.now();
  let backend: PrometheusBackend = 'unknown';
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const params = getParams(req);

    const query = params.query;
    if (!query) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: query',
      });
    }

    const connectionId = params.connectionId;
    if (!connectionId) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: connectionId',
      });
    }

    // Resolve connection to determine backend (Prometheus or ClickHouse)
    const connection = await getConnectionById(
      teamId.toString(),
      connectionId,
      true,
    );
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    // If the connection points at a Prometheus-compatible endpoint, proxy
    // directly to connection.host instead of running a ClickHouse query.
    if (connection.isPrometheusEndpoint) {
      backend = 'prometheus';
      const status = await proxyToPrometheus(
        connection.host,
        '/api/v1/query_range',
        params,
        res,
      );
      recordProxyOutcome(status, 'query_range', backend);
      return;
    }

    // Otherwise, use ClickHouse prometheusQuery()
    backend = 'clickhouse';
    const start = parseTimestamp(params.start);
    const end = parseTimestamp(params.end);
    const step = parseDuration(params.step ?? '60s');
    const database = params.database ?? 'default';
    const table = params.table;
    if (!table) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: `table parameter required for querying clickhouse via promql`,
      });
    }

    if (step <= 0 || (end - start) / step > PROMETHEUS_MAX_RESOLUTION) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: `exceeded maximum resolution of ${PROMETHEUS_MAX_RESOLUTION.toLocaleString('en-US')} points per timeseries. Try decreasing the query resolution (?step=XX)`,
      });
    }

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: PROMETHEUS_CH_TIMEOUT_MS,
    });

    const startMs = Math.floor(start * 1000);
    const endMs = Math.floor(end * 1000);
    const stepSec = Math.max(Math.floor(step), 1);

    const resp = await client.query({
      query: `SELECT tags, time_series FROM prometheusQueryRange({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({startMs:Int64}), fromUnixTimestamp64Milli({endMs:Int64}), toIntervalSecond({stepSec:UInt32})) SETTINGS allow_experimental_time_series_table = 1`,
      query_params: {
        db: database,
        table,
        expr: query,
        startMs,
        endMs,
        stepSec,
      },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
        max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
        max_result_rows: String(PROMETHEUS_MAX_RESULT_ROWS),
      },
    });

    const json = await resp.json<any>();
    const result = formatMatrixResponse(json.data);

    return res.json({
      status: 'success',
      data: {
        resultType: 'matrix',
        result,
      },
    });
  } catch (e) {
    prometheusQueryErrors.add(1, { endpoint: 'query_range', backend });
    logger.error(e, 'Prometheus query_range error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    prometheusQueryDuration.record(performance.now() - startedAt, {
      endpoint: 'query_range',
      backend,
    });
  }
};
router.get('/query_range', queryRangeHandler);
router.post('/query_range', queryRangeHandler);

// --------------------------
// GET|POST /query
// --------------------------

const queryHandler: express.RequestHandler = async (req, res) => {
  const startedAt = performance.now();
  let backend: PrometheusBackend = 'unknown';
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const params = getParams(req);

    const query = params.query;
    if (!query) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: query',
      });
    }

    const connectionId = params.connectionId;
    if (!connectionId) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: connectionId',
      });
    }

    const connection = await getConnectionById(
      teamId.toString(),
      connectionId,
      true,
    );
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    if (connection.isPrometheusEndpoint) {
      backend = 'prometheus';
      const status = await proxyToPrometheus(
        connection.host,
        '/api/v1/query',
        params,
        res,
      );
      recordProxyOutcome(status, 'query', backend);
      return;
    }

    backend = 'clickhouse';
    const time = params.time ? parseTimestamp(params.time) : undefined;
    const database = params.database ?? 'default';
    const table = params.table;
    if (!table) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: `table parameter required for querying clickhouse via promql`,
      });
    }

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: PROMETHEUS_CH_TIMEOUT_MS,
    });

    const evalMs = time ? Math.floor(time * 1000) : Date.now();

    const resp = await client.query({
      query: `SELECT tags, timestamp, value FROM prometheusQuery({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({evalMs:Int64})) SETTINGS allow_experimental_time_series_table = 1`,
      query_params: { db: database, table, expr: query, evalMs },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
        max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
        max_result_rows: String(PROMETHEUS_MAX_RESULT_ROWS),
      },
    });

    const json = await resp.json<any>();
    const result = formatVectorResponse(json.data);

    return res.json({
      status: 'success',
      data: {
        resultType: 'vector',
        result,
      },
    });
  } catch (e) {
    prometheusQueryErrors.add(1, { endpoint: 'query', backend });
    logger.error(e, 'Prometheus query error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    prometheusQueryDuration.record(performance.now() - startedAt, {
      endpoint: 'query',
      backend,
    });
  }
};
router.get('/query', queryHandler);
router.post('/query', queryHandler);

/**
 * Resolve the exemplar window a /query_exemplars request should be proxied with.
 *
 * Returns either the bounded window or the reason it is unusable, so the handler
 * stays a thin translation to HTTP and this logic can be tested without a route.
 * Over-wide windows are narrowed rather than rejected: a 30d dashboard range is an
 * ordinary request, and Prometheus keeps exemplars in a small recent buffer, so
 * the older part has nothing to return anyway.
 */
export function resolveExemplarWindow(
  rawStart: string | undefined,
  rawEnd: string | undefined,
  maxWindowSec = PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC,
): { start: number; end: number } | { error: string } {
  const parse = (v: string | undefined) => {
    if (v == null || v === '') return NaN;
    try {
      return parseTimestamp(v);
    } catch {
      return NaN;
    }
  };
  const start = parse(rawStart);
  const end = parse(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { error: 'invalid or missing start/end parameters' };
  }
  return { start: Math.max(start, end - maxWindowSec), end };
}

// --------------------------
// GET|POST /query_exemplars
// --------------------------

// Native Prometheus exposes exemplars via /api/v1/query_exemplars. We proxy
// straight through for Prometheus-backed connections. ClickHouse-backed metric
// exemplars come from the OTel metric tables' own `Exemplars.*` columns, read by
// the chart query the app already issues — there is no ClickHouse table function
// to call here, so this returns an empty result rather than a second query.
const queryExemplarsHandler: express.RequestHandler = async (req, res) => {
  const startedAt = performance.now();
  let backend: PrometheusBackend = 'unknown';
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const params = getParams(req);

    const query = params.query;
    if (!query) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: query',
      });
    }

    const connectionId = params.connectionId;
    if (!connectionId) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'missing required parameter: connectionId',
      });
    }

    // No `selectPassword` — neither branch builds a ClickhouseClient, so there
    // is no reason to pull the connection secret into request scope.
    const connection = await getConnectionById(teamId.toString(), connectionId);
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    if (connection.isPrometheusEndpoint) {
      backend = 'prometheus';

      // Bound the requested window before proxying. Unlike /query_range there is
      // no `step` to cap the result size with, and Prometheus's /query_exemplars
      // takes no limit parameter — the window is the only lever, and the response
      // streams through this process. Parsed (not just forwarded) so a malformed
      // timestamp fails here rather than upstream.
      //
      // Deliberately inside this branch: the ClickHouse-backed branch below never
      // reaches Prometheus and answers with an empty success, so bounding it there
      // would turn a healthy wide-range chart into a 400 (and light up the chart's
      // exemplar error indicator) for a request that does no upstream work.
      //
      // parseTimestamp throws on a missing/unparseable value; a bad client param
      // is a 400, not an upstream error, so it is resolved here, not in the catch.
      const window = resolveExemplarWindow(params.start, params.end);
      if ('error' in window) {
        return res.status(400).json({
          status: 'error',
          errorType: 'bad_data',
          error: window.error,
        });
      }

      // Both bounds come from the resolved window, not just `start`. Forwarding
      // the raw `end` would let a value this function accepts but Prometheus
      // rejects — leading whitespace, a `0x` literal — be declared valid here
      // and then 400 upstream.
      const status = await proxyToPrometheus(
        connection.host,
        '/api/v1/query_exemplars',
        {
          ...params,
          start: String(window.start),
          end: String(window.end),
        },
        res,
      );
      recordProxyOutcome(status, 'query_exemplars', backend);
      return;
    }

    // ClickHouse-backed PromQL: no native exemplar table function. Exemplars
    // for structured metric charts are fetched app-side from the metric table.
    backend = 'clickhouse';
    return res.json({ status: 'success', data: [] });
  } catch (e) {
    prometheusQueryErrors.add(1, { endpoint: 'query_exemplars', backend });
    logger.error(e, 'Prometheus query_exemplars error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    prometheusQueryDuration.record(performance.now() - startedAt, {
      endpoint: 'query_exemplars',
      backend,
    });
  }
};
router.get('/query_exemplars', queryExemplarsHandler);
router.post('/query_exemplars', queryExemplarsHandler);

// --------------------------
// GET /label/:name/values
// --------------------------

// Prometheus label-name grammar — used to reject anything that could
// influence the upstream URL we're about to construct (e.g. embedded `?`,
// `#`, or percent-encoded slashes that Express's param decoder lets through).
// https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels
const PROMETHEUS_LABEL_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/**
 * Prometheus timestamps are either RFC3339 strings or unix seconds.
 * This schema coerces them to unix seconds.
 *
 * `?start=` with no value means the same as no `start` at all. Without the
 * empty-string arm it would not: `parseTimestamp('')` goes through `Number('')`,
 * which is 0, pinning the bound to the epoch.
 */
const prometheusTimestampSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    if (v === '') return undefined;
    try {
      return parseTimestamp(v);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: `invalid timestamp, expected RFC3339 or unix seconds`,
      });
      return z.NEVER;
    }
  });

/**
 * Prometheus's series selector, spelled `match[]` and repeatable. Express's query
 * parser drops the brackets, so both `match[]=up` and `match=up` land on a
 * `match` key and a repeated one arrives as an array. The selectors themselves
 * are never interpreted here — only Prometheus can — so an empty one is treated
 * as absent rather than forwarded for upstream to reject.
 */
const prometheusMatchSchema = z
  .union([z.string(), z.array(z.string())])
  .transform(v => {
    const selectors = (Array.isArray(v) ? v : [v]).filter(m => m !== '');
    return selectors.length ? selectors : undefined;
  });

const labelValuesRequestQuerySchema = z
  .object({
    connectionId: objectIdSchema,
    start: prometheusTimestampSchema.optional(),
    end: prometheusTimestampSchema.optional(),
    match: prometheusMatchSchema.optional(),
    database: z.string().optional(),
    table: z.string().optional(),
    limit: z.preprocess(
      v => (v === '' ? undefined : v),
      z.coerce.number().int().nonnegative().optional(),
    ),
  })
  .superRefine((params, ctx) => {
    if (
      params.start != null &&
      params.end != null &&
      params.end < params.start
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'end timestamp must not be before start time',
      });
    }
  });

// A Prometheus error body carries one human-readable string, so zod's own
// `message` — a JSON dump of the issue list — is not usable as-is.
function formatQueryParamIssues(error: z.ZodError): string {
  return error.issues
    .map(issue =>
      issue.path.length
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    )
    .join(', ');
}

router.get('/label/:name/values', async (req, res) => {
  const startedAt = performance.now();
  let backend: PrometheusBackend = 'unknown';
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const labelName = req.params.name;
    if (!PROMETHEUS_LABEL_NAME.test(labelName)) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Invalid label name',
      });
    }

    const parseResult = labelValuesRequestQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: formatQueryParamIssues(parseResult.error),
      });
    }

    const params = parseResult.data;
    const { connectionId, start, end, limit, match } = params;
    const connection = await getConnectionById(
      teamId.toString(),
      connectionId,
      true,
    );
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    // Proxy to Prometheus if endpoint is set
    if (connection.isPrometheusEndpoint) {
      backend = 'prometheus';
      const status = await proxyToPrometheus(
        connection.host,
        `/api/v1/label/${labelName}/values`,
        {
          ...(start != null ? { start: String(start) } : {}),
          ...(end != null ? { end: String(end) } : {}),
          ...(limit ? { limit: String(limit) } : {}),
          // Restored under the name Prometheus expects
          ...(match != null ? { 'match[]': match } : {}),
        },
        res,
      );
      recordProxyOutcome(status, 'label_values', backend);
      return;
    }

    backend = 'clickhouse';

    // TODO: Support `match[]` for ClickHouse-Timeseries engine path
    if (match != null) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error:
          'match[] is not supported for ClickHouse-backed PromQL connections',
      });
    }

    const database = params.database ?? 'default';
    const table = params.table;
    if (!table) {
      return res.status(400).json({
        status: 'error',
        errorType: 'bad_data',
        error: `table parameter required for querying clickhouse via promql`,
      });
    }

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: PROMETHEUS_CH_TIMEOUT_MS,
    });

    const startMs = start != null ? Math.floor(start * 1000) : undefined;
    const endMs = end != null ? Math.ceil(end * 1000) : undefined;
    const values = await queryLabelValues({
      client,
      labelName,
      connectionId: connection.id,
      databaseName: database,
      tableName: table,
      startMs,
      endMs,
      limit,
    });

    return res.json({ status: 'success', data: values });
  } catch (e) {
    prometheusQueryErrors.add(1, { endpoint: 'label_values', backend });
    logger.error(e, 'Prometheus label values error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    prometheusQueryDuration.record(performance.now() - startedAt, {
      endpoint: 'label_values',
      backend,
    });
  }
});

export default router;
