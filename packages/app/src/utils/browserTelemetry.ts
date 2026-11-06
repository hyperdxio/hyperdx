import type { ClickStackBrowserOptions } from '@clickhouse/clickstack-browser';
import { type Attributes, trace } from '@opentelemetry/api';

import { parseResourceAttributes } from '@/config';
import type { NextApiConfigResponseData } from '@/types';

/**
 * Records a user action as a zero-duration span, the replacement for the old
 * SDK's addAction. The browser SDK adds session.id and user.* to it.
 */
export function recordAction(name: string, attributes: Attributes): void {
  // The scope the old addAction used. The session replay timeline finds
  // custom events by it (utils/sessions.ts, SessionEventList.tsx).
  trace.getTracer('custom-action').startSpan(name, { attributes }).end();
}

type BrowserTelemetryConfig = Pick<
  NextApiConfigResponseData,
  | 'apiKey'
  | 'collectorUrl'
  | 'collectorTracesUrl'
  | 'collectorLogsUrl'
  | 'serviceName'
>;

/** Maps the app's telemetry settings onto the browser SDK's init options. */
export function getBrowserInitOptions({
  config,
  resourceAttributes,
  serviceVersion,
}: {
  config: BrowserTelemetryConfig;
  /** The raw NEXT_PUBLIC_OTEL_RESOURCE_ATTRIBUTES value. */
  resourceAttributes: string;
  serviceVersion: string | undefined;
}): ClickStackBrowserOptions {
  return {
    endpoint: config.collectorUrl,
    // An empty per-signal URL, as from a variable set to '', makes the SDK
    // build that signal's URL from endpoint
    tracesEndpoint: config.collectorTracesUrl,
    logsEndpoint: config.collectorLogsUrl,
    apiKey: config.apiKey,
    serviceName: config.serviceName,
    // Wins over a service.version in resourceAttributes, as before the upgrade
    serviceVersion,
    resourceAttributes: parseResourceAttributes(resourceAttributes),
    // The old SDK's consoleCapture recorded every console level
    console: 'debug',
    maskAllText: true,
    maskAllInputs: true,
  };
}
