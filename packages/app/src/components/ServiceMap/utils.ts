import router from 'next/router';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';

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

export function getNodeColors(
  errorPercent: number,
  maxErrorPercent: number,
  isSelected: boolean,
) {
  const saturation =
    maxErrorPercent > 0
      ? (Math.min(errorPercent, maxErrorPercent) / maxErrorPercent) * 100
      : 0;
  const backgroundColor = `hsl(0 ${saturation}% 80%)`;
  const borderColor = isSelected ? 'white' : `hsl(0 ${saturation}% 40%)`;

  return {
    backgroundColor,
    borderColor,
  };
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
