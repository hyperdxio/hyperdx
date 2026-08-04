import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import express from 'express';
import { performance } from 'perf_hooks';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { getCounter, getHistogram } from '@/utils/instrumentation';
import logger from '@/utils/logger';

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
const PROMETHEUS_MAX_EXECUTION_SEC = 30;
const PROMETHEUS_MAX_RESULT_ROWS = '100000';
const PROMETHEUS_MAX_RESOLUTION = 11_000;
// Widest window /query_exemplars will proxy. Prometheus's exemplar store is a
// small circular buffer, so a wider range mostly costs a bigger streamed body
// for no extra markers — the chart's own thinning caps what's rendered anyway.
const PROMETHEUS_MAX_EXEMPLAR_WINDOW_SEC = 7 * 24 * 60 * 60;

// Forwards the response straight from the upstream Prometheus to the
// HyperDX client. Returns the HTTP status it wrote, so callers can record an
// error metric: this helper handles its own failures by writing 400/502/504 and
// returning normally, so a caller's `catch` never sees an upstream outage and
// would otherwise report zero errors while still recording duration. The response can be multi-megabyte (e.g. `/label/__name__/
// values` on a large Prometheus), so we avoid `await resp.json()` +
// `res.json(...)` which would parse + re-serialize the whole body in memory.
// Prometheus's native response shape (`{status, data}` / `{status, errorType,
// error}`) is already what HyperDX clients expect, so we forward the status
// code and content-type as-is.
async function proxyToPrometheus(
  upstreamHost: string,
  path: string,
  params: Record<string, string>,
  res: express.Response,
): Promise<number> {
  let url: URL;
  try {
    url = new URL(path, upstreamHost);
  } catch {
    res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: `Connection host is not a valid URL: ${JSON.stringify(upstreamHost)}`,
    });
    return 400;
  }
  for (const [k, v] of Object.entries(params)) {
    if (['connectionId', 'database', 'table'].includes(k)) continue;
    if (v != null) url.searchParams.set(k, v);
  }
  const target = url.toString();

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
        error: `Prometheus request to ${target} timed out after ${PROMETHEUS_PROXY_TIMEOUT_MS}ms`,
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
      error: `Failed to reach Prometheus at ${target} (${detail})`,
    });
    return 502;
  }

  res.status(upstreamResp.status);
  const contentType = upstreamResp.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);

  if (!upstreamResp.body) {
    res.end();
    return upstreamResp.status;
  }

  try {
    await pipeline(Readable.fromWeb(upstreamResp.body as any), res);
  } catch (err) {
    // Headers are already sent at this point — best we can do is destroy the
    // socket so the client sees a truncated response instead of a hung
    // connection.
    if (!res.writableEnded) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
    return 502;
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
function recordProxyOutcome(
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
        max_result_rows: PROMETHEUS_MAX_RESULT_ROWS,
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
        max_result_rows: PROMETHEUS_MAX_RESULT_ROWS,
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
// exemplars are read directly from the OTel metric tables' `Exemplars.*`
// columns in the app (via renderMetricExemplarsChartConfig), so there is no
// ClickHouse table function to call here — return an empty result instead.
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

      const status = await proxyToPrometheus(
        connection.host,
        '/api/v1/query_exemplars',
        { ...params, start: String(window.start) },
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
    const params = req.query as Record<string, string>;

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

    // Proxy to Prometheus if endpoint is set
    if (connection.isPrometheusEndpoint) {
      backend = 'prometheus';
      const status = await proxyToPrometheus(
        connection.host,
        `/api/v1/label/${labelName}/values`,
        params,
        res,
      );
      recordProxyOutcome(status, 'label_values', backend);
      return;
    }

    backend = 'clickhouse';
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

    const tagsQuery =
      labelName === '__name__'
        ? `SELECT DISTINCT metric_name AS val FROM timeSeriesTags({db:String}, {table:String}) ORDER BY val SETTINGS allow_experimental_time_series_table = 1`
        : `SELECT DISTINCT all_tags[{label:String}] AS val FROM timeSeriesTags({db:String}, {table:String}) WHERE mapContains(all_tags, {label:String}) ORDER BY val SETTINGS allow_experimental_time_series_table = 1`;

    const resp = await client.query({
      query: tagsQuery,
      query_params: { db: database, table, label: labelName },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
        max_execution_time: PROMETHEUS_MAX_EXECUTION_SEC,
        max_result_rows: PROMETHEUS_MAX_RESULT_ROWS,
      },
    });
    const json = await resp.json<any>();
    const values: string[] = json.data.map((r: any) => r.val);

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
