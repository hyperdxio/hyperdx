import type { QueryContext } from './queries';
import { baseConfig, columns, run, SERVICE_ALIAS, sqlList } from './queries';
import type { Window } from './schema';

const OP_ALIAS = '__hdx_operation';
const MAX_OPERATION_ROWS = 5000;
/** A new operation needs this many requests to be reported. */
const NEW_OPERATION_MIN_REQUESTS = 10;
/** New operations shown per service; all of them still classify errors. */
export const MAX_NEW_OPERATIONS = 5;

export type NewOperation = {
  operation: string;
  requests: number;
  shareOfService: number;
};

async function operationCounts(
  ctx: QueryContext,
  window: Window,
  services: string[],
): Promise<{ counts: Map<string, Map<string, number>>; truncated: boolean }> {
  const { source } = ctx;
  const { rows } = await run(ctx, {
    ...baseConfig(ctx, window, [
      {
        type: 'sql',
        condition: `${source.serviceNameExpression} IN (${sqlList(services)})`,
      },
    ]),
    select: [{ aggFn: 'count', valueExpression: '', alias: 'requests' }],
    groupBy: [
      { valueExpression: source.serviceNameExpression, alias: SERVICE_ALIAS },
      { valueExpression: source.spanNameExpression, alias: OP_ALIAS },
    ],
    limit: { limit: MAX_OPERATION_ROWS },
  });
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const c = columns(row);
    const svc = String(c.get(SERVICE_ALIAS) ?? '');
    const ops = out.get(svc) ?? new Map<string, number>();
    ops.set(String(c.get(OP_ALIAS) ?? ''), Number(row.requests) || 0);
    out.set(svc, ops);
  }
  return { counts: out, truncated: rows.length >= MAX_OPERATION_ROWS };
}

/**
 * Operations (span names) with traffic now and none in the comparison
 * window, per service: usually a rollout. Errors on them are explained by the
 * operation being new, not by a new failure mode.
 */
export async function findNewOperations(
  ctx: QueryContext,
  current: Window,
  comparison: Window,
  services: string[],
  minPriorRequests: number,
): Promise<{ newOperations: Map<string, NewOperation[]>; complete: boolean }> {
  const out = new Map<string, NewOperation[]>();
  if (services.length === 0) return { newOperations: out, complete: true };
  const [curRes, cmpRes] = await Promise.all([
    operationCounts(ctx, current, services),
    operationCounts(ctx, comparison, services),
  ]);
  // A truncated comparison can omit operations that did exist, which would
  // make them look new. Report nothing rather than guess.
  if (curRes.truncated || cmpRes.truncated) {
    return { newOperations: out, complete: false };
  }
  const cmp = cmpRes.counts;
  for (const [svc, ops] of curRes.counts) {
    const total = [...ops.values()].reduce((a, b) => a + b, 0);
    const before = cmp.get(svc);
    // A service with no real prior traffic is new as a whole (new_service);
    // calling each of its operations a rollout would be noise.
    const priorTotal = [...(before?.values() ?? [])].reduce((a, b) => a + b, 0);
    if (priorTotal < minPriorRequests) continue;
    const fresh = [...ops]
      .filter(
        ([op, n]) =>
          op !== '' && n >= NEW_OPERATION_MIN_REQUESTS && !before?.get(op),
      )
      .sort((a, b) => b[1] - a[1])
      .map(([operation, requests]) => ({
        operation,
        requests,
        shareOfService: Math.round((requests / total) * 10000) / 10000,
      }));
    if (fresh.length) out.set(svc, fresh);
  }
  return { newOperations: out, complete: true };
}
