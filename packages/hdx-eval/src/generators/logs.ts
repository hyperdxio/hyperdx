import type { CanonicalSeverity, LogRow } from './types';
import { SEVERITY_NUMBER } from './types';

export type LogInput = {
  timestampMs: number;
  serviceName: string;
  severityText: LogRow['severityText'];
  body: string;
  traceId?: string;
  spanId?: string;
  /**
   * Explicit OTel severity number. Required when `severityText` is a messy
   * variant (e.g. `warning`, `fatal`) that isn't a canonical key. When
   * omitted, the number is derived from the normalized severity family.
   */
  severityNumber?: number;
  resourceAttributes?: Record<string, string>;
  logAttributes?: Record<string, string>;
};

/** Map any messy severity string to its canonical OTel severity number. */
function deriveSeverityNumber(severityText: string): number {
  const direct = SEVERITY_NUMBER[severityText as CanonicalSeverity];
  if (direct !== undefined) return direct;
  const u = severityText.toUpperCase();
  if (u.startsWith('WARN')) return SEVERITY_NUMBER.WARN;
  if (u === 'FATAL') return 21; // OTel FATAL is 21, distinct from ERROR (17)
  if (u.startsWith('ERR')) return SEVERITY_NUMBER.ERROR;
  if (u.startsWith('DEB')) return SEVERITY_NUMBER.DEBUG;
  if (u === 'TRACE') return SEVERITY_NUMBER.TRACE;
  return SEVERITY_NUMBER.INFO;
}

export function makeLog(input: LogInput): LogRow {
  return {
    timestampMs: input.timestampMs,
    traceId: input.traceId,
    spanId: input.spanId,
    serviceName: input.serviceName,
    severityText: input.severityText,
    severityNumber:
      input.severityNumber ?? deriveSeverityNumber(input.severityText),
    body: input.body,
    resourceAttributes: {
      'service.name': input.serviceName,
      ...(input.resourceAttributes ?? {}),
    },
    logAttributes: input.logAttributes ?? {},
  };
}
