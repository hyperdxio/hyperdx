import { Exemplar } from '@hyperdx/common-utils/dist/types';

// Half-diagonal of the diamond marker, in px.
const DIAMOND_HALF_SIZE = 4;
// Radius of the transparent hit target that eases hovering the small marker.
const HIT_RADIUS = 9;

type ExemplarDotProps = {
  // cx/cy are injected by recharts when this is used as a <ReferenceDot shape={...} />.
  cx?: number;
  cy?: number;
  exemplar: Exemplar;
  onHoverStart?: (exemplar: Exemplar, cx: number, cy: number) => void;
  onHoverEnd?: () => void;
};

/**
 * Diamond marker for an exemplar, drawn via <ReferenceDot shape={...} />.
 * Recharts injects cx/cy. Hovering opens a floating menu (handled by the parent
 * via onHoverStart/onHoverEnd) to inspect the linked trace — the marker itself
 * is not a click target. A larger transparent hit circle eases hovering.
 */
export function ExemplarDot({
  cx,
  cy,
  exemplar,
  onHoverStart,
  onHoverEnd,
}: ExemplarDotProps) {
  if (typeof cx !== 'number' || typeof cy !== 'number') {
    return null;
  }
  const s = DIAMOND_HALF_SIZE;
  return (
    <g
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => onHoverStart?.(exemplar, cx, cy)}
      onMouseLeave={() => onHoverEnd?.()}
    >
      <path
        d={`M ${cx} ${cy - s} L ${cx + s} ${cy} L ${cx} ${cy + s} L ${cx - s} ${cy} Z`}
        fill="var(--color-chart-warning, #f5a623)"
        // Outline that contrasts with the background (dark in light mode, light
        // in dark mode) rather than matching it — the amber fill alone is
        // low-contrast on a white background, so the marker needs a defined edge.
        stroke="var(--color-text-default, #1a1a1a)"
        strokeWidth={1}
      />
      <circle cx={cx} cy={cy} r={HIT_RADIUS} fill="transparent" />
    </g>
  );
}
