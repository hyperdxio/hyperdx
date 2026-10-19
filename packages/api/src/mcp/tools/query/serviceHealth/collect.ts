import { findNewOperations, type NewOperation } from './operations';
import {
  type ErrorGroup,
  errorGroupKey,
  fetchErrorGroups,
  type QueryContext,
} from './queries';
import {
  ERROR_CANDIDATES_PER_SERVICE,
  type RankedService,
  selectTopErrors,
  topGroupsPerService,
} from './report';
import type { Window } from './schema';

export type CollectedErrors = {
  currentErrors: Map<string, ErrorGroup[]>;
  comparisonErrorCounts: Map<string, number> | null;
  newOperations: Map<string, NewOperation[]>;
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
  },
): Promise<CollectedErrors> {
  const { current, comparison, shown, perService, groupExprs } = args;
  const withErrors = shown
    .filter(r => (r.current?.errors ?? 0) > 0)
    .map(r => r.service);
  const fetchErrors = perService > 0 && withErrors.length > 0;

  const [rows, newOperations] = await Promise.all([
    fetchErrors
      ? fetchErrorGroups(ctx, current, groupExprs, { services: withErrors })
      : Promise.resolve([]),
    comparison
      ? findNewOperations(
          ctx,
          current,
          comparison,
          shown.filter(r => r.current).map(r => r.service),
        )
      : Promise.resolve(new Map<string, NewOperation[]>()),
  ]);

  const candidates = topGroupsPerService(
    rows,
    Math.max(ERROR_CANDIDATES_PER_SERVICE, perService),
  );
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
  for (const [service, groups] of candidates) {
    const newOps = new Set(
      (newOperations.get(service) ?? []).map(o => o.operation),
    );
    currentErrors.set(
      service,
      selectTopErrors(groups, comparisonErrorCounts, perService, g =>
        newOps.has(g.group[spanKey] ?? ''),
      ),
    );
  }
  return { currentErrors, comparisonErrorCounts, newOperations };
}
