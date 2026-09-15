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

/** Error rate above which errors stop being background noise. */
export const ERROR_RATE_ELEVATED = 1;
/** Error rate at or above which a service is considered badly broken. */
export const ERROR_RATE_HIGH = 5;

/**
 * Error-rate color is absolute, not max-normalized: a node's shade has to mean
 * the same thing regardless of how bad the worst service on the graph happens
 * to be, otherwise a map whose worst service sits at 0.3% paints it the same
 * deep red as one at 60%. Each bucket's lower bound is inclusive; zero is not
 * a bucket, it gets a neutral fill so "no errors" is legible at a glance.
 */
const ERROR_RATE_BUCKETS = [
  { min: 0, intensity: 0.35 },
  { min: ERROR_RATE_ELEVATED, intensity: 0.7 },
  { min: ERROR_RATE_HIGH, intensity: 1 },
];

// A hue shift rather than plain desaturation: at 32px a cool grey reads as a
// different kind of thing, where a washed-out red just reads as a little red.
const NEUTRAL = { hue: 220, s: 8, l: 82 };
const NEUTRAL_CSS = `hsl(${NEUTRAL.hue} ${NEUTRAL.s}% ${NEUTRAL.l}%)`;
// Dashed, not merely a different grey: chart-gray is within two points of the
// neutral node's derived border, so colour alone cannot separate "no errors"
// from "no data". Selection thickens the ring, because the usual white one
// would vanish against the white light-mode canvas on a transparent fill.
const NO_DATA_BORDER = 'var(--color-chart-gray)';

/** Ramp position for an error rate above zero; zero is neutral, handled by the caller. */
function getErrorRateIntensity(errorPercentage: number): number {
  let intensity = ERROR_RATE_BUCKETS[0].intensity;
  for (const bucket of ERROR_RATE_BUCKETS) {
    if (errorPercentage >= bucket.min) {
      intensity = bucket.intensity;
    }
  }
  return intensity;
}

export function getNodeColors(
  value: number,
  max: number,
  isSelected: boolean,
  metric: ServiceMapMetric = 'errorRate',
  hasRequests = true,
) {
  // A caller-only service (no Server/Consumer spans in the window) carries no
  // error data at all. A solid neutral fill would claim "no errors" for it, so
  // it renders outline-only: nothing measured, rather than nothing wrong.
  if (metric === 'errorRate' && !hasRequests) {
    return {
      backgroundColor: 'transparent',
      borderColor: NO_DATA_BORDER,
      borderStyle: 'dashed',
      borderWidth: isSelected ? 3 : 1,
    };
  }

  const isNoErrors = metric === 'errorRate' && value <= 0;
  const hue = isNoErrors ? NEUTRAL.hue : SERVICE_MAP_METRIC_HUE[metric];
  const { s, l, css } = isNoErrors
    ? { ...NEUTRAL, css: NEUTRAL_CSS }
    : rampFill(
        hue,
        metric === 'errorRate'
          ? getErrorRateIntensity(value)
          : max > 0
            ? Math.min(value, max) / max
            : 0,
      );
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
    borderStyle: 'solid',
    borderWidth: 1,
  };
}

/**
 * CSS `linear-gradient` for a metric's legend swatch, built from the same ramp
 * stops as the node fills so the legend and the graph always agree. Error rate
 * emits hard stops rather than a blend because its scale is bucketed, so a
 * continuous bar would imply precision the coloring doesn't have.
 */
export function getMetricGradientCss(metric: ServiceMapMetric): string {
  const hue = SERVICE_MAP_METRIC_HUE[metric];
  if (metric === 'errorRate') {
    const stops = [
      NEUTRAL_CSS,
      ...ERROR_RATE_BUCKETS.map(b => rampFill(hue, b.intensity).css),
    ];
    const segments = stops.map(
      (css, i) =>
        `${css} ${(i / stops.length) * 100}% ${((i + 1) / stops.length) * 100}%`,
    );
    return `linear-gradient(to right, ${segments.join(', ')})`;
  }
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
