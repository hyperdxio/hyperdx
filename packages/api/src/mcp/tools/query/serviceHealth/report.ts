import { type ErrorGroup, errorGroupKey, groupValue } from './errorGroups';
import { MAX_NEW_OPERATIONS, type NewOperation } from './operations';
import {
  assessService,
  compareAssessments,
  HEALTH_THRESHOLDS,
  type HealthFlag,
  type HealthStatus,
  type ServiceAssessment,
  STATUS_ORDER,
  type WindowStats,
} from './rank';
import type { Window } from './schema';
import { errorTiming, serviceSummary } from './summary';

export type RankedService = {
  service: string;
  current: WindowStats | null;
  /** undefined when comparisons are off; null when the service was absent. */
  comparison: WindowStats | null | undefined;
  assessment: ServiceAssessment;
};

/** Assess every service seen in either window and sort worst first. */
export function rankServices(
  current: Map<string, WindowStats>,
  comparison: Map<string, WindowStats> | null,
  minRequests: number,
): RankedService[] {
  const names = new Set([...current.keys(), ...(comparison?.keys() ?? [])]);
  return [...names]
    .map(service => {
      const cur = current.get(service) ?? null;
      const cmp = comparison ? (comparison.get(service) ?? null) : undefined;
      return {
        service,
        current: cur,
        comparison: cmp,
        assessment: assessService(cur, cmp, minRequests),
      };
    })
    .sort((a, b) =>
      compareAssessments(
        {
          assessment: a.assessment,
          errors: a.current?.errors ?? 0,
          requests: a.current?.requests ?? 0,
        },
        {
          assessment: b.assessment,
          errors: b.current?.errors ?? 0,
          requests: b.current?.requests ?? 0,
        },
      ),
    );
}

/** The first `perService` groups for each service; input is sorted by count. */
export function topGroupsPerService(
  groups: ErrorGroup[],
  perService: number,
): Map<string, ErrorGroup[]> {
  const out = new Map<string, ErrorGroup[]>();
  for (const g of groups) {
    const list = out.get(g.service) ?? [];
    if (list.length < perService) list.push(g);
    out.set(g.service, list);
  }
  return out;
}

/** Candidate groups fetched per service before choosing the ones to show. */
export const ERROR_CANDIDATES_PER_SERVICE = 25;
/** A new group needs at least this many errors to be called out. */
const NEW_ERROR_MIN = 3;
/**
 * Growth must clear this z-score, treating both counts as Poisson. Small
 * counts swing a lot by chance (5 -> 13 is within noise across dozens of
 * groups); 2x alone flags them.
 */
const GROWTH_MIN_Z = 3;

export type ErrorGroupStatus = 'new' | 'growing' | 'existing' | 'new_operation';

export function errorGroupStatus(
  count: number,
  comparisonCount: number,
): ErrorGroupStatus {
  if (comparisonCount === 0) return 'new';
  const z = (count - comparisonCount) / Math.sqrt(count + comparisonCount);
  return count >= 2 * comparisonCount && z >= GROWTH_MIN_Z
    ? 'growing'
    : 'existing';
}

const isChanged = (count: number, comparisonCount: number) => {
  const status = errorGroupStatus(count, comparisonCount);
  return status === 'growing' || (status === 'new' && count >= NEW_ERROR_MIN);
};

/**
 * Pick the groups to show for one service. With a comparison, new and growing
 * groups come first, largest gain first: a burst of a novel error is the
 * finding, and ranking by count alone buries it under steady background
 * errors. The remaining slots go to the largest groups.
 */
export function selectTopErrors(
  candidates: ErrorGroup[],
  comparisonCounts: Map<string, number> | null,
  limit: number,
  explained: (g: ErrorGroup) => boolean = () => false,
): ErrorGroup[] {
  if (!comparisonCounts) return candidates.slice(0, limit);
  const prior = (g: ErrorGroup) => comparisonCounts.get(errorGroupKey(g)) ?? 0;
  const novel = (g: ErrorGroup) =>
    isChanged(g.count, prior(g)) && !explained(g);
  const changed = candidates
    .filter(novel)
    .sort((a, b) => b.count - prior(b) - (a.count - prior(a)));
  const rest = candidates.filter(g => !novel(g));
  return [...changed, ...rest].slice(0, limit);
}

function formatStats(s: WindowStats | null, windowMinutes: number) {
  const requests = s?.requests ?? 0;
  const errors = s?.errors ?? 0;
  return {
    requests,
    throughputPerMin: Math.round((requests / windowMinutes) * 100) / 100,
    errors,
    errorRate:
      requests > 0 ? Math.round((errors / requests) * 10000) / 10000 : 0,
    p50Ms: s?.p50Ms ?? null,
    p95Ms: s?.p95Ms ?? null,
    p99Ms: s?.p99Ms ?? null,
  };
}

const iso = (w: Window) => ({
  start: w.start.toISOString(),
  end: w.end.toISOString(),
});

