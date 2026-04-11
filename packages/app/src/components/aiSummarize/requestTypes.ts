import type { AISummaryTone, RowData } from './helpers';

export type SummaryKind = 'event' | 'pattern' | 'trace';

export type KeyCountStat = {
  key: string;
  count: number;
};

export type EventPayload = {
  kind: 'event';
  tone?: AISummaryTone;
  context: {
    title?: string;
    body?: string;
    timestamp?: string;
    service?: string;
    severity?: string;
    status?: string;
    spanName?: string;
    spanKind?: string;
    durationMs?: number;
    traceId?: string;
    spanId?: string;
    attributes?: Array<{ key: string; value: string; count?: number }>;
  };
};

export type DurationConfig = {
  precision: number;
};

export type PatternPayload = {
  kind: 'pattern';
  tone?: AISummaryTone;
  context: {
    pattern: string;
    count: number;
    sampledRows?: number;
    representativeSeverity?: string;
    topServices?: KeyCountStat[];
    topAttributes?: KeyCountStat[];
    sampleMessages?: string[];
  };
};

export type TraceItem = {
  service?: string;
  name: string;
  durationMs?: number;
  status?: string;
  timestamp?: string;
  type?: 'span' | 'log';
  isError?: boolean;
};

export type TracePayload = {
  kind: 'trace';
  tone?: AISummaryTone;
  context: {
    traceId: string;
    spanCount: number;
    logCount: number;
    errorCount: number;
    warnCount: number;
    durationMs?: number;
    serviceStats?: KeyCountStat[];
    criticalPath?: TraceItem[];
    errorEvents?: TraceItem[];
    slowSpans?: TraceItem[];
  };
};

export type SummaryPayload = EventPayload | PatternPayload | TracePayload;

export type SummaryResponse = {
  summary: string;
  tone: AISummaryTone;
  kind: SummaryKind;
};

export type { RowData };
