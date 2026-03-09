import { env } from 'next-runtime-env';

// ONLY USED IN LOCAL MODE
// ex: NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS='[{"id":"local","name":"Demo","host":"https://demo-ch.hyperdx.io","username":"demo","password":"demo"}]' NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES='[{"id":"l701179602","kind":"trace","name":"Demo Traces","connection":"local","from":{"databaseName":"default","tableName":"otel_traces"},"timestampValueExpression":"Timestamp","defaultTableSelectExpression":"Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName","serviceNameExpression":"ServiceName","eventAttributesExpression":"SpanAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"SpanName","durationExpression":"Duration","durationPrecision":9,"parentSpanIdExpression":"ParentSpanId","spanKindExpression":"SpanKind","spanNameExpression":"SpanName","logSourceId":"l-758211293","statusCodeExpression":"StatusCode","statusMessageExpression":"StatusMessage"},{"id":"l-758211293","kind":"log","name":"Demo Logs","connection":"local","from":{"databaseName":"default","tableName":"otel_logs"},"timestampValueExpression":"TimestampTime","defaultTableSelectExpression":"Timestamp, ServiceName, SeverityText, Body","serviceNameExpression":"ServiceName","severityTextExpression":"SeverityText","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"Body","traceSourceId":"l701179602"}]' yarn dev:local
export const HDX_LOCAL_DEFAULT_CONNECTIONS = env(
  'NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS',
);
export const HDX_LOCAL_DEFAULT_SOURCES = env(
  'NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES',
);
export const HDX_DISABLE_METADATA_FIELD_FETCH = env(
  'NEXT_PUBLIC_HDX_DISABLE_METADATA_FIELD_FETCH',
);

export const NODE_ENV = process.env.NODE_ENV as string;
export const HDX_API_KEY = process.env.HYPERDX_API_KEY as string; // for nextjs server
export const HDX_SERVICE_NAME =
  process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'hdx-oss-dev-app';
export const HDX_EXPORTER_ENABLED =
  (process.env.HDX_EXPORTER_ENABLED ?? 'true') === 'true';
export const HDX_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  'http://localhost:4318';
export const IS_CI = NODE_ENV === 'ci';
export const IS_DEV = NODE_ENV === 'development';
export const IS_PROD = NODE_ENV === 'production';

export const IS_OSS = process.env.NEXT_PUBLIC_IS_OSS ?? 'true' === 'true';
export const IS_LOCAL_MODE = //true;
  // @ts-ignore
  (process.env.NEXT_PUBLIC_IS_LOCAL_MODE ?? 'false') === 'true';
export const IS_CLICKHOUSE_BUILD =
  process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD === 'true';

// Features in development
export const IS_K8S_DASHBOARD_ENABLED = true;
export const IS_METRICS_ENABLED = true;
export const IS_MTVIEWS_ENABLED = false;
export const IS_SESSIONS_ENABLED = true;
