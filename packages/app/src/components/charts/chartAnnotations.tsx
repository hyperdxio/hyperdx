import { type ReactElement } from 'react';
import { Label, ReferenceLine } from 'recharts';

/**
 * A single vertical marker to overlay on a timeseries chart at a point in time.
 * Source-agnostic: alerts, deployments, incidents, config changes, etc. all map
 * to this shape.
 */
export type ChartAnnotation = {
  /** Event time. Accepts a Date, ISO string, or epoch milliseconds. */
  time: Date | string | number;
  /** Optional short label drawn at the marker. */
  label?: string;
  /** Line/label color (any CSS value). Defaults to the chart border color. */
  color?: string;
  /** Stable React key; defaults to the resolved timestamp + index. */
  key?: string;
};

// Safety valve: past this many markers the chart is unreadable anyway, and
// rendering tens of thousands of SVG nodes would freeze the tab (e.g. a
// flapping alert over a wide window).
export const MAX_ANNOTATION_MARKERS = 1000;

/**
 * Renders vertical annotation lines for a chart's `referenceLines` prop. `x` is
 * in unix seconds to match the timeseries x-axis (`ts_bucket`); markers outside
 * the domain are dropped by Recharts. Generic over source — feature hooks map
 * their events to `ChartAnnotation[]` and call this. Capped at
 * `MAX_ANNOTATION_MARKERS` to protect against pathological inputs.
 */
export function getAnnotationReferenceLines(
  annotations: ChartAnnotation[],
): ReactElement[] {
  return annotations.slice(0, MAX_ANNOTATION_MARKERS).map((annotation, i) => {
    const seconds = new Date(annotation.time).getTime() / 1000;
    const color = annotation.color ?? 'var(--color-border)';
    return (
      <ReferenceLine
        key={annotation.key ?? `annotation-${seconds}-${i}`}
        x={seconds}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.9}
        label={
          annotation.label ? (
            // Pin the label to the top of the plot (in the headroom) rather
            // than centered on the line, to minimize overlap with the series.
            <Label
              value={annotation.label}
              position="insideTop"
              fill={color}
              fontSize={10}
              opacity={0.9}
            />
          ) : undefined
        }
      />
    );
  });
}
