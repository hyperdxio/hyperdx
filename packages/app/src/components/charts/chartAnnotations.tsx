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
  /**
   * Feature that produced the marker ('alert', 'deployment', …). Markers only
   * ever share a collapsed label with others of the same kind, so a deploy is
   * never counted as an alert.
   */
  kind?: string;
  /**
   * Plural noun for the collapsed label when several markers of this kind sit
   * too close to label individually ("3 deploys"). Defaults to 'events'.
   */
  groupNoun?: string;
  /**
   * Series this marker belongs to (e.g. a service name on a chart grouped by
   * service). The chart tints the marker to match that series' color, so a
   * marker for one service can't be read as another's. Ignored when the chart
   * has no matching series — `color` is then used as the fallback.
   */
  group?: string;
};

// Safety valve: past this many markers the chart is unreadable anyway, and
// rendering tens of thousands of SVG nodes would freeze the tab (e.g. a
// flapping alert over a wide window).
export const MAX_ANNOTATION_MARKERS = 1000;

// Labels are centered on their marker, so two neighbours collide once they are
// closer than half of each label's width plus a gap. Widths are estimated from
// the character count — a fixed separation would either let long version
// strings overlap or collapse short ones that had room to spare.
const LABEL_CHAR_WIDTH_PX = 6; // approximate advance at fontSize 10
const LABEL_GAP_PX = 8;

function estimateLabelWidthPx(label: string | undefined): number {
  return (label?.length ?? 0) * LABEL_CHAR_WIDTH_PX;
}

/** Minimum distance between two labelled markers before they overlap. */
export function labelSeparationPx(
  left: string | undefined,
  right: string | undefined,
): number {
  return (
    (estimateLabelWidthPx(left) + estimateLabelWidthPx(right)) / 2 +
    LABEL_GAP_PX
  );
}

const STROKE_OPACITY = 0.9;
// Members of a collapsed group still get a line (so the density is visible),
// but a faint one, so the labelled anchor stays legible.
const MUTED_STROKE_OPACITY = 0.35;

/** A marker resolved to its clamped x position, in unix seconds. */
type PositionedAnnotation = ChartAnnotation & {
  x: number;
  /** Label suppressed — a neighbour carries the group label for this cluster. */
  muted?: boolean;
};

/**
 * Merges annotation lists from independent features (alerts, deployments, …)
 * into the single array the chart takes. Returns `undefined` when nothing is
 * left, matching the chart's "no annotations" prop state.
 */
export function mergeAnnotations(
  ...lists: (readonly ChartAnnotation[] | undefined)[]
): ChartAnnotation[] | undefined {
  // `flat` already produces a fresh array, so the sort below never touches the
  // caller's lists — which matters because Recharts 3 keeps props in an Immer
  // store and hands back frozen arrays.
  const merged = lists.filter((list): list is readonly ChartAnnotation[] =>
    Boolean(list?.length),
  );
  if (merged.length === 0) {
    return undefined;
  }
  return merged
    .flat()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

/**
 * Ties markers to the chart's series, dropping the ones that can't be tied to
 * anything visible.
 *
 * A marker only aids correlation if the reader can attribute it. Three cases:
 *
 * - The marker's group has its own series (a chart grouped by service): tint it
 *   to match that line, so a release of one service can't be read as another's.
 * - Every grouped marker shares one group (a tile filtered to one service): the
 *   chart is entirely about that thing, so the markers are unambiguous even
 *   with no series to match. Kept with their own color.
 * - Otherwise — several services' releases over a chart that doesn't break them
 *   out — the marker names something the reader cannot locate on the chart. A
 *   wall of those reads as noise and invites false attribution, so they are
 *   dropped.
 *
 * Markers with no group at all (alerts) are always kept; they describe the
 * whole chart rather than one series.
 */
export function resolveAnnotationSeries(
  annotations: ChartAnnotation[],
  seriesColorFor: (group: string) => string | undefined,
): ChartAnnotation[] {
  const groups = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.group != null) {
      groups.add(annotation.group);
    }
  }
  const isSingleGroup = groups.size <= 1;

  const resolved: ChartAnnotation[] = [];
  for (const annotation of annotations) {
    if (annotation.group == null) {
      resolved.push(annotation);
      continue;
    }
    const seriesColor = seriesColorFor(annotation.group);
    if (seriesColor != null) {
      resolved.push({ ...annotation, color: seriesColor });
    } else if (isSingleGroup) {
      resolved.push(annotation);
    }
  }
  return resolved;
}

