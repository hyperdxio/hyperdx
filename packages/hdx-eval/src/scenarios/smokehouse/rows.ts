import { newSpanId, newTraceId } from '@/generators/traces';
import type { LogRow, TraceRow } from '@/generators/types';
import { SEVERITY_NUMBER } from '@/generators/types';
import type { SeededRng } from '@/rng/seeded';

import type { PlannedSpan, PlannedTrace } from './generator/walker';

export function traceToRows(
  t: PlannedTrace,
  rng: SeededRng,
): { traces: TraceRow[]; logs: LogRow[] } {
  const traces: TraceRow[] = [];
  const logs: LogRow[] = [];
  const traceId = newTraceId(rng);

  const visit = (s: PlannedSpan, parentSpanId: string) => {
    const spanId = newSpanId(rng);
    const resourceAttributes = {
      'service.name': s.service,
      'service.version': String(s.attrs['service.version']),
      'k8s.pod.name': s.pod,
    };
    traces.push({
      timestampMs: Math.round(s.startMs),
      traceId,
      spanId,
      parentSpanId,
      spanName: s.name,
      spanKind: `SPAN_KIND_${s.kind}`,
      serviceName: s.service,
      durationNs: Math.round((s.endMs - s.startMs) * 1e6),
      statusCode: s.error ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_UNSET',
      statusMessage: s.error?.message ?? '',
      resourceAttributes,
      spanAttributes: Object.fromEntries(
        Object.entries(s.attrs).map(([k, v]) => [k, String(v)]),
      ),
    });
    for (const l of s.logs) {
      logs.push({
        timestampMs: Math.round(l.atMs),
        traceId,
        spanId,
        serviceName: s.service,
        severityText: l.severity,
        severityNumber: SEVERITY_NUMBER[l.severity],
        body: l.body,
        resourceAttributes,
        logAttributes: l.attrs,
      });
    }
    for (const c of s.children) visit(c, spanId);
  };
  visit(t.root, '');
  return { traces, logs };
}
