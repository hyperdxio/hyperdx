/**
 * Thresholds that decide when a service is flagged. Each "up" rule needs a
 * ratio AND an absolute delta: the ratio alone flags 0.1% → 0.3% errors or
 * 4ms → 8ms latency, which is routine variance, not degraded health.
 */
export const HEALTH_THRESHOLDS = {
  /** error_rate_up: current error rate at least this multiple of the comparison... */
  errorRateRatio: 2,
  /** ...and at least this many percentage points higher. */
  errorRateMinDeltaPp: 1,
  /** high_error_rate, and critical when combined with error_rate_up. */
  highErrorRate: 0.05,
  /** latency_up: p95 at least this multiple of the comparison... */
  latencyRatio: 1.5,
  /** ...and at least this many ms slower. */
  latencyMinDeltaMs: 50,
  /** traffic_drop: requests at or below this fraction of the comparison. */
  trafficDropRatio: 0.5,
  /** traffic_spike (informational): requests at least this multiple. */
  trafficSpikeRatio: 3,
} as const;

export type WindowStats = {
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

export type HealthFlag =
  | 'error_rate_up'
  | 'high_error_rate'
  | 'latency_up'
  | 'traffic_drop'
  | 'missing_service'
  // Context for the reader; these never change status.
  | 'traffic_spike'
  | 'new_service'
  | 'low_volume'
  // Set by the report: a shown error group is new or growing.
  | 'new_errors';

const DEGRADING_FLAGS: ReadonlySet<HealthFlag> = new Set<HealthFlag>([
  'error_rate_up',
  'high_error_rate',
  'latency_up',
  'traffic_drop',
  'missing_service',
]);
export type HealthStatus = 'critical' | 'degraded' | 'healthy';

export type ServiceAssessment = {
  status: HealthStatus;
  flags: HealthFlag[];
  score: number;
  deltas: {
    throughputRatio: number | null;
    errorRateDeltaPp: number | null;
    p95Ratio: number | null;
    p95DeltaMs: number | null;
  };
};

export const STATUS_ORDER: Record<HealthStatus, number> = {
  critical: 0,
  degraded: 1,
  healthy: 2,
};

const errorRate = (s: WindowStats) =>
  s.requests > 0 ? s.errors / s.requests : 0;

const round = (n: number, places = 4) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/**
 * Assess one service. `comparison` is undefined when comparisons are off, and
 * null when they are on but the service had no requests in that window.
 */
export function assessService(
  current: WindowStats | null,
  comparison: WindowStats | null | undefined,
  minRequests: number,
): ServiceAssessment {
  const cur = current ?? {
    requests: 0,
    errors: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
  };
  const cmp = comparison ?? null;
  const comparing = comparison !== undefined;
  const flags: HealthFlag[] = [];

  const curRate = errorRate(cur);
  const cmpRate = cmp ? errorRate(cmp) : null;
  const errorRateDeltaPp =
    cmpRate != null ? round((curRate - cmpRate) * 100) : null;
  const throughputRatio =
    cmp && cmp.requests > 0 ? round(cur.requests / cmp.requests) : null;
  const p95Ratio =
    cmp?.p95Ms && cur.p95Ms != null ? round(cur.p95Ms / cmp.p95Ms) : null;
  const p95DeltaMs =
    cmp?.p95Ms != null && cur.p95Ms != null
      ? round(cur.p95Ms - cmp.p95Ms, 2)
      : null;

  const curEnough = cur.requests >= minRequests;
  const cmpEnough = (cmp?.requests ?? 0) >= minRequests;

  if (!curEnough && !cmpEnough) {
    flags.push('low_volume');
  } else if (comparing && !cmpEnough && curEnough) {
    // A handful of prior requests is not a baseline; treat it like none.
    flags.push('new_service');
  } else if (comparing && cmp && cur.requests === 0) {
    flags.push('missing_service');
  }

  if (curEnough) {
    if (curRate >= HEALTH_THRESHOLDS.highErrorRate)
      flags.push('high_error_rate');
    if (
      cmpEnough &&
      cmpRate != null &&
      curRate >= cmpRate * HEALTH_THRESHOLDS.errorRateRatio &&
      (errorRateDeltaPp ?? 0) >= HEALTH_THRESHOLDS.errorRateMinDeltaPp
    ) {
      flags.push('error_rate_up');
    }
    if (
      cmpEnough &&
      p95Ratio != null &&
      p95Ratio >= HEALTH_THRESHOLDS.latencyRatio &&
      (p95DeltaMs ?? 0) >= HEALTH_THRESHOLDS.latencyMinDeltaMs
    ) {
      flags.push('latency_up');
    }
    if (
      cmpEnough &&
      throughputRatio != null &&
      throughputRatio >= HEALTH_THRESHOLDS.trafficSpikeRatio
    ) {
      flags.push('traffic_spike');
    }
  }
  if (
    cmpEnough &&
    cur.requests > 0 &&
    throughputRatio != null &&
    throughputRatio <= HEALTH_THRESHOLDS.trafficDropRatio
  ) {
    flags.push('traffic_drop');
  }

  const status: HealthStatus =
    flags.includes('error_rate_up') &&
    curRate >= HEALTH_THRESHOLDS.highErrorRate
      ? 'critical'
      : flags.some(f => DEGRADING_FLAGS.has(f))
        ? 'degraded'
        : 'healthy';

  return {
    status,
    flags,
    // Too few requests to judge, so it should not outrank real services.
    score: flags.includes('low_volume')
      ? 0
      : severityScore(cur, cmp, { curRate, cmpRate, p95Ratio }),
    deltas: { throughputRatio, errorRateDeltaPp, p95Ratio, p95DeltaMs },
  };
}

/**
 * Orders services within a status. Sums how far each metric moved the wrong
 * way, then scales by log volume so a busy service outranks a quiet one with
 * the same shift. Error points are percentage points; latency and traffic are
 * log2 ratios, so doubling p95 weighs the same as +2pp errors.
 */
function severityScore(
  cur: WindowStats,
  cmp: WindowStats | null,
  m: { curRate: number; cmpRate: number | null; p95Ratio: number | null },
): number {
  const errorPp = Math.max(0, m.curRate - (m.cmpRate ?? 0)) * 100;
  const latency = m.p95Ratio && m.p95Ratio > 1 ? 2 * Math.log2(m.p95Ratio) : 0;
  const traffic =
    cmp && cmp.requests > 0 && cur.requests < cmp.requests
      ? Math.log2(cmp.requests / Math.max(cur.requests, 1))
      : 0;
  const volume = Math.log10(Math.max(cur.requests, cmp?.requests ?? 0) + 10);
  return round((errorPp + latency + traffic) * volume, 2);
}

export function compareAssessments(
  a: { assessment: ServiceAssessment; errors: number; requests: number },
  b: { assessment: ServiceAssessment; errors: number; requests: number },
): number {
  return (
    STATUS_ORDER[a.assessment.status] - STATUS_ORDER[b.assessment.status] ||
    b.assessment.score - a.assessment.score ||
    b.errors - a.errors ||
    b.requests - a.requests
  );
}
