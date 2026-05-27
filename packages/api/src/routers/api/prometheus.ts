import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import express from 'express';

import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import logger from '@/utils/logger';

const router = express.Router();

// Accept URL-encoded form bodies (Prometheus standard) and JSON
router.use(express.urlencoded({ extended: true }));

// --------------------------
// Param parsing helpers
// --------------------------

/** Parse a Prometheus timestamp: RFC3339 string or unix seconds (float) */
function parseTimestamp(value: string | number): number {
  if (typeof value === 'number') return value;
  const num = Number(value);
  if (!isNaN(num)) return num;
  const date = new Date(value);
  if (isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return date.getTime() / 1000;
}

/** Parse a Prometheus duration string (e.g. "15s", "1m", "1h") to seconds */
function parseDuration(value: string | number): number {
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

function formatMatrixResponse(
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

function formatVectorResponse(
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

async function proxyToPrometheus(
  prometheusEndpoint: string,
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const url = new URL(path, prometheusEndpoint);
  for (const [k, v] of Object.entries(params)) {
    // Skip HyperDX-specific params
    if (['connectionId', 'database', 'table'].includes(k)) continue;
    if (v != null) url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString());
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
    const connection = await getConnectionById(teamId.toString(), connectionId);
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    // If connection has a Prometheus endpoint, proxy directly
    if (connection.prometheusEndpoint) {
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        '/api/v1/query_range',
        params,
      );
      return res.json(result);
    }

    // Otherwise, use ClickHouse prometheusQuery()
    const start = parseTimestamp(params.start);
    const end = parseTimestamp(params.end);
    const step = parseDuration(params.step ?? '60s');
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    const durationSec = Math.max(Math.floor(end - start), 60);
    const rangeExpr = `(${query})[${durationSec}s:${Math.floor(step)}s]`;
    const endMs = Math.floor(end * 1000);

    const resp = await client.query({
      query: `SELECT tags, time_series FROM prometheusQuery({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({endMs:Int64})) SETTINGS allow_experimental_time_series_table = 1`,
      query_params: { db: database, table, expr: rangeExpr, endMs },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
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
    logger.error(e, 'Prometheus query_range error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
router.get('/query_range', queryRangeHandler);
router.post('/query_range', queryRangeHandler);

// --------------------------
// GET|POST /query
// --------------------------

const queryHandler: express.RequestHandler = async (req, res) => {
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

    const connection = await getConnectionById(teamId.toString(), connectionId);
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    if (connection.prometheusEndpoint) {
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        '/api/v1/query',
        params,
      );
      return res.json(result);
    }

    const time = params.time ? parseTimestamp(params.time) : undefined;
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    const evalMs = time ? Math.floor(time * 1000) : Date.now();

    const resp = await client.query({
      query: `SELECT tags, timestamp, value FROM prometheusQuery({db:String}, {table:String}, {expr:String}, fromUnixTimestamp64Milli({evalMs:Int64})) SETTINGS allow_experimental_time_series_table = 1`,
      query_params: { db: database, table, expr: query, evalMs },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
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
    logger.error(e, 'Prometheus query error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
router.get('/query', queryHandler);
router.post('/query', queryHandler);

// --------------------------
// GET /label/:name/values
// --------------------------

router.get('/label/:name/values', async (req, res) => {
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

    const connection = await getConnectionById(teamId.toString(), connectionId);
    if (!connection) {
      return res.status(404).json({
        status: 'error',
        errorType: 'bad_data',
        error: 'Connection not found',
      });
    }

    // Proxy to Prometheus if endpoint is set
    if (connection.prometheusEndpoint) {
      const result = await proxyToPrometheus(
        connection.prometheusEndpoint,
        `/api/v1/label/${labelName}/values`,
        params,
      );
      return res.json(result);
    }

    // ClickHouse: query inner TimeSeries tags table
    const database = params.database ?? 'default';
    const table = params.table ?? 'otel_metrics_ts';

    const client = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    // Find the inner tags table for the TimeSeries table
    const tagsResp = await client.query({
      query: `SELECT name FROM system.tables WHERE database = {db:String} AND name LIKE concat('.inner_id.tags.', (SELECT toString(uuid) FROM system.tables WHERE database = {db:String} AND name = {table:String}))`,
      query_params: { db: database, table },
      format: 'JSON',
      clickhouse_settings: {
        allow_experimental_time_series_table: 1,
      },
    });
    const tagsJson = await tagsResp.json<any>();
    const tagsTableName = tagsJson.data?.[0]?.name;

    if (!tagsTableName) {
      return res.json({ status: 'success', data: [] });
    }

    let values: string[];
    if (labelName === '__name__') {
      const resp = await client.query({
        query: `SELECT DISTINCT metric_name FROM {tagsTable:Identifier} ORDER BY metric_name`,
        query_params: { tagsTable: tagsTableName },
        format: 'JSON',
      });
      const json = await resp.json<any>();
      values = json.data.map((r: any) => r.metric_name);
    } else {
      const resp = await client.query({
        query: `SELECT DISTINCT all_tags[{label:String}] AS val FROM {tagsTable:Identifier} WHERE mapContains(all_tags, {label:String}) ORDER BY val`,
        query_params: { tagsTable: tagsTableName, label: labelName },
        format: 'JSON',
      });
      const json = await resp.json<any>();
      values = json.data.map((r: any) => r.val);
    }

    return res.json({ status: 'success', data: values });
  } catch (e) {
    logger.error(e, 'Prometheus label values error');
    return res.status(400).json({
      status: 'error',
      errorType: 'bad_data',
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
