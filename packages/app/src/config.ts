import getConfig from 'next/config';

const { serverRuntimeConfig, publicRuntimeConfig } = getConfig();

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:8000'; // NEXT_PUBLIC_SERVER_URL can be empty string

export const CLICKHOUSE_HOST = '/api/clickhouse-proxy';

// ONLY USED IN LOCAL MODE
// ex: HDX_LOCAL_DEFAULT_CONNECTIONS='[{"id":"local","name":"Demo","host":"https://demo-ch.hyperdx.io","username":"demo","password":"demo"}]' HDX_LOCAL_DEFAULT_SOURCES='[{"id":"l701179602","kind":"trace","name":"Demo Traces","connection":"local","from":{"databaseName":"default","tableName":"otel_traces"},"timestampValueExpression":"Timestamp","defaultTableSelectExpression":"Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName","serviceNameExpression":"ServiceName","eventAttributesExpression":"SpanAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"SpanName","durationExpression":"Duration","durationPrecision":9,"parentSpanIdExpression":"ParentSpanId","spanKindExpression":"SpanKind","spanNameExpression":"SpanName","logSourceId":"l-758211293","statusCodeExpression":"StatusCode","statusMessageExpression":"StatusMessage"},{"id":"l-758211293","kind":"log","name":"Demo Logs","connection":"local","from":{"databaseName":"default","tableName":"otel_logs"},"timestampValueExpression":"TimestampTime","defaultTableSelectExpression":"Timestamp, ServiceName, SeverityText, Body","serviceNameExpression":"ServiceName","severityTextExpression":"SeverityText","eventAttributesExpression":"LogAttributes","resourceAttributesExpression":"ResourceAttributes","traceIdExpression":"TraceId","spanIdExpression":"SpanId","implicitColumnExpression":"Body","traceSourceId":"l701179602"}]' yarn dev:local
export const HDX_LOCAL_DEFAULT_CONNECTIONS =
  publicRuntimeConfig.hdxLocalDefaultConnections;
export const HDX_LOCAL_DEFAULT_SOURCES =
  publicRuntimeConfig.hdxLocalDefaultSources;

export const HDX_API_KEY = process.env.HYPERDX_API_KEY as string; // for nextjs server
export const HDX_SERVICE_NAME =
  process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME ?? 'hdx-oss-dev-app';
export const HDX_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  'http://localhost:4318';

export const IS_OSS = process.env.NEXT_PUBLIC_IS_OSS ?? 'true' === 'true';
export const IS_LOCAL_MODE = //true;
  // @ts-ignore
  (process.env.NEXT_PUBLIC_IS_LOCAL_MODE ?? 'false') === 'true';

// Features in development
export const IS_MTVIEWS_ENABLED = false;
