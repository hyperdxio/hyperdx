import router from 'next/router';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';

import type { ServiceAggregation } from '@/hooks/useServiceMap';

export function navigateToTraceSearch({
  dateRange,
  source,
  where,
}: {
  dateRange: [Date, Date];
  source: TTraceSource;
  where: string;
}) {
  const from = dateRange[0].getTime().toString();
  const to = dateRange[1].getTime().toString();
  const query = new URLSearchParams({
    isLive: 'false',
    source: source?.id,
    where,
    whereLanguage: 'sql',
    from,
    to,
  });

  router.push(`/search?${query.toString()}`);
}

export function formatApproximateNumber(num: number): string {
  if (num < 1000) {
    return `~${num.toString()}`;
  }

  if (num < 1_000_000) {
    const thousands = num / 1000;
    return `~${Math.round(thousands)}k`;
  }

  if (num < 1_000_000_000) {
    const millions = num / 1_000_000;
    return `~${Math.round(millions)}M`;
  }

  const billions = num / 1_000_000_000;
  return `~${Math.round(billions)}B`;
}

/**
 * The metric that drives node coloring on the service map. The user switches
 * between these with the segmented control; each maps to a distinct hue so the
 * color scale reads as a different dimension (red = errors, amber = latency,
 * blue = throughput).
 */
export type ServiceMapMetric = 'errorRate' | 'latency' | 'throughput';

export const SERVICE_MAP_METRICS: ServiceMapMetric[] = [
  'latency',
  'errorRate',
  'throughput',
];

export const SERVICE_MAP_METRIC_LABEL: Record<ServiceMapMetric, string> = {
  errorRate: 'Error rate',
  latency: 'Latency',
  throughput: 'Throughput',
};

// Hue (HSL) used for each metric's color ramp. Saturation encodes intensity.
export const SERVICE_MAP_METRIC_HUE: Record<ServiceMapMetric, number> = {
  errorRate: 0, // red
  latency: 35, // amber
  throughput: 210, // blue
};

/**
 * The comparable scalar used to rank a service for a given metric. This is the
 * value that gets normalized against the graph-wide max to derive color
 * intensity, so the same helper drives both the per-node color and the legend's
 * max label. Latency uses p95 (raw duration units); throughput is total
 * incoming + outgoing request volume (matching how node size is scaled).
 */
export function getServiceMetricValue(
  service: ServiceAggregation,
  metric: ServiceMapMetric,
): number {
  const { incomingRequests, outgoingRequests } = service;
  switch (metric) {
    case 'errorRate':
      return incomingRequests.errorPercentage;
    case 'latency':
      return incomingRequests.hasLatency ? incomingRequests.p95 : 0;
    case 'throughput':
      return incomingRequests.totalRequests + outgoingRequests;
  }
}

// Sequential color ramp shared by every metric — only the hue differs. As
// intensity rises the fill goes from a light tint (high lightness, low
// saturation) to a dark, saturated shade, i.e. a proper light→dark sequential
// scale rather than a grey→color saturation ramp. Endpoints are tuned to read
// on both the light and dark canvas.
const RAMP_SATURATION = { from: 35, to: 72 };
const RAMP_LIGHTNESS = { from: 90, to: 42 };
// The border is the same hue/saturation as the fill but a fixed step darker so
// nodes keep a crisp outline at every intensity (and in light mode).
const BORDER_LIGHTNESS_STEP = 24;
const BORDER_MIN_LIGHTNESS = 18;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Background fill for a node/legend stop at a normalized intensity (0..1) on a
 * metric's ramp. Saturation and lightness are rounded so the emitted HSL string
 * is stable and free of floating-point noise.
 */
function rampFill(hue: number, intensity: number) {
  const t = clamp01(intensity);
  const s = Math.round(lerp(RAMP_SATURATION.from, RAMP_SATURATION.to, t));
  const l = Math.round(lerp(RAMP_LIGHTNESS.from, RAMP_LIGHTNESS.to, t));
  return { s, l, css: `hsl(${hue} ${s}% ${l}%)` };
}

export function getNodeColors(
  value: number,
  max: number,
  isSelected: boolean,
  metric: ServiceMapMetric = 'errorRate',
) {
  const intensity = max > 0 ? Math.min(value, max) / max : 0;
  const hue = SERVICE_MAP_METRIC_HUE[metric];
  const { s, l, css } = rampFill(hue, intensity);
  const borderLightness = Math.max(
    l - BORDER_LIGHTNESS_STEP,
    BORDER_MIN_LIGHTNESS,
  );
  const borderColor = isSelected
    ? 'white'
    : `hsl(${hue} ${s}% ${borderLightness}%)`;

  return {
    backgroundColor: css,
    borderColor,
  };
}