const USAGE =
  'Services are sorted by status (critical, degraded, healthy), then score. ' +
  `error_rate_up: error rate >= ${HEALTH_THRESHOLDS.errorRateRatio}x the comparison AND ` +
  `>= ${HEALTH_THRESHOLDS.errorRateMinDeltaPp} percentage point higher. ` +
  `high_error_rate: error rate >= ${HEALTH_THRESHOLDS.highErrorRate * 100}%. ` +
  'critical = error_rate_up together with high_error_rate. ' +
  `latency_up: p95 >= ${HEALTH_THRESHOLDS.latencyRatio}x AND >= ${HEALTH_THRESHOLDS.latencyMinDeltaMs}ms slower. ` +
  `traffic_drop: requests <= ${HEALTH_THRESHOLDS.trafficDropRatio * 100}% of the comparison. ` +
  'missing_service: served requests in the comparison window but none now. ' +
  'Any of those makes a service degraded. traffic_spike, new_service and ' +
  'low_volume (under minRequests in both windows, never flagged) and ' +
  'new_errors (a listed error group is new or growing; such services sort ' +
  'first within their status) are context only. Healthy services are not ' +
  'regressions: report them as steady, and treat moves below these ' +
  "thresholds as normal variance. Each service's " +
  '`summary` states which moves crossed one. topErrors carry firstSeen / ' +
  'lastSeen and a pattern: ongoing (still firing), spread (most of the ' +
  'window, quiet now; not proven resolved) or burst (short, so transient). topErrors lists new and ' +
  'growing error groups first (largest gain first), then the largest steady ' +
  'ones. newOperations = span names with traffic now and none in the ' +
  'comparison window (usually a rollout); errors on them have status ' +
  '"new_operation". status "new" = absent from the comparison window, "growing" = at ' +
  'least 2x its comparison count and beyond random variation, "existing" = ' +
  'otherwise.';

/** Without real prior traffic every error group looks new; skip novelty. */
export const hasBaseline = (r: RankedService) =>
  !r.assessment.flags.some(f => f === 'new_service' || f === 'low_volume');

export function buildReport(args: {
  ranked: RankedService[];
  current: Window;
  comparison: Window | null;
  comparisonMode: string;
  comparisonNote?: string;
  coverageNote?: string;
  spanKind: string;
  topN: number;
  errorGroupBy: string[];
  currentErrors: Map<string, ErrorGroup[]>;
  comparisonErrorCounts: Map<string, number> | null;
  newOperations: Map<string, NewOperation[]>;
  spanNameKey: string;
  metricSourceId?: string | null;
}) {
  const onNewOperation = (r: RankedService, g: ErrorGroup) =>
    (args.newOperations.get(r.service) ?? []).some(
      o => o.operation === groupValue(g, args.spanNameKey),
    );
  const windowMinutes =
    (args.current.end.getTime() - args.current.start.getTime()) / 60_000;
  const counts: Record<HealthStatus, number> = {
    critical: 0,
    degraded: 0,
    healthy: 0,
  };
  for (const r of args.ranked) counts[r.assessment.status]++;

  const prior = (g: ErrorGroup) =>
    args.comparisonErrorCounts?.get(errorGroupKey(g)) ?? 0;
  const changedErrors = (r: RankedService) =>
    args.comparisonErrorCounts && hasBaseline(r)
      ? (args.currentErrors.get(r.service) ?? []).filter(
          g => isChanged(g.count, prior(g)) && !onNewOperation(r, g),
        )
      : [];
  const hasNewErrors = (r: RankedService) => changedErrors(r).length > 0;
  // Within a status, a service with a new or growing error group goes first:
  // its aggregate rates may be flat, but it has the most novel signal.
  const shown = args.ranked
    .map((r, i) => ({ r, i, novel: hasNewErrors(r) }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.r.assessment.status] -
          STATUS_ORDER[b.r.assessment.status] ||
        Number(b.novel) - Number(a.novel) ||
        a.i - b.i,
    )
    .slice(0, args.topN);

  const services = shown.map(({ r, novel }, i) => ({
    rank: i + 1,
    service: r.service,
    status: r.assessment.status,
    flags: novel
      ? [...r.assessment.flags, 'new_errors' satisfies HealthFlag]
      : r.assessment.flags,
    summary: serviceSummary({
      current: r.current,
      comparison: r.comparison,
      assessment: r.assessment,
      changedErrors: changedErrors(r),
      newOperations: (args.newOperations.get(r.service) ?? []).slice(
        0,
        MAX_NEW_OPERATIONS,
      ),
      window: args.current,
      comparisonMode: args.comparisonMode,
      metricSourceId: args.metricSourceId,
      spanKind: args.spanKind,
    }),
    score: r.assessment.score,
    current: formatStats(r.current, windowMinutes),
    ...(r.comparison !== undefined && {
      comparison: r.comparison
        ? formatStats(r.comparison, windowMinutes)
        : null,
      deltas: r.assessment.deltas,
    }),
    ...(args.newOperations.has(r.service) && {
      newOperations: args.newOperations
        .get(r.service)
        ?.slice(0, MAX_NEW_OPERATIONS),
    }),
    topErrors: (args.currentErrors.get(r.service) ?? []).map(g => {
      const comparisonCount = prior(g);
      return {
        group: g.group,
        count: g.count,
        ...errorTiming(g, args.current),
        ...(args.comparisonErrorCounts &&
          hasBaseline(r) && {
            comparisonCount,
            status: onNewOperation(r, g)
              ? ('new_operation' satisfies ErrorGroupStatus)
              : errorGroupStatus(g.count, comparisonCount),
          }),
      };
    }),
  }));

  return {
    summary: {
      currentWindow: iso(args.current),
      comparisonWindow: args.comparison ? iso(args.comparison) : null,
      comparison: args.comparisonMode,
      spanKind: args.spanKind,
      errorGroupBy: args.errorGroupBy,
      servicesAssessed: args.ranked.length,
      servicesReturned: services.length,
      statusCounts: counts,
      ...(args.ranked.length === 0 && {
        warning:
          'No spans matched in either window. Check the time window, the ' +
          'where filter, and spanKind ("server" skips sources without server ' +
          'spans; try spanKind:"all").',
      }),
      ...(args.comparisonNote && { comparisonNote: args.comparisonNote }),
      ...(args.coverageNote && { coverageNote: args.coverageNote }),
    },
    services,
    usage: USAGE,
  };
}
