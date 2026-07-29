import { useCallback, useEffect, useRef, useState } from 'react';
import Router from 'next/router';
import {
  ChartConfigWithDateRange,
  Exemplar,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { type PositionedExemplar } from '@/components/Exemplars';
import { useExemplars, useExemplarTraceMeta } from '@/hooks/useExemplars';
import { useSource } from '@/source';

/**
 * Owns the exemplar overlay's data and its hover/pin card state for one chart.
 *
 * Extracted from DBTimeChart because this is a self-contained state machine —
 * hover opens a card, a click pins it, a pin outranks hover, and several
 * different events close it — and interleaving it with the chart's own tooltip
 * state was what took that file past a thousand lines.
 *
 * The chart still coordinates: its drill-down tooltip and this card are mutually
 * exclusive, so it calls `pin`/`unpin` alongside its own state updates rather
 * than this hook reaching into the chart.
 */
export function useExemplarCard({
  queriedConfig,
  source,
}: {
  queriedConfig: ChartConfigWithDateRange;
  source: TSource | undefined;
}) {
  // Exemplar overlay is configured per-chart via `enableExemplars` (set in the
  // chart editor next to "As Ratio"), not a runtime toolbar toggle. The hook is
  // a no-op unless the flag is set and the source kind supports exemplars.
  const {
    exemplars,
    isError: isExemplarsError,
    error: exemplarsError,
    dropped: exemplarsDropped,
  } = useExemplars(queriedConfig, source);

  // A failed or suppressed exemplar scan otherwise looks exactly like "no
  // exemplars in this range". Both are non-fatal — the chart itself is fine — so
  // they surface as a toolbar indicator rather than replacing the chart. The
  // upstream message is preferred over the generic fallback because the API
  // phrases these actionably (e.g. "narrow the chart's time range").
  const exemplarNotice = isExemplarsError
    ? (exemplarsError ??
      'Exemplars could not be loaded for this chart. The metric table may not carry Exemplars.* columns, or the Prometheus endpoint rejected the query.')
    : exemplarsDropped === 'multiple-series'
      ? 'Exemplars are hidden because this query returns more than one series. A marker sits at one trace’s own value, so it can’t be attributed across series yet — aggregate to a single line to see them.'
      : null;

  // Trace source an exemplar resolves against: the chart's explicit
  // `exemplarTraceSourceId`, else the chart source's linked trace source.
  const exemplarTraceSourceId =
    queriedConfig.exemplarTraceSourceId ||
    (source && 'traceSourceId' in source ? source.traceSourceId : undefined);
  const { data: exemplarTraceSource } = useSource({
    id: exemplarTraceSourceId,
  });

  // Hover card state. A short close delay lets the cursor travel from the SVG
  // marker into the HTML card without it closing. Clicking a marker pins the
  // same card open (`pinnedExemplar`), which then outranks hover until it's
  // dismissed — via its close button, a click elsewhere on the chart, or
  // another chart pinning something of its own.
  const [hoveredExemplar, setHoveredExemplar] =
    useState<PositionedExemplar | null>(null);
  const [pinnedExemplar, setPinnedExemplar] =
    useState<PositionedExemplar | null>(null);
  const exemplarCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const openExemplarCard = useCallback(
    (exemplar: Exemplar, x: number, y: number) => {
      if (exemplarCloseTimerRef.current)
        clearTimeout(exemplarCloseTimerRef.current);
      setHoveredExemplar({ exemplar, x, y });
    },
    [],
  );
  const scheduleCloseExemplarCard = useCallback(() => {
    if (exemplarCloseTimerRef.current)
      clearTimeout(exemplarCloseTimerRef.current);
    exemplarCloseTimerRef.current = setTimeout(
      () => setHoveredExemplar(null),
      150,
    );
  }, []);
  useEffect(
    () => () => {
      if (exemplarCloseTimerRef.current)
        clearTimeout(exemplarCloseTimerRef.current);
    },
    [],
  );
  // Note: when a refetch/re-thinning drops the hovered marker, the chart
  // (MemoChart) detects the unmount against the actually-rendered points and
  // fires onExemplarHoverEnd, which schedules this card's close — so no separate
  // cleanup against the raw `exemplars` list is needed (that list is pre-thinning
  // and would miss the re-thinning case anyway).

  // A pin outranks hover, so the card doesn't swap contents under the cursor
  // while the user is reading (or clicking) it.
  const activeExemplar = pinnedExemplar ?? hoveredExemplar;

  const unpinExemplarCard = useCallback(() => setPinnedExemplar(null), []);
  // Key of the pinned marker, so the chart can close the card when a refetch or
  // re-thinning drops that marker from the rendered set.
  const pinnedExemplarKey = pinnedExemplar
    ? `exemplar-${pinnedExemplar.exemplar.traceId}-${pinnedExemplar.exemplar.timestamp}`
    : null;

  // Escape closes the pinned card, matching the rest of the app's overlays.
  useEffect(() => {
    if (!pinnedExemplar) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedExemplar(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pinnedExemplar]);

  const { data: hoveredTraceMeta, isLoading: isHoveredTraceMetaLoading } =
    useExemplarTraceMeta(activeExemplar?.exemplar.traceId, exemplarTraceSource);

  const navigateToExemplarTrace = useCallback(
    (exemplar: Exemplar) => {
      if (exemplarTraceSourceId) {
        const params = new URLSearchParams();
        params.set('source', exemplarTraceSourceId);
        params.set('traceId', exemplar.traceId);
        Router.push(`/search?${params.toString()}`);
      } else {
        Router.push(`/trace/${encodeURIComponent(exemplar.traceId)}`);
      }
    },
    [exemplarTraceSourceId],
  );

  /** Cancel a scheduled close — the cursor reached the card in time. */
  const cancelClose = useCallback(() => {
    if (exemplarCloseTimerRef.current) {
      clearTimeout(exemplarCloseTimerRef.current);
    }
  }, []);

  /**
   * Pin the card for a clicked marker. Clears any pending hover-close and the
   * hover card itself so the pinned contents can't be swapped out from under the
   * cursor.
   */
  const pin = useCallback(
    (exemplar: Exemplar, x: number, y: number) => {
      cancelClose();
      setHoveredExemplar(null);
      setPinnedExemplar({ exemplar, x, y });
    },
    [cancelClose],
  );

  return {
    exemplars,
    exemplarNotice,
    exemplarTraceSource,
    exemplarTraceSourceId,
    activeExemplar,
    pinnedExemplar,
    pinnedExemplarKey,
    hoveredTraceMeta,
    isHoveredTraceMetaLoading,
    openExemplarCard,
    scheduleCloseExemplarCard,
    cancelClose,
    pin,
    unpin: unpinExemplarCard,
    navigateToExemplarTrace,
  };
}
