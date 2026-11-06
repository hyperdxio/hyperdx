import type { Attributes } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';

// The session panel lists spans from the `custom-action` scope as user
// actions (see utils/sessions.ts), the scope @hyperdx/browser's addAction
// used. @clickhouse/clickstack-browser has no addAction, so keep the name.
const tracer = trace.getTracer('custom-action');

/** Records a zero-duration span that shows up as a user action in sessions. */
export function addAction(name: string, attributes?: Attributes): void {
  tracer.startSpan(name, { attributes }).end();
}
