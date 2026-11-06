/**
 * Self-telemetry preload, loaded with `-r` ahead of the API and the task
 * runner (bin/hyperdx, the dev scripts, the e2e web server).
 *
 * This wraps the ClickStack SDK instead of preloading its `register` entry
 * because the SDK never reads HYPERDX_API_KEY, and it would start without a
 * key and send to localhost:4318. decideSelfTelemetry keeps the old HyperDX
 * SDK's key handling and start condition, shared with the Next.js server.
 *
 * It imports nothing from the app, and from common-utils only a module without
 * dependencies: modules loaded before init() are not instrumented.
 */
import { isMainThread } from 'node:worker_threads';

import { init } from '@clickhouse/clickstack-node';
import { decideSelfTelemetry } from '@hyperdx/common-utils/dist/selfTelemetry';

const telemetry = decideSelfTelemetry(process.env);

// `-r` preloads also run in worker threads, such as the pino transport, and
// init() in a worker starts a second SDK there.
if (isMainThread && telemetry.start) {
  if (telemetry.otlpHeaders !== undefined) {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = telemetry.otlpHeaders;
  }
  init({
    apiKey: telemetry.apiKey,
    // Only set in development, where host metrics were collected before. It
    // applies to every process this preloads, so the dev API and the dev task
    // runner both report them. An explicit `enabled` value would override the
    // operator's OTEL_NODE_ENABLED_INSTRUMENTATIONS and _DISABLED_ lists
    // elsewhere.
    instrumentations:
      process.env.NODE_ENV === 'development'
        ? { '@opentelemetry/instrumentation-host-metrics': { enabled: true } }
        : undefined,
  });
}
