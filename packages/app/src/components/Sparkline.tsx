import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
} from 'recharts';

type SparklineType = 'line' | 'area' | 'bar';

export type SparklinePoint = { x: number; y: number };

// `y` is the plotted value; `x` (bucket timestamp, seconds) is retained for
// ordering and future axis use. With no `<XAxis>`, recharts spaces points by
// array order, which callers keep sorted by bucket.
const VALUE_KEY = 'y';

// The line / area variants are drawn behind or beside a value, so they are
// intentionally low-contrast: a translucent stroke with a fainter area fill.
const STROKE_OPACITY = 0.5;
const STROKE_WIDTH = 2;
const AREA_FILL_OPACITY = 0.15;

const CHART_MARGIN = { top: 4, right: 0, bottom: 0, left: 0 };

/**
 * Chrome-less recharts trend, drawn as a line, area, or bar. No axes, grid,
 * legend, or tooltip; dots and animation are off. Fills its parent via
 * `ResponsiveContainer`, so the parent owns the dimensions (pass `height` to
 * override the default 100%). Renders nothing for fewer than two points, since
 * a single point has no trend to draw.
 */
export function Sparkline({
  points,
  type,
  color,
  height = '100%',
}: {
  points: SparklinePoint[];
  type: SparklineType;
  color: string;
  height?: number | string;
}) {
  if (points.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'bar' ? (
        <BarChart data={points} margin={CHART_MARGIN}>
          <Bar
            dataKey={VALUE_KEY}
            fill={color}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      ) : type === 'area' ? (
        <AreaChart data={points} margin={CHART_MARGIN}>
          <Area
            type="monotone"
            dataKey={VALUE_KEY}
            stroke={color}
            strokeOpacity={STROKE_OPACITY}
            strokeWidth={STROKE_WIDTH}
            fill={color}
            fillOpacity={AREA_FILL_OPACITY}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      ) : (
        <LineChart data={points} margin={CHART_MARGIN}>
          <Line
            type="monotone"
            dataKey={VALUE_KEY}
            stroke={color}
            strokeOpacity={STROKE_OPACITY}
            strokeWidth={STROKE_WIDTH}
            isAnimationActive={false}
            dot={false}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
