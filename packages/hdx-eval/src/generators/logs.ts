import type { LogRow } from './types';
import { SEVERITY_NUMBER } from './types';

export type LogInput = {
  timestampMs: number;
  serviceName: string;
  severityText: LogRow['severityText'];
  body: string;
  traceId?: string;
  spanId?: string;
  resourceAttributes?: Record<string, string>;
  logAttributes?: Record<string, string>;
};

export function makeLog(input: LogInput): LogRow {
  return {
    timestampMs: input.timestampMs,
    traceId: input.traceId,
    spanId: input.spanId,
    serviceName: input.serviceName,
    severityText: input.severityText,
    severityNumber: SEVERITY_NUMBER[input.severityText],
    body: input.body,
    resourceAttributes: {
      'service.name': input.serviceName,
      ...(input.resourceAttributes ?? {}),
    },
    logAttributes: input.logAttributes ?? {},
  };
}
