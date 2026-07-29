import { type ReactElement } from 'react';
import { Label, ReferenceLine } from 'recharts';

/**
 * A single marker to overlay on a timeseries chart at a point in time.
 * Source-agnostic: alerts, deployments, incidents, config changes, etc. all map
 * to this shape.
 */
export type ChartAnnotation = {
  /** Event time. Accepts a Date, ISO string, or epoch milliseconds. */
  time: Date | string | number;
  /** Optional short label drawn above the marker. */
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
 * Renders annotation markers as dashed vertical reference lines, with the label
 * floated in the chart's top headroom (above the line) so it stays legible and
 * clear of the series. The chart reserves that headroom only while annotations
 * are shown — see `ANNOTATION_LABEL_HEADROOM` in `HDXMultiSeriesTimeChart`.
 *
 * `domain` is the chart's x-axis domain in unix seconds (matching `ts_bucket`).
 * Each marker is clamped into that domain so an edge marker — e.g. an alert
 * already firing when the window opens, pinned to a coarser-quantized start
 * time — snaps to the visible edge instead of being dropped by Recharts.
 *
 * Generic over source — feature hooks map their events to `ChartAnnotation[]`.
 * Capped at `MAX_ANNOTATION_MARKERS` to protect against pathological inputs.
 */
export function getAnnotationElements(
  annotations: ChartAnnotation[],
  opts: { domain: [number, number] },
): ReactElement[] {
  const [minX, maxX] = opts.domain;

  return annotations.slice(0, MAX_ANNOTATION_MARKERS).map((annotation, i) => {
    const rawSeconds = new Date(annotation.time).getTime() / 1000;
    // Clamp into the visible domain so edge markers snap to the edge.
    const x = Math.min(Math.max(rawSeconds, minX), maxX);
    const color = annotation.color ?? 'var(--color-border)';
    return (
      <ReferenceLine
        key={annotation.key ?? `annotation-${x}-${i}`}
        x={x}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={0.9}
        label={
          annotation.label ? (
            // Float the label above the line in the top margin so it doesn't
            // overlap the series (the chart reserves headroom for it).
            <Label
              value={annotation.label}
              position="top"
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
