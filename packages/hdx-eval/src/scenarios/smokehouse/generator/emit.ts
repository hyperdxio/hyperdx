import type { LogRow } from '@/generators/types';
import { SEVERITY_NUMBER } from '@/generators/types';

import type { PlannedTrace } from './walker';

// Module-level because incident `events` hooks call emitLog directly. generate() drains
// after every tick and once at the start to clear leftovers from a stopped run.
let traces: PlannedTrace[] = [];
let logs: LogRow[] = [];

export function emitTrace(t: PlannedTrace): void {
  traces.push(t);
}

// Log records that are not tied to a request: rollout events and the like.
export function emitLog(
  service: string,
  podName: string,
  version: string,
  atMs: number,
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  body: string,
  attrs: Record<string, string>,
): void {
  logs.push({
    timestampMs: atMs,
    serviceName: service,
    severityText: severity,
    severityNumber: SEVERITY_NUMBER[severity],
    body,
    resourceAttributes: {
      'service.name': service,
      'service.version': version,
      'k8s.pod.name': podName,
    },
    logAttributes: attrs,
  });
}

export function drain(): { traces: PlannedTrace[]; logs: LogRow[] } {
  const out = { traces, logs };
  traces = [];
  logs = [];
  return out;
}
