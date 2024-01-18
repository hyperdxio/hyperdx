export const API_SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8000'; // NEXT_PUBLIC_API_SERVER_URL can be empty string

export const HDX_API_KEY = process.env.HYPERDX_API_KEY as string; // for nextjs server
export const HDX_SERVICE_NAME =
  process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME || 'hdx-oss-dev-app';
export const HDX_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ||
  'http://localhost:4318';

export const IS_OSS = process.env.NEXT_PUBLIC_IS_OSS ?? 'true' === 'true';

// Features in development
export const METRIC_ALERTS_ENABLED = process.env.NODE_ENV === 'development';
export const K8S_METRICS_ENABLED = process.env.NODE_ENV === 'development';
export const SERVICE_DASHBOARD_ENABLED = process.env.NODE_ENV === 'development';
export const K8S_DASHBOARD_ENABLED = process.env.NODE_ENV === 'development';
