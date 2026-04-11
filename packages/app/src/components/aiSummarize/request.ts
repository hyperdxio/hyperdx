import { hdxServer } from '@/api';

import {
  AISummaryTone,
  isSmartSummaryModeEnabled,
  RowData,
  stringifyValue,
} from './helpers';

type SummaryKind = 'event' | 'pattern' | 'trace';

type KeyValueStat = {
  key: string;
  value: string;
  count: number;
};

type EventPayload = {
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

type PatternPayload = {
  kind: 'pattern';
  tone?: AISummaryTone;
  context: {
    pattern: string;
    count: number;
    sampledRows?: number;
    representativeSeverity?: string;
    topServices?: KeyValueStat[];
    topAttributes?: KeyValueStat[];
    sampleMessages?: string[];
  };
};

type TraceItem = {
  service?: string;
  name: string;
  durationMs?: number;
  status?: string;
  timestamp?: string;
  type?: 'span' | 'log';
  isError?: boolean;
};

type TracePayload = {
  kind: 'trace';
  tone?: AISummaryTone;
  context: {
    traceId: string;
    spanCount: number;
    logCount: number;
    errorCount: number;
    warnCount: number;
    durationMs?: number;
    serviceStats?: KeyValueStat[];
    criticalPath?: TraceItem[];
    errorEvents?: TraceItem[];
    slowSpans?: TraceItem[];
  };
};

type SummaryPayload = EventPayload | PatternPayload | TracePayload;
export type { SummaryPayload };

type SummaryResponse = {
  summary: string;
  tone: AISummaryTone;
  kind: SummaryKind;
};

type AISummaryNotEnabledError = Error & {
  code: 'AI_SUMMARY_NOT_ENABLED';
};

function buildAISummaryNotEnabledError(): AISummaryNotEnabledError {
  const error = new Error(
    'AI summary is not enabled. Configure AI_PROVIDER and AI_API_KEY (or legacy ANTHROPIC_API_KEY), then restart the API.',
  ) as AISummaryNotEnabledError;
  error.code = 'AI_SUMMARY_NOT_ENABLED';
  return error;
}

function roundDurationMs(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

function topStats(
  values: Record<string, number>,
  maxItems: number,
  transformKey?: (key: string) => string,
): KeyValueStat[] {
  return Object.entries(values)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([key, count]) => ({
      key: transformKey ? transformKey(key) : key,
      value: transformKey ? transformKey(key) : key,
      count,
    }));
}

function extractAttributes(
  rowData: RowData,
): Array<{ key: string; value: string }> {
  const attributes: Array<{ key: string; value: string }> = [];
  const attrCandidates = [
    rowData.__hdx_event_attributes,
    rowData.__hdx_resource_attributes,
    rowData.__hdx_events_exception_attributes,
  ];

  for (const candidate of attrCandidates) {
    if (candidate == null || typeof candidate !== 'object') continue;
    for (const [key, value] of Object.entries(candidate)) {
      const str = stringifyValue(value, 180);
      if (!str) continue;
      attributes.push({ key, value: str });
      if (attributes.length >= 24) return attributes;
    }
  }

  return attributes;
}

export async function requestAISummary(
  payload: SummaryPayload,
  options?: { aiEnabled?: boolean },
): Promise<string> {
  if (options?.aiEnabled === false) {
    throw buildAISummaryNotEnabledError();
  }
  const tone =
    isSmartSummaryModeEnabled() && payload.tone ? payload.tone : 'default';
  const response = await hdxServer('ai/summarize', {
    method: 'POST',
    json: { ...payload, tone },
  }).json<SummaryResponse>();

  return response.summary;
}

export function buildEventSummaryPayload({
  rowData,
  severityText,
}: {
  rowData: RowData;
  severityText?: string;
}): EventPayload {
  return {
    kind: 'event',
    context: {
      title:
        stringifyValue(rowData.SpanName, 180) ||
        stringifyValue(rowData.__hdx_body, 180) ||
        undefined,
      body: stringifyValue(rowData.__hdx_body, 900) || undefined,
      timestamp: stringifyValue(rowData.__hdx_timestamp, 120) || undefined,
      service:
        stringifyValue(rowData.ServiceName, 180) ||
        stringifyValue(rowData.__hdx_service_name, 180) ||
        undefined,
      severity:
        severityText ||
        stringifyValue(rowData.__hdx_severity_text, 80) ||
        undefined,
      status:
        stringifyValue(rowData.StatusCode, 80) ||
        stringifyValue(rowData.__hdx_status_code, 80) ||
        undefined,
      spanName: stringifyValue(rowData.SpanName, 200) || undefined,
      spanKind: stringifyValue(rowData.SpanKind, 80) || undefined,
      durationMs: roundDurationMs(rowData.Duration),
      traceId:
        stringifyValue(rowData.TraceId, 120) ||
        stringifyValue(rowData.__hdx_trace_id, 120) ||
        undefined,
      spanId:
        stringifyValue(rowData.SpanId, 120) ||
        stringifyValue(rowData.__hdx_span_id, 120) ||
        undefined,
      attributes: extractAttributes(rowData),
    },
  };
}

export function buildPatternSummaryPayload({
  patternName,
  count,
  severityText,
  samples,
  serviceNameExpression,
}: {
  patternName: string;
  count: number;
  severityText?: string;
  samples: RowData[];
  serviceNameExpression: string;
}): PatternPayload {
  const serviceCounts: Record<string, number> = {};
  const attributeCounts: Record<string, number> = {};
  const sampleMessages: string[] = [];

  for (const sample of samples.slice(0, 300)) {
    const service =
      stringifyValue(sample[serviceNameExpression], 120) ||
      stringifyValue(sample.ServiceName, 120) ||
      stringifyValue(sample.__hdx_service_name, 120) ||
      '';
    if (service) {
      serviceCounts[service] = (serviceCounts[service] ?? 0) + 1;
    }

    const body =
      stringifyValue(sample.__hdx_body, 240) ||
      stringifyValue(sample['__hdx_pattern_field'], 240) ||
      '';
    if (body && sampleMessages.length < 8) {
      sampleMessages.push(body);
    }

    const attrs = sample.__hdx_event_attributes;
    if (attrs != null && typeof attrs === 'object') {
      for (const [key, value] of Object.entries(attrs)) {
        const attrKey = `${key}:${stringifyValue(value, 60)}`;
        attributeCounts[attrKey] = (attributeCounts[attrKey] ?? 0) + 1;
      }
    }
  }

  return {
    kind: 'pattern',
    context: {
      pattern: stringifyValue(patternName, 500) || patternName,
      count,
      sampledRows: samples.length,
      representativeSeverity: severityText,
      topServices: topStats(serviceCounts, 8),
      topAttributes: topStats(attributeCounts, 12, raw => {
        const [k, ...rest] = raw.split(':');
        return `${k}=${rest.join(':')}`;
      }),
      sampleMessages,
    },
  };
}

function normalizeStatus(status: unknown): string {
  const raw = stringifyValue(status, 80).toLowerCase();
  if (raw.includes('error')) return 'error';
  if (raw.includes('warn')) return 'warn';
  return raw || 'unknown';
}

type TraceSpanNode = {
  spanId: string;
  parentSpanId?: string;
  item: TraceItem;
  durationMs: number;
};

function computeCriticalPath(spans: TraceSpanNode[]): TraceItem[] {
  if (spans.length === 0) return [];

  const bySpanId = new Map<string, TraceSpanNode[]>();
  const childrenByParentSpanId = new Map<string, TraceSpanNode[]>();
  for (const span of spans) {
    const list = bySpanId.get(span.spanId) ?? [];
    list.push(span);
    bySpanId.set(span.spanId, list);

    if (span.parentSpanId) {
      const children = childrenByParentSpanId.get(span.parentSpanId) ?? [];
      children.push(span);
      childrenByParentSpanId.set(span.parentSpanId, children);
    }
  }

  const memo = new Map<string, { totalMs: number; path: TraceItem[] }>();
  const keyFor = (node: TraceSpanNode) =>
    `${node.spanId}:${node.parentSpanId ?? 'root'}:${node.item.timestamp ?? ''}:${node.item.name}`;

  const dfs = (node: TraceSpanNode): { totalMs: number; path: TraceItem[] } => {
    const key = keyFor(node);
    const cached = memo.get(key);
    if (cached) return cached;

    let bestChild: { totalMs: number; path: TraceItem[] } = {
      totalMs: 0,
      path: [],
    };

    const children = childrenByParentSpanId.get(node.spanId) ?? [];
    for (const child of children) {
      if (child === node) continue;
      const candidate = dfs(child);
      if (candidate.totalMs > bestChild.totalMs) {
        bestChild = candidate;
      }
    }

    const current = {
      totalMs: node.durationMs + bestChild.totalMs,
      path: [node.item, ...bestChild.path],
    };
    memo.set(key, current);
    return current;
  };

  const roots = spans.filter(
    span =>
      !span.parentSpanId ||
      !bySpanId.has(span.parentSpanId) ||
      span.parentSpanId === span.spanId,
  );

  let best: { totalMs: number; path: TraceItem[] } = { totalMs: 0, path: [] };
  for (const root of roots.length > 0 ? roots : spans) {
    const candidate = dfs(root);
    if (candidate.totalMs > best.totalMs) {
      best = candidate;
    }
  }

  return best.path.slice(0, 18);
}

export function buildTraceSummaryPayload({
  traceId,
  rows,
}: {
  traceId: string;
  rows: RowData[];
}): TracePayload {
  const serviceCounts: Record<string, number> = {};
  const spanNodes = rows
    .filter(row => row.type === 'trace' || row.SpanId != null)
    .map(row => {
      const durationMs = roundDurationMs(
        row.Duration != null ? Number(row.Duration) * 1000 : undefined,
      );
      const item: TraceItem = {
        service:
          stringifyValue(row.ServiceName, 120) ||
          stringifyValue(row.__hdx_service_name, 120) ||
          undefined,
        name:
          stringifyValue(row.Body, 220) ||
          stringifyValue(row.SpanName, 220) ||
          'span',
        durationMs,
        status: stringifyValue(row.StatusCode, 80) || undefined,
        timestamp: stringifyValue(row.Timestamp, 80) || undefined,
        type: 'span',
        isError: normalizeStatus(row.StatusCode) === 'error',
      };
      return {
        spanId: stringifyValue(row.SpanId, 120) || '',
        parentSpanId: stringifyValue(row.ParentSpanId, 120) || undefined,
        durationMs: durationMs ?? 0,
        item,
      };
    })
    .filter(node => node.spanId || node.item.timestamp);

  const spans = spanNodes.map(node => node.item);

  const logs = rows
    .filter(row => row.type === 'log')
    .map(row => ({
      service:
        stringifyValue(row.ServiceName, 120) ||
        stringifyValue(row.__hdx_service_name, 120) ||
        undefined,
      name: stringifyValue(row.Body, 220) || 'log',
      durationMs: undefined,
      status: stringifyValue(row.SeverityText, 80) || undefined,
      timestamp: stringifyValue(row.Timestamp, 80) || undefined,
      type: 'log' as const,
      isError: normalizeStatus(row.SeverityText) === 'error',
    }));

  for (const row of [...spans, ...logs]) {
    if (row.service) {
      serviceCounts[row.service] = (serviceCounts[row.service] ?? 0) + 1;
    }
  }

  const sortedByDuration = [...spans].sort(
    (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
  );
  const criticalPath = computeCriticalPath(spanNodes);

  const errorEvents = [...spans, ...logs]
    .filter(item => item.isError)
    .slice(0, 12);

  const slowSpans = sortedByDuration
    .filter(item => (item.durationMs ?? 0) > 200)
    .slice(0, 10);

  const totalDurationMs = sortedByDuration.reduce(
    (acc, item) => acc + (item.durationMs ?? 0),
    0,
  );

  const warnCount = logs.filter(
    item => normalizeStatus(item.status) === 'warn',
  ).length;

  return {
    kind: 'trace',
    context: {
      traceId: stringifyValue(traceId, 120) || traceId,
      spanCount: spans.length,
      logCount: logs.length,
      errorCount: errorEvents.length,
      warnCount,
      durationMs: Math.round(totalDurationMs),
      serviceStats: topStats(serviceCounts, 8),
      criticalPath,
      errorEvents,
      slowSpans,
    },
  };
}
