import { useEffect, useRef } from 'react';

import { WithClause } from '@/hooks/useRowWhere';

export type RowHighlightHint = {
  timestamp: string;
  spanId: string;
  body: string;
};

type HighlightRow = {
  id: string;
  type?: string;
  aliasWith: WithClause[];
  Timestamp?: unknown;
  SpanId?: unknown;
  Body?: unknown;
};

// Only the first hint after mount or a trace change yields to an existing
// selection (restored from the URL, or picked by the user). A later hint
// change means a different row was opened, so it replaces the selection.
export function useRowHighlightHint({
  traceId,
  initialRowHighlightHint,
  highlightedRowWhere,
  rows,
  onClick,
}: {
  traceId: string;
  initialRowHighlightHint?: RowHighlightHint;
  highlightedRowWhere?: string | null;
  rows: HighlightRow[];
  onClick?: (rowWhere: {
    id: string;
    type: string;
    aliasWith: WithClause[];
  }) => void;
}) {
  const appliedHighlightHintRef = useRef<string | null>(null);

  useEffect(() => {
    appliedHighlightHintRef.current = null;
  }, [traceId]);

  useEffect(() => {
    if (!initialRowHighlightHint || !onClick) {
      return;
    }

    const hintKey = `${initialRowHighlightHint.timestamp}|${initialRowHighlightHint.spanId}|${initialRowHighlightHint.body}`;
    if (appliedHighlightHintRef.current === hintKey) {
      return;
    }

    if (
      appliedHighlightHintRef.current == null &&
      highlightedRowWhere != null
    ) {
      appliedHighlightHintRef.current = hintKey;
      return;
    }

    const initialRowHighlightIndex = rows.findIndex(row => {
      return (
        row.Timestamp === initialRowHighlightHint.timestamp &&
        row.SpanId === initialRowHighlightHint.spanId &&
        row.Body === initialRowHighlightHint.body
      );
    });

    if (initialRowHighlightIndex !== -1) {
      appliedHighlightHintRef.current = hintKey;
      onClick({
        id: rows[initialRowHighlightIndex].id,
        type: rows[initialRowHighlightIndex].type ?? '',
        aliasWith: rows[initialRowHighlightIndex].aliasWith,
      });
    }
  }, [initialRowHighlightHint, rows, onClick, highlightedRowWhere]);
}
