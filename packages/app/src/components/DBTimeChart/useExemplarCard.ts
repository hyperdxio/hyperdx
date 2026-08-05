import { useCallback, useEffect, useRef, useState } from 'react';
import Router from 'next/router';
import {
  ChartConfigWithDateRange,
  DisplayType,
  Exemplar,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';

import { type PositionedExemplar } from '@/components/Exemplars';
import { useExemplars, useExemplarTraceMeta } from '@/hooks/useExemplars';
import { quantizeEnd, quantizeStart } from '@/hooks/useExemplars/quantize';
import { useSource } from '@/source';

/**
 * Half-width of the window the Inspect deep link opens around an exemplar. Wide
 * enough to absorb clock skew between the metric pipeline and the trace store,
 * narrow enough that the trace is not buried among unrelated ones.
 */
const EXEMPLAR_TRACE_WINDOW_MS = 5 * 60 * 1000;

/** Epoch-ms [from, to] bracketing an exemplar, for the search page's range. */
function exemplarTraceWindow(timestampMs: number): [number, number] {
  return [
    timestampMs - EXEMPLAR_TRACE_WINDOW_MS,
    timestampMs + EXEMPLAR_TRACE_WINDOW_MS,
  ];
}

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
  displayType,
  plottedSeriesCount,
}: {
  queriedConfig: ChartConfigWithDateRange;
  source: TSource | undefined;
  /**
   * Swapping this remounts the whole recharts subtree (Area vs Bar are different
   * element types), so every ExemplarDot unmounts with no mouseleave and any open
   * card would be left over markers that no longer exist.
   */
  displayType: DisplayType | undefined;
  /** Series the chart actually draws; see useExemplars for why it matters. */
  plottedSeriesCount?: number;
}) {
  // Exemplar overlay is configured per-chart via `enableExemplars` (set in the
  // chart editor next to "As Ratio"), not a runtime toolbar toggle. The hook is
  // a no-op unless the flag is set and the source kind supports exemplars.
  const {
    exemplars,
    isError: isExemplarsError,
    error: exemplarsError,
    dropped: exemplarsDropped,
  } = useExemplars(queriedConfig, source, plottedSeriesCount);

  // A failed or suppressed exemplar scan otherwise looks exactly like "no
  // exemplars in this range". Both are non-fatal — the chart itself is fine — so
  // they surface as a toolbar indicator rather than replacing the chart. The
  // upstream message is preferred over the generic fallback because the API
  // phrases these actionably (e.g. "narrow the chart's time range").
  const fetchNotice = isExemplarsError
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

  // The pinned card is positioned from the marker's pixel coordinates at click
  // time, so anything that moves the markers leaves it beside the wrong diamond.
  // The existing guard only fires when the pinned marker leaves the rendered set;
  // a live-tail tick, zoom, or rescale that *keeps* the marker slides it out from
  // under the card. Unpin on a range change instead of trying to re-derive the
  // position: the coordinates are only known inside the SVG shape, and a card
  // that closes is better than one pointing at someone else's trace.
  //
  // The card also shows the exemplar's own value and time, so a user who had it
  // open still saw which exemplar it described.
  //
  // Quantised to the same bucket the exemplar query key uses, so a live-tail tick
  // — which advances dateRange every second — counts as the same view and does not
  // yank the card away a moment after the user clicked it. A real zoom or range
  // switch crosses the bucket and still unpins.
  const pinnedRangeRef = useRef<string | null>(null);
  const rangeKey = queriedConfig.dateRange
    ? `${quantizeStart(queriedConfig.dateRange[0])}-${quantizeEnd(queriedConfig.dateRange[1])}`
    : 'none';
  useEffect(() => {
    if (!pinnedExemplar) {
      pinnedRangeRef.current = null;
      return;
    }
    if (pinnedRangeRef.current == null) {
      pinnedRangeRef.current = rangeKey;
      return;
    }
    if (pinnedRangeRef.current !== rangeKey) {
      pinnedRangeRef.current = null;
      setPinnedExemplar(null);
      // The hover card too: its position was captured at mouseenter, and a marker
      // that slides out from under a stationary cursor fires no mouseleave — so the
      // card would sit at stale coordinates and keep the series tooltip suppressed
      // until the pointer happened to move.
      setHoveredExemplar(null);
    }
  }, [pinnedExemplar, rangeKey]);

  // Clear both cards before the chart subtree remounts on a display-type switch.
  useEffect(() => {
    setPinnedExemplar(null);
    setHoveredExemplar(null);
  }, [displayType]);

  // Markers dropped by the render-layer clamps. Reported up from MemoChart because
  // the drop happens after the fetch, so the fetch-layer `dropped` reason cannot
  // see it and the overlay would otherwise thin out with no explanation.
  const [clampDroppedCount, setClampDroppedCount] = useState(0);

  // Escape closes the pinned card, matching the rest of the app's overlays.
  useEffect(() => {
    if (!pinnedExemplar) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedExemplar(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pinnedExemplar]);

  const {
    data: hoveredTraceMeta,
    isLoading: isHoveredTraceMetaLoading,
    isError: isHoveredTraceMetaError,
  } = useExemplarTraceMeta(
    activeExemplar?.exemplar.traceId,
    exemplarTraceSource,
  );

  // A configured trace source that isn't actually a Trace kind never runs a query,
  // so it looks identical to "no rows" — as does a failed query. Both used to read
  // as "Trace not found in source", blaming the data for a misconfiguration or an
  // error.
  const traceLookupFailed =
    isHoveredTraceMetaError ||
    (!!exemplarTraceSource && exemplarTraceSource.kind !== SourceKind.Trace);

  const navigateToExemplarTrace = useCallback(
    (exemplar: Exemplar) => {
      if (exemplarTraceSourceId) {
        const params = new URLSearchParams();
        params.set('source', exemplarTraceSourceId);
        params.set('traceId', exemplar.traceId);
        // Carry a window around the exemplar. Without from/to the search page
        // falls back to the last 14 days (getDefaultDirectTraceDateRange), so a
        // marker on a dashboard pinned to an older absolute range opened an empty
        // trace view. The exemplar's own timestamp is the one thing we know for
        // certain about where to look.
        const [from, to] = exemplarTraceWindow(exemplar.timestamp);
        params.set('from', String(from));
        params.set('to', String(to));
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

  // The fetch-layer reason wins; a thinned overlay is the lesser problem and its
  // note only appears when nothing worse is wrong.
  const exemplarNotice =
    fetchNotice ??
    (clampDroppedCount > 0
      ? `${clampDroppedCount} exemplar marker${clampDroppedCount === 1 ? '' : 's'} fall outside the chart's plotted range and are not drawn. A fitted y-axis floor (which a legend selection alone can produce) sits above them, or they belong to a different time window.`
      : null);

  return {
    exemplars,
    exemplarNotice,
    reportClampDropped: setClampDroppedCount,
    traceLookupFailed,
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