/**
 * CSS `linear-gradient` for a metric's legend swatch, built from the same ramp
 * endpoints as the node fills so the legend and the graph always agree.
 */
export function getMetricGradientCss(metric: ServiceMapMetric): string {
  const hue = SERVICE_MAP_METRIC_HUE[metric];
  return `linear-gradient(to right, ${rampFill(hue, 0).css}, ${rampFill(hue, 1).css})`;
}

/**
 * Converts a raw duration column value into milliseconds using the source's
 * `durationPrecision` (the base-10 exponent of the stored unit: 9 = ns,
 * 6 = µs, 3 = ms). Mirrors the conversion used by the trace waterfall so the
 * service map reports latency in the same units as the rest of the app.
 */
export function rawDurationToMs(
  rawDuration: number,
  durationPrecision: number,
): number {
  // ms = raw * 10^(3 - precision). Multiplying keeps an exact integer factor
  // for precision < 3 (e.g. 0 = seconds) instead of dividing by a fractional
  // divisor; matches getDurationSecondsExpression's unit conversion.
  return rawDuration * Math.pow(10, 3 - durationPrecision);
}

/**
 * Normalizes a total request count over a time window into a per-second rate
 * (throughput). Returns 0 for non-positive windows.
 */
export function getRequestsPerSecond(
  totalRequests: number,
  dateRange: [Date, Date],
): number {
  const windowSeconds =
    (dateRange[1].getTime() - dateRange[0].getTime()) / 1000;
  if (windowSeconds <= 0) {
    return 0;
  }
  return totalRequests / windowSeconds;
}

/**
 * Formats a per-second request rate for display, with an explicit unit label,
 * e.g. "1.2k req/s", "5.0 req/s", "0.20 req/s".
 */
export function formatRate(perSecond: number): string {
  if (!Number.isFinite(perSecond) || perSecond <= 0) {
    return '0 req/s';
  }
  if (perSecond >= 1000) {
    return `${(perSecond / 1000).toFixed(1)}k req/s`;
  }
  if (perSecond >= 1) {
    return `${perSecond.toFixed(1)} req/s`;
  }
  return `${perSecond.toFixed(2)} req/s`;
}

const MIN_NODE_SIZE = 32;
const MAX_NODE_SIZE = 60;

/**
 * Scales a node's diameter (px) by its total throughput (incoming + outgoing
 * requests) relative to the busiest node, so heavier-traffic services read as
 * larger. Uses a square-root scale so visual *area* tracks volume rather than
 * diameter. Falls back to the minimum size when there's nothing to compare.
 */
export function getNodeSize(throughput: number, maxThroughput: number): number {
  if (maxThroughput <= 0 || throughput <= 0) {
    return MIN_NODE_SIZE;
  }
  const ratio = Math.sqrt(Math.min(throughput, maxThroughput) / maxThroughput);
  return Math.round(MIN_NODE_SIZE + ratio * (MAX_NODE_SIZE - MIN_NODE_SIZE));
}

export type DisplayStats = {
  totalRequests: number;
  p50: number;
  p95: number;
  p99: number;
  hasLatency: boolean;
};

/**
 * Derives the latency/throughput a tooltip shows from a node's or edge's raw
 * stats. Shared by ServiceMapNode and ServiceMapEdge so the two stay in sync:
 * latency is converted to ms (only when available), throughput is omitted for
 * single-trace maps where a per-second rate is meaningless.
 */
export function deriveDisplayMetrics(
  stats: DisplayStats,
  source: TTraceSource,
  dateRange: [Date, Date],
  isSingleTrace?: boolean,
): {
  latencyMs?: { p50: number; p95: number; p99: number };
  requestsPerSecond?: number;
} {
  // Fallback matches the schema default (3 = ms); in practice the field is
  // always present on a parsed source.
  const precision = source.durationPrecision ?? 3;
  return {
    latencyMs: stats.hasLatency
      ? {
          p50: rawDurationToMs(stats.p50, precision),
          p95: rawDurationToMs(stats.p95, precision),
          p99: rawDurationToMs(stats.p99, precision),
        }
      : undefined,
    requestsPerSecond: isSingleTrace
      ? undefined
      : getRequestsPerSecond(stats.totalRequests, dateRange),
  };
}
