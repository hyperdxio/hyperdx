import { useMemo } from 'react';

import {
  getValidSpanLinks,
  SpanLinkData,
  SpanLinksSubpanel,
} from './SpanLinksSubpanel';

export function getReverseSpanLinks(
  rows: Record<string, unknown>[] | null | undefined,
  currentSpanId: string | undefined,
): SpanLinkData[] {
  if (!Array.isArray(rows) || !currentSpanId) {
    return [];
  }
  const results: SpanLinkData[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const spanLinks = row.__hdx_span_links;
    const validLinks = getValidSpanLinks(
      spanLinks as Record<string, unknown>[] | null | undefined,
    );
    if (validLinks.length === 0) continue;
    const pointsToCurrent = validLinks.some(
      link => link.SpanId === currentSpanId,
    );
    if (!pointsToCurrent) continue;
    results.push({
      TraceId: String(row.TraceId ?? ''),
      SpanId: String(row.SpanId ?? ''),
      TraceState: '',
      Attributes: {
        'span.name': String(row.SpanName ?? ''),
        'service.name': String(row.ServiceName ?? ''),
        'span.kind': String(row.SpanKind ?? ''),
      },
    });
  }
  return results;
}

export const SpansReverseLinksSubpanel = ({
  rows,
  currentSpanId,
  onOpenTrace,
}: {
  rows?: Record<string, unknown>[] | null;
  currentSpanId?: string;
  onOpenTrace?: (link: SpanLinkData) => void;
}) => {
  const reverseLinks = useMemo(
    () => getReverseSpanLinks(rows, currentSpanId),
    [rows, currentSpanId],
  );
  if (reverseLinks.length === 0) {
    return (
      <div className="p-3 text-muted fs-7" data-testid="reverse-links-empty">
        No spans reference this span
      </div>
    );
  }
  return (
    <SpanLinksSubpanel
      spanLinks={reverseLinks as unknown as Record<string, unknown>[]}
      onOpenTrace={onOpenTrace}
    />
  );
};
