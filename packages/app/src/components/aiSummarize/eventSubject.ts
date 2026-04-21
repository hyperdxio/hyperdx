// Subject: single log or trace event
import { attrToString } from './formatHelpers';
import { SummarySubject } from './subjects';

export interface EventSubjectInput {
  rowData: Record<string, any>;
  severityText?: string;
}

// Effectively unlimited for event attributes — 500 is far above typical
// attribute lengths but caps pathological cases.
const coerceAttrValue = (v: unknown) => attrToString(v, 500);

export function formatEventContent(
  { rowData, severityText }: EventSubjectInput,
  opts?: { traceContext?: string },
): string {
  const parts: string[] = [];

  if (severityText) parts.push(`Severity: ${severityText}`);

  const body = rowData.__hdx_body;
  if (body)
    parts.push(
      `Body: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );

  if (rowData.ServiceName) parts.push(`Service: ${rowData.ServiceName}`);
  if (rowData.SpanName) parts.push(`Span: ${rowData.SpanName}`);
  if (rowData.StatusCode) parts.push(`Status: ${rowData.StatusCode}`);
  if (rowData.Duration) parts.push(`Duration: ${rowData.Duration}ns`);

  const attrs = rowData.__hdx_event_attributes;
  if (attrs && typeof attrs === 'object') {
    const interesting = Object.entries(attrs)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 20);
    if (interesting.length > 0) {
      parts.push(
        `Attributes: ${interesting.map(([k, v]) => `${k}=${coerceAttrValue(v)}`).join(', ')}`,
      );
    }
  }

  const res = rowData.__hdx_resource_attributes;
  if (res && typeof res === 'object') {
    const interesting = Object.entries(res)
      .filter(([, v]) => v != null && v !== '')
      .slice(0, 10);
    if (interesting.length > 0) {
      parts.push(
        `Resource: ${interesting.map(([k, v]) => `${k}=${coerceAttrValue(v)}`).join(', ')}`,
      );
    }
  }

  const exc = rowData.__hdx_events_exception_attributes;
  if (exc && typeof exc === 'object') {
    if (exc['exception.type'])
      parts.push(`Exception: ${exc['exception.type']}`);
    if (exc['exception.message'])
      parts.push(
        `Exception message: ${coerceAttrValue(exc['exception.message'])}`,
      );
  }

  if (opts?.traceContext) {
    parts.push('');
    parts.push(opts.traceContext);
  }

  return parts.join('\n');
}

export const EVENT_SUBJECT: SummarySubject<EventSubjectInput> = {
  kind: 'event',
  analyzingLabel: 'Analyzing event data...',
  formatContent: formatEventContent,
  supportsTraceContext: true,
};
