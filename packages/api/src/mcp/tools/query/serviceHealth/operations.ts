import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { mcpQuerySettings } from '@/mcp/tools/trace/shared';

import type { QueryContext } from './queries';
import { baseConfig } from './queries';
import type { Window } from './schema';

const SERVICE_ALIAS = '__hdx_service';
const OP_ALIAS = '__hdx_operation';
const MAX_OPERATION_ROWS = 5000;
/** A new operation needs this many requests to be reported. */
const NEW_OPERATION_MIN_REQUESTS = 10;
const MAX_NEW_OPERATIONS = 5;

export type NewOperation = {
  operation: string;
  requests: number;
  shareOfService: number;
};

async function operationCounts(
  ctx: QueryContext,
  window: Window,
  services: string[],
): Promise<Map<string, Map<string, number>>> {
  const { source, client, signal } = ctx;
  const list = services.map(s => `'${escapeSqlString(s)}'`).join(', ');
  const result = await client.queryChartConfig({
    config: {
      ...baseConfig(ctx, window, [
        {
          type: 'sql',
          condition: `${source.serviceNameExpression} IN (${list})`,
        },
      ]),
      displayType: DisplayType.Table,
      select: [{ aggFn: 'count', valueExpression: '', alias: 'requests' }],
      groupBy: [
        { valueExpression: source.serviceNameExpression, alias: SERVICE_ALIAS },
        { valueExpression: source.spanNameExpression, alias: OP_ALIAS },
      ],
      limit: { limit: MAX_OPERATION_ROWS },
    },
    metadata: getMetadata(client),
    querySettings: source.querySettings,
    opts: {
      clickhouse_settings: mcpQuerySettings(source.querySettings),
      abort_signal: signal,
    },
  });
  const out = new Map<string, Map<string, number>>();
  for (const row of result.data ?? []) {
    const svc = String(row[SERVICE_ALIAS] ?? '');
    const ops = out.get(svc) ?? new Map<string, number>();
    ops.set(String(row[OP_ALIAS] ?? ''), Number(row.requests) || 0);
    out.set(svc, ops);
  }
  return out;
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
): Promise<Map<string, NewOperation[]>> {
  if (services.length === 0) return new Map();
  const [cur, cmp] = await Promise.all([
    operationCounts(ctx, current, services),
    operationCounts(ctx, comparison, services),
  ]);
  const out = new Map<string, NewOperation[]>();
  for (const [svc, ops] of cur) {
    const total = [...ops.values()].reduce((a, b) => a + b, 0);
    const before = cmp.get(svc);
    const fresh = [...ops]
      .filter(
        ([op, n]) =>
          op !== '' && n >= NEW_OPERATION_MIN_REQUESTS && !before?.get(op),
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NEW_OPERATIONS)
      .map(([operation, requests]) => ({
        operation,
        requests,
        shareOfService: Math.round((requests / total) * 10000) / 10000,
      }));
    if (fresh.length) out.set(svc, fresh);
  }
  return out;
}
