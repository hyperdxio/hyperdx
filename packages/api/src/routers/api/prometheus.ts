import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import express from 'express';
import { performance } from 'perf_hooks';

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

const PROMETHEUS_PROXY_TIMEOUT_MS = 30_000;
const PROMETHEUS_CH_TIMEOUT_MS = 30_000;
const PROMETHEUS_MAX_EXECUTION_SEC = 30;
const PROMETHEUS_MAX_RESULT_ROWS = '100000';
const PROMETHEUS_MAX_RESOLUTION = 11_000;

async function proxyToPrometheus(
  prometheusEndpoint: string,
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const url = new URL(path, prometheusEndpoint);
  for (const [k, v] of Object.entries(params)) {
    if (['connectionId', 'database', 'table'].includes(k)) continue;
    if (v != null) url.searchParams.set(k, v);
  }
  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(PROMETHEUS_PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(
        `Prometheus request timed out after ${PROMETHEUS_PROXY_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Prometheus returned ${resp.status}: ${text}`);
  }
  return resp.json();
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

    // If connection has a Prometheus endpoint, proxy directly
    if (connection.prometheusEndpoint) {
      backend = 'prometheus';
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        '/api/v1/query_range',
        params,
      );
      return res.json(result);
    }

    // Otherwise, use ClickHouse prometheusQuery()
    backend = 'clickhouse';
    const start = parseTimestamp(params.start);
    const end = parseTimestamp(params.end);
    const step = parseDuration(params.step ?? '60s');
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

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

    if (connection.prometheusEndpoint) {
      backend = 'prometheus';
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        '/api/v1/query',
        params,
      );
      return res.json(result);
    }

    backend = 'clickhouse';
    const time = params.time ? parseTimestamp(params.time) : undefined;
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

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

// --------------------------
// GET /label/:name/values
// --------------------------

router.get('/label/:name/values', async (req, res) => {
  const startedAt = performance.now();
  let backend: PrometheusBackend = 'unknown';
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const labelName = req.params.name;
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
    if (connection.prometheusEndpoint) {
      backend = 'prometheus';
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        `/api/v1/label/${labelName}/values`,
        params,
      );
      return res.json(result);
    }

    backend = 'clickhouse';
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

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
