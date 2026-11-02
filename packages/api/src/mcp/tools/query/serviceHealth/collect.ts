import {
  type ErrorGroup,
  errorGroupKey,
  fetchErrorGroups,
  groupValue,
  MAX_ERROR_ROWS,
} from './errorGroups';
import { findNewOperations, type NewOperation } from './operations';
import type { QueryContext } from './queries';
import {
  ERROR_CANDIDATES_PER_SERVICE,
  hasBaseline,
  type RankedService,
  selectTopErrors,
  topGroupsPerService,
} from './report';
import type { Window } from './schema';

export type CollectedErrors = {
  currentErrors: Map<string, ErrorGroup[]>;
  comparisonErrorCounts: Map<string, number> | null;
  newOperations: Map<string, NewOperation[]>;
  /** Set when a limit kept some services or error groups out of the check. */
  coverageNote: string | undefined;
};

/**
 * Error groups and new operations for the services that will be shown.
 * Errors on a brand-new operation are expected (it had no traffic before), so
 * they do not compete with genuinely new failure modes for the top slots.
 */
export async function collectErrors(
  ctx: QueryContext,
  args: {
    current: Window;
    comparison: Window | null;
    shown: RankedService[];
    perService: number;
    groupExprs: string[];
    minRequests: number;
    /** Services assessed in total; `shown` may be a prefix of them. */
    totalServices: number;
  },
): Promise<CollectedErrors> {
  const { current, comparison, shown, perService, groupExprs, minRequests } =
    args;
  const withErrors = shown
    .filter(r => (r.current?.errors ?? 0) > 0)
    .map(r => r.service);
  const fetchErrors = perService > 0 && withErrors.length > 0;

  const [rows, ops] = await Promise.all([
    fetchErrors
      ? fetchErrorGroups(ctx, current, groupExprs, { services: withErrors })
      : Promise.resolve([]),
    comparison
      ? findNewOperations(
          ctx,
          current,
          comparison,
          shown.filter(r => r.current).map(r => r.service),
          minRequests,
        )
      : Promise.resolve({
          newOperations: new Map<string, NewOperation[]>(),
          complete: true,
        }),
  ]);
  const { newOperations } = ops;

  const perServiceCap = Math.max(ERROR_CANDIDATES_PER_SERVICE, perService);
  const candidates = topGroupsPerService(rows, perServiceCap);
  const all = [...candidates.values()].flat();
  const comparisonErrorCounts =
    comparison && all.length
      ? new Map(
          (
            await fetchErrorGroups(ctx, comparison, groupExprs, { match: all })
          ).map(g => [errorGroupKey(g), g.count]),
        )
      : null;

  const spanKey = ctx.source.spanNameExpression;
  const currentErrors = new Map<string, ErrorGroup[]>();
  const baseline = new Map(shown.map(r => [r.service, hasBaseline(r)]));
  for (const [service, groups] of candidates) {
    const newOps = new Set(
      (newOperations.get(service) ?? []).map(o => o.operation),
    );
    currentErrors.set(
      service,
      selectTopErrors(
        groups,
        comparisonErrorCounts,
        perService,
        g => !baseline.get(service) || newOps.has(groupValue(g, spanKey) ?? ''),
      ),
    );
  }
  const groupsPerService = new Map<string, number>();
  for (const g of rows) {
    groupsPerService.set(g.service, (groupsPerService.get(g.service) ?? 0) + 1);
  }
  const limits = [
    args.totalServices > shown.length &&
      `only the first ${shown.length} of ${args.totalServices} services were checked for new errors`,
    rows.length >= MAX_ERROR_ROWS &&
      `the error query hit its ${MAX_ERROR_ROWS}-row limit`,
    [...groupsPerService.values()].some(n => n > perServiceCap) &&
      `only the ${perServiceCap} largest error groups per service were compared`,
    !ops.complete &&
      'too many operations to detect new ones reliably, so none are reported',
  ].filter((x): x is string => typeof x === 'string');
  const coverageNote = limits.length
    ? `Incomplete: ${limits.join('; ')}. Narrow with services or a where filter for a full check.`
    : undefined;

  return { currentErrors, comparisonErrorCounts, newOperations, coverageNote };
}
