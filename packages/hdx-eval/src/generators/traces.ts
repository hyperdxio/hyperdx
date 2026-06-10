import type { SeededRng } from '../rng/seeded';
import type { TraceRow } from './types';

export function newTraceId(rng: SeededRng): string {
  return rng.hex(16);
}

export function newSpanId(rng: SeededRng): string {
  return rng.hex(8);
}

export type SpanInput = {
  rng: SeededRng;
  timestampMs: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  spanName: string;
  spanKind?: TraceRow['spanKind'];
  serviceName: string;
  durationNs: number;
  statusCode?: TraceRow['statusCode'];
  statusMessage?: string;
  resourceAttributes?: Record<string, string>;
  spanAttributes?: Record<string, string>;
};

export function makeSpan(input: SpanInput): TraceRow {
  return {
    timestampMs: input.timestampMs,
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId ?? '',
    spanName: input.spanName,
    spanKind: input.spanKind ?? 'SPAN_KIND_INTERNAL',
    serviceName: input.serviceName,
    durationNs: input.durationNs,
    statusCode: input.statusCode ?? 'STATUS_CODE_OK',
    statusMessage: input.statusMessage ?? '',
    resourceAttributes: {
      'service.name': input.serviceName,
      ...(input.resourceAttributes ?? {}),
    },
    spanAttributes: input.spanAttributes ?? {},
  };
}

export function msToNs(ms: number): number {
  return Math.floor(ms * 1_000_000);
}
