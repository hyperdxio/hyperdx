import { useMemo } from 'react';
import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import useFieldExpressionGenerator from '@/hooks/useFieldExpressionGenerator';
import {
  matchesRowHighlightHint,
  RowHighlightHint,
} from '@/hooks/useRowHighlightHint';
import useRowWhere, { WithClause } from '@/hooks/useRowWhere';
import { PLACEHOLDER_CONFIG } from '@/hooks/useSessionLogEvents';
import { formatDurationMs } from '@/utils';
import { getBrowserEventLabel } from '@/utils/browserEvents';
import {
  BrowserTraceRow,
  getBrowserTraceContext,
  isBrowserEventLogSource,
} from '@/utils/browserTraceContext';
import {
  buildResourceTimingQuery,
  getResourceTimingMarkers,
  ResourceTimingMarker,
  resourceTimingRowKey,
} from '@/utils/resourceTimingMarkers';
import { SESSION_LOG_EVENT_KEY_COLUMNS } from '@/utils/sessionLogEvents';
import {
  buildTriggerClickQuery,
  pickTriggerClick,
} from '@/utils/traceTriggerClick';

type TraceRow = BrowserTraceRow & { SpanId?: unknown };

type LogRow = {
  id: string;
  Timestamp: string;
  SpanId?: unknown;
  Body?: unknown;
};

/** The click that triggered the trace, as a waterfall log row. */
export type TraceTriggerRow = {
  Timestamp: string;
  Body: string;
  SpanId: string;
  type: SourceKind.Log;
  id: string;
  aliasWith: WithClause[];
  __hdx_hidden: boolean;
  triggeredBy: string;
};

// Stable, so the waterfall's row memos don't rerun while there is nothing.
const NO_RESOURCE_TIMING: ReturnType<typeof getResourceTimingMarkers> = {
  markersBySpanId: new Map(),
  drawnRowKeys: new Set(),
};

/**
 * Traces without an OTel browser span send no queries. The queries never hold
 * the waterfall, and a failed one changes nothing.
 */
export function useBrowserTraceEvents<T extends LogRow>({
  traceRows,
  logRows,
  logSource,
  traceId,
  highlightedRowWhere,
  initialRowHighlightHint,
  foldTimingRows,
  enabled,
}: {
  traceRows: readonly TraceRow[];
  logRows: T[];
  logSource: TLogSource | null;
  traceId: string;
  highlightedRowWhere?: string | null;
  initialRowHighlightHint?: RowHighlightHint;
  /** Whether the dots are on screen to replace the rows. */
  foldTimingRows: boolean;
  /** False while the trace rows fetch, so the anchor can't move mid-flight. */
  enabled: boolean;
}): {
  logRows: T[];
  resourceTimingBySpanId: ReadonlyMap<string, ResourceTimingMarker[]>;
  triggerRow: TraceTriggerRow | undefined;
} {
  const context = useMemo(() => getBrowserTraceContext(traceRows), [traceRows]);
  const source =
    context != null && isBrowserEventLogSource(logSource)
      ? logSource
      : undefined;

  const timingQuery = useMemo(
    () =>
      source != null && context != null
        ? buildResourceTimingQuery({ logSource: source, context, traceId })
        : null,
    [source, context, traceId],
  );
  // Never stale, like the waterfall's own queries: another window is another
  // key. Otherwise each trace refetch would rerun both.
  const timing = useQueriedChartConfig(timingQuery ?? PLACEHOLDER_CONFIG, {
    enabled: enabled && timingQuery != null,
    queryKeyPrefix: 'TraceResourceTiming',
    staleTime: Infinity,
  });
  const timingResult =
    timingQuery != null && !timing.isError ? timing.data : undefined;
  const { markersBySpanId, drawnRowKeys } = useMemo(
    () =>
      timingResult?.data.length
        ? getResourceTimingMarkers(timingResult, traceRows)
        : NO_RESOURCE_TIMING,
    [timingResult, traceRows],
  );

  // The selected row and the row the panel opened from stay: folding them
  // would leave the detail panel showing a row the waterfall lacks, and the
  // hint would find nothing to select.
  const keptLogRows = useMemo(() => {
    if (!foldTimingRows || drawnRowKeys.size === 0) {
      return logRows;
    }
    return logRows.filter(
      row =>
        !drawnRowKeys.has(resourceTimingRowKey(row.SpanId, row.Timestamp)) ||
        row.id === highlightedRowWhere ||
        matchesRowHighlightHint(row, initialRowHighlightHint),
    );
  }, [
    logRows,
    foldTimingRows,
    drawnRowKeys,
    highlightedRowWhere,
    initialRowHighlightHint,
  ]);

  // Only the trigger query reads a single attribute, so only it needs the
  // JSON column lookup.
  const triggerSource = context?.sessionId != null ? source : undefined;
  const { getFieldExpression } = useFieldExpressionGenerator(triggerSource);
  // A string, not the generator: the generator is a new function each render.
  const sessionIdExpression =
    triggerSource &&
    getFieldExpression?.(triggerSource.eventAttributesExpression, 'session.id');
  const triggerQuery = useMemo(
    () =>
      triggerSource != null && context?.sessionId != null && sessionIdExpression
        ? buildTriggerClickQuery({
            logSource: triggerSource,
            context,
            sessionId: context.sessionId,
            sessionIdExpression,
          })
        : null,
    [triggerSource, context, sessionIdExpression],
  );
  const trigger = useQueriedChartConfig(
    triggerQuery?.config ?? PLACEHOLDER_CONFIG,
    {
      enabled: enabled && triggerQuery != null,
      queryKeyPrefix: 'TraceTriggerClick',
      staleTime: Infinity,
    },
  );
  const triggerResult =
    triggerQuery != null && !trigger.isError ? trigger.data : undefined;
  const getRowWhere = useRowWhere({
    meta: triggerResult?.meta,
    aliasMap: triggerQuery?.aliasMap,
    primaryKeyColumns: SESSION_LOG_EVENT_KEY_COLUMNS,
  });
  const anchorMs = context?.anchorMs;
  const anchorHidden = context?.anchorHidden ?? false;
  const triggerRow = useMemo((): TraceTriggerRow | undefined => {
    const picked =
      anchorMs != null && triggerResult?.data.length
        ? pickTriggerClick(triggerResult, anchorMs)
        : undefined;
    if (picked == null) {
      return undefined;
    }
    // useRowWhere throws on a column without meta, which must not take down
    // the waterfall.
    let id: string;
    try {
      id = getRowWhere(picked.row).where;
    } catch (e) {
      console.error(e);
      return undefined;
    }
    const { timelineText } = getBrowserEventLabel({
      eventName: String(picked.row.event_name ?? ''),
      body: picked.row.body,
      attributes: picked.row.attributes,
    });
    return {
      Timestamp: String(picked.row.timestamp),
      Body: '',
      SpanId: '',
      type: SourceKind.Log,
      id,
      // The row id is made of raw expressions, so it needs no WITH clauses.
      aliasWith: [],
      __hdx_hidden: anchorHidden,
      triggeredBy: `Triggered by: ${timelineText} · ${formatDurationMs(picked.gapMs)} before`,
    };
  }, [triggerResult, anchorMs, anchorHidden, getRowWhere]);

  return {
    logRows: keptLogRows,
    resourceTimingBySpanId: markersBySpanId,
    triggerRow,
  };
}
