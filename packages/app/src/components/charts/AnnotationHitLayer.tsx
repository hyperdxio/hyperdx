import {
  DefaultZIndexes,
  usePlotArea,
  useXAxisScale,
  ZIndexLayer,
} from 'recharts';

import type { PositionedAnnotation } from './chartAnnotations';

/**
 * Minimum width of a marker's hover target. A dashed 1px line is unhittable, so
 * each cluster gets a band at least this wide centred on it.
 */
const MIN_HIT_WIDTH_PX = 14;

export type HoveredAnnotation = {
  /** The cluster's labelled anchor. `members` names everything inside it. */
  annotation: PositionedAnnotation;
  /** Pointer position in chart-container pixels. */
  point: { x: number; y: number };
};

/**
 * Transparent hover targets over the annotation markers, so a marker can name
 * the service it belongs to rather than relying on its colour — which stops
 * being resolvable once the legend overflows past `MAX_LEGEND_ITEMS`.
 *
 * Rendered inside the chart through Recharts' `<Customized>` so it can read the
 * real plot geometry (`usePlotArea`, `useXAxisScale`) instead of re-deriving it
 * from the container width. Handlers deliberately do not stop propagation:
 * events still bubble to the chart wrapper, which is what keeps drag-to-zoom
 * and the series tooltip working underneath the bands.
 */
export function AnnotationHitLayer({
  annotations,
  onHover,
}: {
  annotations: PositionedAnnotation[];
  onHover: (hovered: HoveredAnnotation | null) => void;
}) {
  const plot = usePlotArea();
  const scale = useXAxisScale();

  if (plot == null || scale == null) {
    return null;
  }

  // One target per cluster, not per line. Anchors carry `members`; the muted
  // lines inside a cluster are already covered by their anchor's band, and
  // giving them their own rects would just have them intercept each other.
  const anchors = annotations.filter(annotation => annotation.members != null);

  return (
    // Above every other chart layer, otherwise the series areas (zIndex 100)
    // and the marker lines (400) receive the pointer instead of these bands.
    <ZIndexLayer zIndex={DefaultZIndexes.label + 1}>
      <g className="recharts-annotation-hit-layer">
        {anchors.map((annotation, i) => {
          const members = annotation.members ?? [annotation];
          // Span the whole cluster so hovering any of its lines — including the
          // muted ones, which carry no label — surfaces the same tooltip.
          const xs = members
            .map(member => scale(member.x))
            .filter((px): px is number => px != null && Number.isFinite(px));
          if (xs.length === 0) {
            return null;
          }
          const left = Math.min(...xs);
          const right = Math.max(...xs);

          const width = Math.max(right - left, MIN_HIT_WIDTH_PX);
          const x = left - (width - (right - left)) / 2;

          return (
            <rect
              key={annotation.key ?? `annotation-hit-${annotation.x}-${i}`}
              x={x}
              // Confined to the label headroom above the plot. Covering the plot
              // too would make the series tooltip fire alongside this one, and
              // the label is the natural thing to aim at anyway.
              y={0}
              width={width}
              height={plot.y}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: 'default' }}
              onMouseEnter={event => {
                // Measured here rather than passed down from the chart
                // container: reading the DOM in an event handler is fine,
                // whereas reading a ref during render is not.
                const band = event.currentTarget.getBoundingClientRect();
                onHover({
                  annotation,
                  point: { x: band.left + band.width / 2, y: band.bottom },
                });
              }}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
      </g>
    </ZIndexLayer>
  );
}