function positionAnnotations(
  annotations: ChartAnnotation[],
  [minX, maxX]: [number, number],
): PositionedAnnotation[] {
  const positioned: PositionedAnnotation[] = [];
  for (const annotation of annotations) {
    const seconds = new Date(annotation.time).getTime() / 1000;
    if (!Number.isFinite(seconds)) {
      // An unparseable time would render as a broken line and poison the
      // collapse sort. Drop it rather than draw it.
      continue;
    }
    // Clamp into the visible domain so edge markers snap to the edge.
    positioned.push({
      ...annotation,
      x: Math.min(Math.max(seconds, minX), maxX),
    });
  }
  return positioned;
}

/**
 * Groups markers that are too close together to label individually, keeping one
 * labelled anchor per cluster and muting the rest. Grouping is per `kind`, so an
 * alert marker is never folded into a deploy's count.
 */
function collapseLabels(
  positioned: PositionedAnnotation[],
  pxPerSecond: number,
): PositionedAnnotation[] {
  const byKind = new Map<string, PositionedAnnotation[]>();
  for (const annotation of positioned) {
    const kind = annotation.kind ?? '';
    const bucket = byKind.get(kind);
    if (bucket) {
      bucket.push(annotation);
    } else {
      byKind.set(kind, [annotation]);
    }
  }

  const collapsed: PositionedAnnotation[] = [];
  for (const bucket of byKind.values()) {
    const sorted = [...bucket].sort((a, b) => a.x - b.x);
    const noun = sorted[0].groupNoun ?? 'events';
    let start = 0;
    while (start < sorted.length) {
      const anchor = sorted[start];
      // Measure every candidate against the group's *first* member, not the
      // running last one — otherwise a long run of markers each just under the
      // threshold apart would chain into one arbitrarily wide group. The
      // anchor's label widens to "N events" as it absorbs, so re-measure it.
      let end = start + 1;
      while (end < sorted.length) {
        const groupSize = end - start + 1;
        const anchorLabel =
          groupSize > 1 ? `${groupSize} ${noun}` : anchor.label;
        const required = labelSeparationPx(anchorLabel, sorted[end].label);
        if ((sorted[end].x - anchor.x) * pxPerSecond >= required) {
          break;
        }
        end++;
      }

      const size = end - start;
      collapsed.push(
        size === 1 ? anchor : { ...anchor, label: `${size} ${noun}` },
      );
      for (let i = start + 1; i < end; i++) {
        collapsed.push({ ...sorted[i], label: undefined, muted: true });
      }
      start = end;
    }
  }
  return collapsed;
}

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
 * `plotWidth` (the drawable width in pixels) enables label collapsing for dense
 * clusters. It is optional because the chart cannot measure itself on the first
 * paint; without it every marker is labelled, as before.
 *
 * Generic over source — feature hooks map their events to `ChartAnnotation[]`.
 * Capped at `MAX_ANNOTATION_MARKERS` to protect against pathological inputs.
 */
export function getAnnotationElements(
  annotations: ChartAnnotation[],
  opts: { domain: [number, number]; plotWidth?: number },
): ReactElement[] {
  const [minX, maxX] = opts.domain;
  const positioned = positionAnnotations(annotations, [minX, maxX]);

  // Collapse only when the pixel geometry is known. `plotWidth` is 0 before
  // ResponsiveContainer measures, and the domain collapses to a point on a
  // single-bucket chart — both degrade to "label everything", never to
  // "drop markers".
  const spanSeconds = maxX - minX;
  const plotWidth = opts.plotWidth ?? 0;
  const laidOut =
    plotWidth > 0 && spanSeconds > 0
      ? collapseLabels(positioned, plotWidth / spanSeconds)
      : positioned;

  return laidOut.slice(0, MAX_ANNOTATION_MARKERS).map((annotation, i) => {
    const color = annotation.color ?? 'var(--color-border)';
    return (
      <ReferenceLine
        key={annotation.key ?? `annotation-${annotation.x}-${i}`}
        x={annotation.x}
        stroke={color}
        strokeDasharray="3 3"
        strokeOpacity={annotation.muted ? MUTED_STROKE_OPACITY : STROKE_OPACITY}
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
