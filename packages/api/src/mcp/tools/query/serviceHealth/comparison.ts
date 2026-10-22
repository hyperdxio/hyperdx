import { fetchServiceStats, type QueryContext } from './queries';
import { type ComparisonMode, comparisonWindow, type Window } from './schema';

type Stats = Awaited<ReturnType<typeof fetchServiceStats>>;

export type ResolvedComparison = {
  comparison: Window | null;
  cmp: Stats | null;
  comparisonMode: ComparisonMode;
  comparisonNote: string | undefined;
};

/**
 * An empty comparison window usually means retention or a fresh source, not
 * that every service is new. Comparing against nothing would label every
 * service `new_service` and every error group `new`, which reads as an
 * incident. Fall back to the previous period, and to no comparison if that is
 * empty too.
 */
export async function resolveComparison(
  ctx: QueryContext,
  args: {
    current: Window;
    requested: Window | null;
    requestedMode: ComparisonMode;
    curHasData: boolean;
    requestedCmp: Stats | null;
  },
): Promise<ResolvedComparison> {
  const { current, requested, requestedMode, curHasData, requestedCmp } = args;
  if (!requested || !requestedCmp || !curHasData || requestedCmp.stats.size) {
    return {
      comparison: requested,
      cmp: requestedCmp,
      comparisonMode: requestedMode,
      comparisonNote: undefined,
    };
  }

  const fallback =
    requestedMode === 'previous_period'
      ? null
      : comparisonWindow(current, 'previous_period');
  const fallbackCmp = fallback ? await fetchServiceStats(ctx, fallback) : null;
  if (fallback && fallbackCmp?.stats.size) {
    return {
      comparison: fallback,
      cmp: fallbackCmp,
      comparisonMode: 'previous_period',
      comparisonNote:
        `The "${requestedMode}" window has no data (likely outside retention), ` +
        'so this compares with the previous period instead.',
    };
  }
  return {
    comparison: null,
    cmp: null,
    comparisonMode: 'none',
    comparisonNote:
      `The "${requestedMode}" window${fallback ? ' and the previous period have' : ' has'} ` +
      'no data, so there is no comparison. Only absolute thresholds apply; ' +
      'nothing is labelled new.',
  };
}
