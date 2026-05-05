import { resolveSeverityColor } from './severityColors';
import type { TimelineLane } from './types';

const MARKER_LINE_OPACITY = 0.6;
const MARKER_LINE_STROKE_WIDTH = 1.5;
const MARKER_FLAG_HALF_WIDTH = 5;
const MARKER_FLAG_HEIGHT = 6;
const MARKER_DOT_RADIUS = 3;

/**
 * Recharts internals exposed via the Customized component's `props` argument.
 * Recharts does not export precise types for these so we narrow them locally.
 */
type CustomizedRechartsProps = {
  xAxisMap?: Record<string, { scale?: (value: number) => number }>;
  yAxisMap?: Record<string, { y?: number; height?: number }>;
};

type TimelineMarkersProps = CustomizedRechartsProps & {
  lanes: TimelineLane[];
  /**
   * Optional click handler. When provided, each marker becomes interactive
   * (cursor pointer) and invokes the callback with the underlying event so
   * dashboards can drill through to search.
   */
  onMarkerClick?: (eventTs: number, laneKey: string) => void;
};

/**
 * Grafana-13-style annotation markers: a thin vertical line spanning the
 * chart, a small triangular flag at the bottom, and a dot anchor where the
 * line meets the X axis. Severity colors override lane colors when available.
 */
export function TimelineMarkers({
  lanes,
  onMarkerClick,
  xAxisMap,
  yAxisMap,
}: TimelineMarkersProps) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis) return null;

  const yTop = yAxis.y ?? 0;
  const yBottom = (yAxis.y ?? 0) + (yAxis.height ?? 0);

  return (
    <g>
      {lanes.flatMap((lane, li) =>
        lane.events.map((event, ei) => {
          const cx = xAxis.scale!(event.ts);
          if (typeof cx !== 'number' || Number.isNaN(cx)) return null;
          const color = resolveSeverityColor(event.severity) ?? lane.color;
          const flagPoints = [
            `${cx},${yBottom}`,
            `${cx - MARKER_FLAG_HALF_WIDTH},${yBottom + MARKER_FLAG_HEIGHT}`,
            `${cx + MARKER_FLAG_HALF_WIDTH},${yBottom + MARKER_FLAG_HEIGHT}`,
          ].join(' ');
          const handleClick = onMarkerClick
            ? () => onMarkerClick(event.ts, lane.key)
            : undefined;
          return (
            <g
              key={`${li}-${ei}`}
              onClick={handleClick}
              style={handleClick ? { cursor: 'pointer' } : undefined}
            >
              <line
                x1={cx}
                x2={cx}
                y1={yTop}
                y2={yBottom}
                stroke={color}
                strokeWidth={MARKER_LINE_STROKE_WIDTH}
                opacity={MARKER_LINE_OPACITY}
              />
              <polygon points={flagPoints} fill={color} />
              <circle
                cx={cx}
                cy={yBottom}
                r={MARKER_DOT_RADIUS}
                fill={color}
                stroke="var(--mantine-color-body)"
                strokeWidth={1}
              />
            </g>
          );
        }),
      )}
    </g>
  );
}
