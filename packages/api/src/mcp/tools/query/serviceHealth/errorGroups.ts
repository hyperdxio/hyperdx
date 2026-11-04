import { errorStatusPredicateSql } from '@hyperdx/common-utils/dist/core/spanPredicates';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';

import {
  baseConfig,
  columns,
  type HealthSource,
  type QueryContext,
  run,
  SERVICE_ALIAS,
  sqlList,
  toNumberOrNull,
} from './queries';
import type { Window } from './schema';

const ERROR_COUNT_ALIAS = '__hdx_error_count';
const FIRST_SEEN_ALIAS = '__hdx_first_seen';
const HASH_ALIAS = '__hdx_group_hash';
const LAST_SEEN_ALIAS = '__hdx_last_seen';
const errorKeyAlias = (i: number) => `__hdx_error_key_${i}`;

/** Upper bound on error-group rows fetched, before bucketing per service. */
export const MAX_ERROR_ROWS = 2500;

export type ErrorGroup = {
  service: string;
  group: Record<string, string>;
  count: number;
  /** cityHash64 of the group's key, used to look it up in another window. */
  hash?: string;
  /** Epoch ms of the first and last error in the window, if known. */
  firstSeenMs?: number;
  lastSeenMs?: number;
};

/** The value of one grouping expression in an error group. */
export const groupValue = (g: Pick<ErrorGroup, 'group'>, key: string) =>
  new Map(Object.entries(g.group)).get(key);

/** The expressions that define an error group, in output order. */
export function errorGroupExpressions(
  source: HealthSource,
  errorGroupBy: string | undefined,
  split: (s: string) => string[],
): string[] {
  const exprs = errorGroupBy
    ? split(errorGroupBy)
    : [source.spanNameExpression, source.statusMessageExpression];
  return exprs.filter(
    (e): e is string => !!e && e !== source.serviceNameExpression,
  );
}

/**
 * Error counts per (service, group) in one window. `match` restricts rows to
 * exact (service, ...group) tuples, so the comparison window is looked up for
 * the groups found in the current window instead of its own top-N.
 */
export async function fetchErrorGroups(
  ctx: QueryContext,
  window: Window,
  groupExprs: string[],
  scope: { services: string[] } | { match: ErrorGroup[] },
): Promise<ErrorGroup[]> {
  const { source } = ctx;
  const keyExprs = [source.serviceNameExpression, ...groupExprs];
  // Match groups across windows by a fixed-size hash. Inlining the raw key
  // text (status messages can be stack traces) can exceed max_query_size.
  const hashExpr = `cityHash64(${keyExprs.map(e => `toString(${e})`).join(', ')})`;
  const epochMs = `toUnixTimestamp64Milli(toDateTime64(${getFirstTimestampValueExpression(source.timestampValueExpression)}, 3))`;
  const scopeCondition =
    'services' in scope
      ? `${source.serviceNameExpression} IN (${sqlList(scope.services)})`
      : `${hashExpr} IN (${
          scope.match
            .map(g => g.hash)
            .filter((h): h is string => !!h && /^\d+$/.test(h))
            .join(', ') || 'NULL'
        })`;

  const { rows } = await run(ctx, {
    ...baseConfig(ctx, window, [
      {
        type: 'sql',
        condition: errorStatusPredicateSql(source.statusCodeExpression),
      },
      { type: 'sql', condition: scopeCondition },
    ]),
    select: [
      { aggFn: 'count', valueExpression: '', alias: ERROR_COUNT_ALIAS },
      // Epoch ms, because min/max cast their argument to Float64.
      { aggFn: 'min', valueExpression: epochMs, alias: FIRST_SEEN_ALIAS },
      { aggFn: 'max', valueExpression: epochMs, alias: LAST_SEEN_ALIAS },
      // 'none' passes the expression through on the sample-weighted path too.
      { aggFn: 'none', valueExpression: `any(${hashExpr})`, alias: HASH_ALIAS },
    ],
    groupBy: [
      { valueExpression: source.serviceNameExpression, alias: SERVICE_ALIAS },
      ...groupExprs.map((e, i) => ({
        valueExpression: `toString(${e})`,
        alias: errorKeyAlias(i),
      })),
    ],
    orderBy: `${ERROR_COUNT_ALIAS} DESC`,
    limit: { limit: MAX_ERROR_ROWS },
  });

  return rows.map(row => {
    const c = columns(row);
    return {
      service: String(c.get(SERVICE_ALIAS) ?? ''),
      group: Object.fromEntries(
        groupExprs.map((e, i) => [e, String(c.get(errorKeyAlias(i)) ?? '')]),
      ),
      count: Number(c.get(ERROR_COUNT_ALIAS)) || 0,
      hash: String(c.get(HASH_ALIAS) ?? '') || undefined,
      firstSeenMs: toNumberOrNull(c.get(FIRST_SEEN_ALIAS)) || undefined,
      lastSeenMs: toNumberOrNull(c.get(LAST_SEEN_ALIAS)) || undefined,
    };
  });
}

export const errorGroupKey = (g: Pick<ErrorGroup, 'service' | 'group'>) =>
  JSON.stringify([g.service, ...Object.values(g.group)]);
