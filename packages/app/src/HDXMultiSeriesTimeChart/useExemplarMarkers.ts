import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import { Exemplar } from '@hyperdx/common-utils/dist/types';

import {
  clampExemplarX,
  clampExemplarY,
  computeExemplarPoints,
  type ExemplarYBounds,
} from '@/components/Exemplars';

type UseExemplarMarkersArgs = {
  exemplars: Exemplar[] | undefined;
  maxExemplars: number;
  granularity: string;
  pinnedExemplarKey: string | null;
  /** Rendered x-domain, so out-of-window markers are dropped, not dragged in. */
  xAxisDomain: [number, number];
  /** Rendered y-range; a marker below the floor is dropped, not raised onto it. */
  exemplarYBounds: ExemplarYBounds;
  onExemplarHover?: (exemplar: Exemplar, cx: number, cy: number) => void;
  onExemplarHoverEnd?: () => void;
  onExemplarSelect?: (exemplar: Exemplar, cx: number, cy: number) => void;
  onExemplarPinEnd?: () => void;
  /**
   * Set by the chart's brush-zoom so the synthetic click that follows mouseup can
   * be swallowed. Owned by the chart, not this hook: the zoom and the marker
   * layer are the only two consumers and they must agree on a single flag.
   */
  suppressNextClickRef: MutableRefObject<boolean>;
};

/**
 * The exemplar marker layer: which markers are rendered after thinning, which one
 * the cursor is on, and the guards that close a hover or pinned card when a
 * refetch drops the marker it pointed at.
 *
 * Extracted from MemoChart because it is the one part of that component with no
 * bearing on axes, scales, or the recharts tree — and because every bug this
 * layer has had came from the marker outliving the data behind it, which is
 * easier to reason about with the whole lifecycle in one file.
 */
export function useExemplarMarkers({
  exemplars,
  maxExemplars,
  granularity,
  pinnedExemplarKey,
  xAxisDomain,
  exemplarYBounds,
  onExemplarHover,
  onExemplarHoverEnd,
  onExemplarSelect,
  onExemplarPinEnd,
  suppressNextClickRef,
}: UseExemplarMarkersArgs) {
  // While the cursor is over an exemplar marker, the exemplar hover card owns
  // the tooltip real estate — suppress the series hover tooltip so the two don't
  // overlap. Wraps the parent's exemplar-hover callbacks to also track it here.
  // Track the hovered marker by key (not just a boolean) so we can detect when a
  // refetch/re-thinning unmounts it — React fires no mouseleave in that case, so
  // the boolean would otherwise stick `true` and permanently suppress the series
  // tooltip. The reset effect lives after `exemplarPoints` is computed.
  const [hoveredExemplarKey, setHoveredExemplarKey] = useState<string | null>(
    null,
  );
  const isExemplarHovered = hoveredExemplarKey != null;
  const handleExemplarHoverStart = useCallback(
    (exemplar: Exemplar, cx: number, cy: number) => {
      setHoveredExemplarKey(
        `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
      );
      onExemplarHover?.(exemplar, cx, cy);
    },
    [onExemplarHover],
  );
  const handleExemplarHoverEnd = useCallback(() => {
    setHoveredExemplarKey(null);
    onExemplarHoverEnd?.();
  }, [onExemplarHoverEnd]);

  // A brush-to-zoom ends in a synthetic click. When that click lands on a
  // marker's hit circle, ExemplarDot stops propagation and the chart's own
  // onClick — the only other consumer of this flag — never runs, so the flag
  // stays set and silently swallows the *next* real click. Consume it here and
  // ignore the click: it belongs to the drag, not to the marker.
  const handleExemplarSelect = useCallback(
    (exemplar: Exemplar, cx: number, cy: number) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      onExemplarSelect?.(exemplar, cx, cy);
    },
    [onExemplarSelect, suppressNextClickRef],
  );

  // Place each exemplar at its own value (the trace/span's actual measurement),
  // never remapped onto the series line — the marker's height must match what
  // the linked trace reports. Thinned to at most `maxExemplars` markers, spread
  // evenly across the range and bucketed at the chart's own granularity so each
  // marker sits in the bucket of the point it explains — see
  // computeExemplarPoints. maxExemplars <= 0 means "unlimited" (deduped only).
  const exemplarPoints = useMemo(() => {
    const bucketSeconds = convertGranularityToSeconds(granularity);
    const points = computeExemplarPoints(exemplars, {
      maxExemplars,
      granularity,
    });
    const placed: typeof points = [];
    for (const p of points) {
      // null from either clamp => there is no honest place to draw this marker:
      // a different window (see clampExemplarX) or below the rendered floor (see
      // clampExemplarY). Dropping here, rather than at render, keeps the reset
      // effects below keyed on what is actually drawn — otherwise a card could
      // stay open pointing at a marker recharts never rendered.
      const x = clampExemplarX(p.x, xAxisDomain, bucketSeconds);
      if (x == null) continue;
      const y = clampExemplarY(p.y, exemplarYBounds);
      if (y == null) continue;
      placed.push({ ...p, x, y });
    }
    return placed;
  }, [exemplars, maxExemplars, granularity, xAxisDomain, exemplarYBounds]);

  // If a refetch/re-thinning drops the hovered marker from the rendered set, its
  // <g> unmounts without a mouseleave. Reset the hover here (against the actual
  // rendered points) so the series tooltip un-suppresses and the parent's hover
  // card closes via onExemplarHoverEnd.
  useEffect(() => {
    if (
      hoveredExemplarKey != null &&
      !exemplarPoints.some(p => p.key === hoveredExemplarKey)
    ) {
      setHoveredExemplarKey(null);
      onExemplarHoverEnd?.();
    }
  }, [exemplarPoints, hoveredExemplarKey, onExemplarHoverEnd]);

  // Same guard for the pinned marker. Without it a refetch, live tail, or
  // brush-zoom leaves the card floating at pre-refetch coordinates over a marker
  // that no longer exists — and because a pin suppresses the series tooltip
  // chart-wide, hover stays dead until the user finds the close button.
  useEffect(() => {
    if (
      pinnedExemplarKey != null &&
      !exemplarPoints.some(p => p.key === pinnedExemplarKey)
    ) {
      onExemplarPinEnd?.();
    }
  }, [exemplarPoints, pinnedExemplarKey, onExemplarPinEnd]);

  return {
    exemplarPoints,
    isExemplarHovered,
    handleExemplarHoverStart,
    handleExemplarHoverEnd,
    handleExemplarSelect,
  };
}
