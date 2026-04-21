// Build a compact trace context string for the AI summarize prompt.
// Includes: summary stats, span groups with duration stats, and error spans.

import { isErrorEvent } from './classifiers';
import { attrToString } from './formatHelpers';

// SpanAttributes come from ClickHouse Map columns — values can be any type
// depending on the source schema.
export interface TraceSpan {
  Body?: string;
  ServiceName?: string;
  Duration?: number; // seconds (f64)
  StatusCode?: string;
  SeverityText?: string;
  SpanId?: string;
  ParentSpanId?: string;
  SpanAttributes?: Record<string, unknown>;
}

interface SpanGroup {
  name: string;
  count: number;
  errors: number;
  durations: number[]; // ms
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(0, idx), sorted.length - 1)];
}

function fmtMs(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function isSpanError(span: TraceSpan): boolean {
  return isErrorEvent({
    severity: span.SeverityText,
    statusCode: span.StatusCode,
    body: span.Body,
    exceptionMessage:
      typeof span.SpanAttributes?.['exception.message'] === 'string'
        ? (span.SpanAttributes['exception.message'] as string)
        : undefined,
    exceptionType:
      typeof span.SpanAttributes?.['exception.type'] === 'string'
        ? (span.SpanAttributes['exception.type'] as string)
        : undefined,
    httpStatus:
      typeof span.SpanAttributes?.['http.status_code'] === 'number'
        ? (span.SpanAttributes['http.status_code'] as number)
        : typeof span.SpanAttributes?.['http.status_code'] === 'string'
          ? (span.SpanAttributes['http.status_code'] as string)
          : undefined,
  });
}

// Cap the trace context to ~4KB to stay well within the 50KB content limit
const MAX_TRACE_CONTEXT_CHARS = 4000;

export function buildTraceContext(spans: TraceSpan[]): string {
  if (!spans || spans.length === 0) return '';

  const totalSpans = spans.length;
  const errorSpans = spans.filter(isSpanError);
  const errorCount = errorSpans.length;

  const durationsMs = spans
    .map(s => (s.Duration != null ? s.Duration * 1000 : NaN))
    .filter(d => !isNaN(d));
  // Longest single span — a coarse proxy for the critical path without needing
  // timestamps. True end-to-end trace duration would require span start/end
  // spans + parent/child topology, which is more data than we need here.
  const longestSpanMs = durationsMs.length > 0 ? Math.max(...durationsMs) : 0;

  // Group by span name (Body field in trace waterfall)
  const groups = new Map<string, SpanGroup>();
  for (const span of spans) {
    const name = span.Body || '(unknown)';
    let group = groups.get(name);
    if (!group) {
      group = { name, count: 0, errors: 0, durations: [] };
      groups.set(name, group);
    }
    group.count++;
    if (isSpanError(span)) {
      group.errors++;
    }
    const dMs = span.Duration != null ? span.Duration * 1000 : NaN;
    if (!isNaN(dMs)) group.durations.push(dMs);
  }

  // Sort groups: error groups first, then by count descending; cap at 15
  const sortedGroups = [...groups.values()]
    .sort((a, b) => {
      if ((b.errors > 0 ? 1 : 0) !== (a.errors > 0 ? 1 : 0)) {
        return (b.errors > 0 ? 1 : 0) - (a.errors > 0 ? 1 : 0);
      }
      return b.count - a.count;
    })
    .slice(0, 15);

  const parts: string[] = [];
  parts.push(
    `Trace Context (${totalSpans} spans, ${errorCount} errors, ${fmtMs(longestSpanMs)} longest span):`,
  );
  parts.push('Span groups:');
  for (const g of sortedGroups) {
    const sorted = g.durations.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p50 = percentile(sorted, 50);
    const errStr = g.errors > 0 ? `, ${g.errors} errors` : '';
    parts.push(
      `  ${g.name}: ${g.count}x${errStr}, sum=${fmtMs(sum)}, p50=${fmtMs(p50)}`,
    );
  }

  // Include error spans (capped at 10) with brief details
  if (errorSpans.length > 0) {
    parts.push('Error spans:');
    for (const span of errorSpans.slice(0, 10)) {
      const name = span.Body || '(unknown)';
      const dMs = span.Duration != null ? fmtMs(span.Duration * 1000) : 'n/a';
      const svc = span.ServiceName ? ` (${span.ServiceName})` : '';
      // Error detail: prefer exception info, then http status.
      // Skip db.statement — often contains credentials/PII even after server-
      // side redaction; the span body usually carries enough context.
      const attrs = span.SpanAttributes ?? {};
      const errDetail =
        attrToString(attrs['exception.message'], 120) ||
        attrToString(attrs['exception.type'], 60) ||
        attrToString(attrs['http.status_code'], 10) ||
        '';
      parts.push(
        `  [ERROR] ${name}${svc} ${dMs}${errDetail ? ' — ' + errDetail : ''}`,
      );
    }
    if (errorSpans.length > 10) {
      parts.push(`  ... and ${errorSpans.length - 10} more errors`);
    }
  }

  const result = parts.join('\n');
  if (result.length > MAX_TRACE_CONTEXT_CHARS) {
    return result.slice(0, MAX_TRACE_CONTEXT_CHARS - 20) + '\n... (truncated)';
  }
  return result;
}
