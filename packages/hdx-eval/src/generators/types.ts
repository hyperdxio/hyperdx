export type TraceRow = {
  timestampMs: number;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  spanName: string;
  spanKind:
    | 'SPAN_KIND_SERVER'
    | 'SPAN_KIND_CLIENT'
    | 'SPAN_KIND_INTERNAL'
    | 'SPAN_KIND_PRODUCER'
    | 'SPAN_KIND_CONSUMER';
  serviceName: string;
  durationNs: number;
  statusCode: 'STATUS_CODE_OK' | 'STATUS_CODE_ERROR' | 'STATUS_CODE_UNSET';
  statusMessage: string;
  resourceAttributes: Record<string, string>;
  spanAttributes: Record<string, string>;
};

export type LogRow = {
  timestampMs: number;
  traceId?: string;
  spanId?: string;
  serviceName: string;
  severityText: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  severityNumber: number;
  body: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
};

export const SEVERITY_NUMBER: Record<LogRow['severityText'], number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
};
