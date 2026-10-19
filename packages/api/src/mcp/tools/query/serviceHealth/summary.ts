import type { NewOperation } from './operations';
import type { ErrorGroup } from './queries';
import {
  HEALTH_THRESHOLDS,
  type ServiceAssessment,
  type WindowStats,
} from './rank';
import type { Window } from './schema';

/** An error group whose last error is this close to the window end is ongoing. */
const ONGOING_TAIL_MS = 2 * 60_000;

const pct = (s: WindowStats | null) =>
  s && s.requests > 0 ? `${((s.errors / s.requests) * 100).toFixed(2)}%` : '0%';
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

export function errorTiming(g: ErrorGroup, window: Window) {
  if (g.firstSeenMs == null || g.lastSeenMs == null) return {};
  const ongoing = window.end.getTime() - g.lastSeenMs <= ONGOING_TAIL_MS;
  return {
    firstSeen: new Date(g.firstSeenMs).toISOString(),
    lastSeen: new Date(g.lastSeenMs).toISOString(),
    activeMinutes:
      Math.round(((g.lastSeenMs - g.firstSeenMs) / 60_000) * 10) / 10,
    ongoing,
  };
}

function describeError(g: ErrorGroup, window: Window): string {
  const label = Object.values(g.group).filter(Boolean).join(' / ') || 'error';
  const t = errorTiming(g, window);
  if (t.firstSeen == null || g.firstSeenMs == null || g.lastSeenMs == null)
    return `"${label}" (${g.count})`;
  const [from, to] = [hhmm(g.firstSeenMs), hhmm(g.lastSeenMs)];
  const when = from === to ? `at ${from} UTC` : `${from}-${to} UTC`;
  return `"${label}" (${g.count}, ${when}, ${t.ongoing ? 'still occurring' : 'stopped'})`;
}

/**
 * A plain verdict per service. Agents otherwise read every nonzero delta as a
 * trend ("error rate up 0.08pp"), so this states which moves crossed a
 * threshold and which are ordinary variance.
 */
export function serviceSummary(args: {
  current: WindowStats | null;
  comparison: WindowStats | null | undefined;
  assessment: ServiceAssessment;
  changedErrors: ErrorGroup[];
  newOperations: NewOperation[];
  window: Window;
  comparisonMode: string;
  metricSourceId?: string | null;
  spanKind?: string;
}): string {
  const { current, comparison, assessment, changedErrors, window } = args;
  const f = new Set(assessment.flags);
  const parts: string[] = [];
  if (f.has('missing_service'))
    parts.push('no requests now, but had traffic in the comparison window');
  if (f.has('error_rate_up'))
    parts.push(`error rate ${pct(current)} vs ${pct(comparison ?? null)}`);
  else if (f.has('high_error_rate'))
    parts.push(
      `error rate ${pct(current)} is at or above ${HEALTH_THRESHOLDS.highErrorRate * 100}%`,
    );
  if (f.has('latency_up'))
    parts.push(`p95 ${current?.p95Ms}ms vs ${comparison?.p95Ms}ms`);
  if (f.has('traffic_drop'))
    parts.push(`requests ${current?.requests} vs ${comparison?.requests}`);

  const head =
    parts.length > 0
      ? `${assessment.status.toUpperCase()}: ${parts.join('; ')}.`
      : comparison === undefined
        ? 'Healthy: no absolute threshold crossed (no comparison window).'
        : `Healthy: no metric crossed a threshold vs ${args.comparisonMode}; ` +
          'the deltas are normal variance; report this service as steady, no action needed.';

  const context: string[] = [];
  if (f.has('new_service'))
    context.push('No traffic in the comparison window.');
  if (f.has('traffic_spike'))
    context.push('Traffic is well above the comparison window.');
  if (f.has('low_volume')) context.push('Too few requests to judge.');
  if (f.has('latency_up') || f.has('error_rate_up'))
    context.push(
      "Before blaming dependencies, check this service's runtime metrics " +
        '(memory, GC, CPU, restarts) by pod or instance' +
        (args.metricSourceId
          ? ` on metric source ${args.metricSourceId}`
          : ' on a kind="metric" source from clickstack_list_sources') +
        '; slow or failing spans are often a symptom of the service itself.',
    );
  if (args.newOperations.length > 0)
    context.push(
      `New operations, likely a rollout: ${args.newOperations
        .map(
          o =>
            `${o.operation} (${o.requests} requests, ${(o.shareOfService * 100).toFixed(1)}% of traffic)`,
        )
        .join('; ')}.`,
    );
  if (changedErrors.length > 0) {
    const stopped = changedErrors.some(
      g => errorTiming(g, window).ongoing === false,
    );
    context.push(
      `New or growing errors: ${changedErrors.map(g => describeError(g, window)).join('; ')}.` +
        (stopped
          ? ' A burst that stopped is transient, not an ongoing problem.'
          : ''),
    );
  }
  if (args.spanKind === 'all' && assessment.status === 'healthy')
    context.push(
      'Internal and client spans are included, which dilutes server-side ' +
        'changes; check spanKind:"server" before concluding nothing changed.',
    );
  return [head, ...context].join(' ');
}
