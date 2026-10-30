import { z } from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import {
  queryLabelNames,
  queryLabelValues,
} from '@/controllers/timeseriesEngine';

type PromqlBackend = 'prometheus' | 'clickhouse';

const PROMETHEUS_FETCH_TIMEOUT_MS = 30_000;

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

/**
 * Removes `user:pass@` from `url` and returns it as a Basic auth header. fetch
 * rejects a URL that carries credentials, so they cannot stay in the host.
 */
function takeBasicAuthHeader(url: URL): Record<string, string> {
  if (!url.username && !url.password) return {};
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = '';
  url.password = '';
  return {
    Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

const prometheusBodySchema = z.object({
  status: z.string(),
  data: z.unknown(),
  error: z.string().optional(),
});

const labelListSchema = z.array(z.string());

/**
 * GETs a Prometheus API path from an external Prometheus-compatible endpoint
 * and returns the response's `data`, checked against `dataSchema`. Errors name
 * only the origin and path: the host may carry credentials in its userinfo or
 * query string.
 */
async function fetchPrometheusData<T extends z.ZodTypeAny>(
  host: string,
  path: string,
  params: Record<string, string>,
  dataSchema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const url = joinPrometheusUpstreamUrl(host, path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const redactedTarget = `${url.origin}${url.pathname}`;
  const timeout = AbortSignal.timeout(PROMETHEUS_FETCH_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: takeBasicAuthHeader(url),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === 'TimeoutError'
        ? `Prometheus request to ${redactedTarget} timed out`
        : `Failed to reach Prometheus at ${redactedTarget}`,
    );
  }

  const body = prometheusBodySchema.safeParse(
    await resp.json().catch(() => undefined),
  );
  if (!resp.ok || !body.success || body.data.status !== 'success') {
    throw new Error(
      (body.success && body.data.error) ||
        `Prometheus at ${redactedTarget} returned HTTP ${resp.status}`,
    );
  }
  const data = dataSchema.safeParse(body.data.data);
  if (!data.success) {
    throw new Error(
      `Prometheus at ${redactedTarget} returned an unexpected response`,
    );
  }
  return data.data;
}

export type PromqlLabelCatalog = {
  backend: PromqlBackend;
  labelNames: string[];
  metricNames: string[];
};

/**
 * Lists the label names and metric names a PromQL source holds in
 * [startMs, endMs], at most `limit` of each. Returns `limit + 1` entries when
 * there are more, so callers can tell the list was cut.
 */
export async function getPromqlLabelCatalog({
  teamId,
  source,
  startMs,
  endMs,
  limit,
  signal,
}: {
  teamId: string;
  source: {
    connection: { toString(): string };
    from: { databaseName: string; tableName: string };
  };
  startMs: number;
  endMs: number;
  limit: number;
  signal?: AbortSignal;
}): Promise<PromqlLabelCatalog> {
  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    throw new Error('Connection not found');
  }

  if (connection.isPrometheusEndpoint) {
    const params = {
      start: String(startMs / 1000),
      end: String(endMs / 1000),
      limit: String(limit + 1),
    };
    const [labelNames, metricNames] = await Promise.all([
      fetchPrometheusData(
        connection.host,
        '/api/v1/labels',
        params,
        labelListSchema,
        signal,
      ),
      fetchPrometheusData(
        connection.host,
        '/api/v1/label/__name__/values',
        params,
        labelListSchema,
        signal,
      ),
    ]);
    return { backend: 'prometheus', labelNames, metricNames };
  }

  const args = {
    client: new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
      requestTimeout: PROMETHEUS_FETCH_TIMEOUT_MS,
    }),
    connectionId: connection.id,
    databaseName: source.from.databaseName,
    tableName: source.from.tableName,
    startMs,
    endMs,
    limit: limit + 1,
    signal,
  };
  const [labelNames, metricNames] = await Promise.all([
    queryLabelNames(args),
    queryLabelValues({ ...args, labelName: '__name__' }),
  ]);
  return { backend: 'clickhouse', labelNames, metricNames };
}
