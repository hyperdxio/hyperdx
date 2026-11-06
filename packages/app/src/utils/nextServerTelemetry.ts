import { decideSelfTelemetry } from '@hyperdx/common-utils/dist/selfTelemetry';

import { BASE_PATH, HDX_EXPORTER_ENABLED } from '@/config';

// Used only when no name is configured, in which case the API reports
// unknown_service:node. It is the name docker-compose gives the API.
const DEFAULT_SERVICE_NAME = 'hdx-oss-app';
const SERVICE_NAME_SUFFIX = '-next';

// Build and public/ assets were half of this server's incoming spans. Pages,
// /api and /_next/data requests keep theirs. A new file in public/ needs an
// entry here.
const STATIC_PATH_PREFIXES = [
  '/_next/static/',
  '/_next/webpack-hmr',
  // The dev overlay's stack frame and source map requests
  '/__nextjs',
  '/favicons/',
  '/pyodide/',
];
const STATIC_PATHS = ['/__ENV.js', '/whats-new.json'];
// The Python packages the Patterns view installs from the public/ root
const STATIC_PATH_SUFFIXES = ['.whl'];

// The SDK's limit for resource attribute keys and values
const MAX_RESOURCE_ATTRIBUTE_LENGTH = 255;

/**
 * A stricter twin of `parseResourceAttributes` in src/config.ts, which splits
 * each entry at its first `=` and skips entries without a key. This one
 * follows the EnvDetector in `@opentelemetry/resources`, which drops the whole
 * variable when any entry is malformed or longer than 255 characters, so the
 * Next server picks the same service.name as the SDK and never one the API
 * would not report.
 */
function serviceNameFromResourceAttributes(raw: string | undefined) {
  let serviceName: string | undefined;
  for (const entry of (raw ?? '').split(',')) {
    if (entry.trim() === '') {
      continue;
    }
    const parts = entry.split('=');
    if (parts.length !== 2 || parts[0].trim() === '') {
      return undefined;
    }
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(parts[0].trim());
      value = decodeURIComponent(parts[1].trim());
    } catch {
      return undefined;
    }
    if (
      key.length > MAX_RESOURCE_ATTRIBUTE_LENGTH ||
      value.length > MAX_RESOURCE_ATTRIBUTE_LENGTH
    ) {
      return undefined;
    }
    if (key === 'service.name') {
      serviceName = value;
    }
  }
  return serviceName || undefined;
}

/**
 * The HyperDX image (the docker-compose app service, which sets hdx-oss-app)
 * and the all-in-one image run the API, the check-alerts task and this server
 * in one container with one OTEL_SERVICE_NAME, so this server reports as that
 * name plus `-next`.
 */
export function getNextServerServiceName(
  env: Record<string, string | undefined>,
): string {
  const base =
    env.OTEL_SERVICE_NAME?.trim() ||
    serviceNameFromResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES) ||
    DEFAULT_SERVICE_NAME;
  return `${base}${SERVICE_NAME_SUFFIX}`;
}

export function isStaticAssetRequest(
  url: string | undefined,
  basePath: string,
): boolean {
  const path = (url ?? '').split('?')[0];
  const appPath =
    basePath && path.startsWith(`${basePath}/`)
      ? path.slice(basePath.length)
      : path;
  return (
    STATIC_PATHS.includes(appPath) ||
    STATIC_PATH_PREFIXES.some(prefix => appPath.startsWith(prefix)) ||
    STATIC_PATH_SUFFIXES.some(suffix => appPath.endsWith(suffix))
  );
}

/** Called from register() in instrumentation.ts in the Node.js runtime. */
export async function startNextServerTelemetry(): Promise<void> {
  // Operators who set HDX_EXPORTER_ENABLED=false to turn off the app's own
  // telemetry (it hides the browser key in /api/config) never got Next server
  // telemetry either, because production builds did not load
  // instrumentation.ts before.
  if (!HDX_EXPORTER_ENABLED) {
    return;
  }
  const telemetry = decideSelfTelemetry(process.env);
  if (!telemetry.start) {
    return;
  }
  if (telemetry.otlpHeaders !== undefined) {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = telemetry.otlpHeaders;
  }

  // The variable beats both init's serviceName option and a service.name in
  // OTEL_RESOURCE_ATTRIBUTES, so writing it is enough. The browser takes its
  // name from NEXT_PUBLIC_OTEL_SERVICE_NAME and is not affected.
  process.env.OTEL_SERVICE_NAME = getNextServerServiceName(process.env);

  // Next sets http.route on the outer HTTP server span once the request
  // handler settles, and for proxied /api requests that span has already
  // ended, so the SDK's default warn level prints a diag line per request.
  // Export failures are diag errors and still print. An operator's
  // OTEL_LOG_LEVEL wins.
  process.env.OTEL_LOG_LEVEL ??= 'error';

  const { init } = await import('@clickhouse/clickstack-node');
  init({
    apiKey: telemetry.apiKey,
    instrumentations: {
      // The SDK merges its header capture and body hooks into this entry, so
      // they keep working.
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: request =>
          isStaticAssetRequest(request.url, BASE_PATH),
      },
    },
  });
}
