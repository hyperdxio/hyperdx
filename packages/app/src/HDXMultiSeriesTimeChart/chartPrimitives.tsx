import type { BarProps } from 'recharts';

export const StackedBarWithOverlap = (props: BarProps) => {
  const { x, y, width, fill } = props;
  // `height` may arrive as a string, so coerce it to a number before the
  // arithmetic below.
  const height =
    typeof props.height === 'number' ? props.height : Number(props.height ?? 0);
  // Add a tiny bit to the height to create overlap. Otherwise there's a gap
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height > 0 ? height + 0.5 : 0}
      fill={fill}
    />
  );
};

type CaptureActiveDotProps = {
  /**
   * Called with each series' active-point pixel Y. This is a stable callback
   * (not the ref itself) so Recharts, which stores this element's props in its
   * Immer-backed store and freezes them, never freezes the underlying Map —
   * the write happens on the ref captured in the callback's closure instead.
   */
  onCapture: (dataKey: string, cy: number) => void;
  cx?: number;
  cy?: number;
  dataKey?: string | number;
  r?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

/**
 * Active dot for an Area series. Records the active point's pixel Y (`cy`)
 * via `onCapture`, keyed by dataKey, then draws the same dot Recharts
 * renders by default. Recharts clones this element with the active-point
 * props (cx, cy, dataKey, r, fill, stroke, strokeWidth) during the render
 * that precedes the tooltip, so the capture is current when the tooltip reads
 * it to find the series nearest the cursor.
 */
export function CaptureActiveDot({
  onCapture,
  cx,
  cy,
  dataKey,
  r,
  fill,
  stroke,
  strokeWidth,
}: CaptureActiveDotProps) {
  if (dataKey != null && typeof cy === 'number' && Number.isFinite(cy)) {
    // Written synchronously during render so the tooltip, which Recharts
    // renders after the graphical items in the same commit, reads the
    // current frame's positions rather than the previous frame's.
    onCapture(String(dataKey), cy);
  }
  if (typeof cx !== 'number' || typeof cy !== 'number') {
    return null;
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}
