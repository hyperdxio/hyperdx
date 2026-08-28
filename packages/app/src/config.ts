import { env } from 'next-runtime-env';

// ONLY USED IN LOCAL MODE
// ex: NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS='[{"id":"local","name":"Demo","host":"https://demo-ch.hyperdx.io","username":"demo","password":"demo"}]' NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES='[{"id":"l701179602","kind":"trace","name":"Demo Traces","connection":"local","from":{"databaseName":"default","tableName":"otel_traces"},"timestampValueExpression":"Timestamp","defaultTableSelectExpression":"Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName","serviceNameExpression":"ServiceName","eventAttributesExpression":"SpanAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"SpanName","durationExpression":"Duration","durationPrecision":9,"parentSpanIdExpression":"ParentSpanId","spanKindExpression":"SpanKind","spanNameExpression":"SpanName","logSourceId":"l-758211293","statusCodeExpression":"StatusCode","statusMessageExpression":"StatusMessage"},{"id":"l-758211293","kind":"log","name":"Demo Logs","connection":"local","from":{"databaseName":"default","tableName":"otel_logs"},"timestampValueExpression":"Timestamp","defaultTableSelectExpression":"Timestamp, ServiceName, SeverityText, Body","serviceNameExpression":"ServiceName","severityTextExpression":"SeverityText","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"Body","traceSourceId":"l701179602"}]' yarn dev:local
export const HDX_LOCAL_DEFAULT_CONNECTIONS = env(
  'NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS',
);
export const HDX_LOCAL_DEFAULT_SOURCES = env(
  'NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES',
);
const NODE_ENV = process.env.NODE_ENV as string;
export const HDX_API_KEY = process.env.HYPERDX_API_KEY as string; // for nextjs server
export const HDX_SERVICE_NAME =
  process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'hdx-oss-dev-app';
export const HDX_EXPORTER_ENABLED =
  (process.env.HDX_EXPORTER_ENABLED ?? 'true') === 'true';

export function parseResourceAttributes(raw: string): Record<string, string> {
  return raw
    .split(',')
    .filter(Boolean)
    .reduce(
      (acc, pair) => {
        const idx = pair.indexOf('=');
        if (idx > 0) {
          acc[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(
            pair.slice(idx + 1),
          );
        }
        return acc;
      },
      {} as Record<string, string>,
    );
}

export const HDX_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
  'http://localhost:4318';
export const HDX_TRACES_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
export const HDX_METRICS_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
export const HDX_LOGS_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
export const IS_DEV = NODE_ENV === 'development';

export const IS_OSS = process.env.NEXT_PUBLIC_IS_OSS ?? 'true' === 'true';
export const IS_LOCAL_MODE = //true;
  (process.env.NEXT_PUBLIC_IS_LOCAL_MODE ?? 'false') === 'true';
export const IS_CLICKHOUSE_BUILD =
  process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD === 'true';
// Deployment path prefix, mirroring `basePath` in next.config.mjs. Needed
// anywhere an absolute URL is built for something outside the browser to call:
// `window.location.origin` alone drops the prefix, and the API is served under
// the same one as the UI.
export const BASE_PATH = process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH ?? '';
export const IS_NOINDEX = process.env.NEXT_PUBLIC_NOINDEX === 'true';

/** Time captured at module load, use this a stable fallback/default time value instead of Date.now() defined in each React component file */
// eslint-disable-next-line no-restricted-syntax
export const NOW = Date.now();

// Features in development
export const IS_K8S_DASHBOARD_ENABLED = true;
export const IS_METRICS_ENABLED = true;
export const IS_MTVIEWS_ENABLED = false;
export const IS_SESSIONS_ENABLED = true;
export const IS_PROMQL_ENABLED = env('NEXT_PUBLIC_ENABLE_PROMQL') === 'true';
// Alert detail page (/alerts/:id). Default off — currently enabled only in
// dev (.env.development) and CI (e2e webserver) while the feature bakes.
export const IS_ALERT_DETAILS_ENABLED =
  env('NEXT_PUBLIC_ENABLE_ALERT_DETAILS') === 'true';
// Not exported: IS_IAC_EXPORT_ENABLED below is the only gate callers should
// read. Leaving the raw flag importable re-opens the "forgot the local-mode
// check" mistake that folding the two together was meant to close.
const IS_IAC_HELPERS_ENABLED = true;
// Local mode has no API server behind it, so there is nothing for the
// Terraform provider to talk to. Single definition — the alerts, dashboard,
// search, and team-settings surfaces all read this one constant.
export const IS_IAC_EXPORT_ENABLED = IS_IAC_HELPERS_ENABLED && !IS_LOCAL_MODE;
