import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { errorStatusPredicateSql } from '@hyperdx/common-utils/dist/core/spanPredicates';

import type { KnowledgeTarget } from '@/knowledge/target';

import { datastoreKey, serviceKey } from './nodeKey';
import {
  datastoreColumns,
  p95MsSql,
  renderSpanCtes,
  traceSourceOf,
} from './sql';

export type NodeDelta = {
  node: string;
  requests: number;
  baselineRequests: number;
  errorRate: number;
  baselineErrorRate: number;
  p95Ms: number | null;
  baselineP95Ms: number | null;
};

export function isAnomalous(d: NodeDelta): boolean {
  // Rounded so 0.06 - 0.01 counts as 5 points despite float error.
  if (Number((d.errorRate - d.baselineErrorRate).toFixed(6)) >= 0.05)
    return true;
  if (d.p95Ms == null || d.baselineP95Ms == null) return false;
  const rise = d.p95Ms - d.baselineP95Ms;
  return rise >= 50 && rise >= 0.5 * d.baselineP95Ms;
}

type Row = {
  kind: 'service' | 'datastore';
  name: string;
  a0: string;
  a1: string;
  a2: string;
  a3: string;
  requests: string;
  errors: string;
  base_requests: string;
  base_errors: string;
  p95_ms: number | null;
  base_p95_ms: number | null;
};

const rate = (errors: number, requests: number) =>
  requests > 0 ? errors / requests : 0;
// A window with no spans has no p95; ClickHouse returns nan, which JSON renders as null.
const p95 = (requests: number, v: number | null) =>
  requests > 0 && v != null && Number.isFinite(Number(v)) ? Number(v) : null;

export async function measureNodeDeltas(
  target: KnowledgeTarget,
  window: [Date, Date],
): Promise<Map<string, NodeDelta>> {
  const [start, end] = window;
  const baselineStart = new Date(
    start.getTime() - (end.getTime() - start.getTime()),
  );
  const source = traceSourceOf(target);
  const [serverCTE, clientCTE] = await renderSpanCtes(
    target,
    [baselineStart, end],
    { withTimestamp: true },
  );

  const unsafe = (s: string) => ({ UNSAFE_RAW_SQL: s });
  // startMs is a number from Date.getTime(), safe to inline.
  const startTs = `fromUnixTimestamp64Milli(${start.getTime()})`;
  const inWin = `ts >= ${startTs}`;
  const inBase = `ts < ${startTs}`;
  const isError = errorStatusPredicateSql('statusCode');
  const metrics = (spans: string) =>
    unsafe(`
    countIf(${inWin}) AS requests,
    countIf(${inWin} AND ${isError}) AS errors,
    countIf(${inBase}) AS base_requests,
    countIf(${inBase} AND ${isError}) AS base_errors,
    ${p95MsSql(source, `${spans}.duration`, inWin)} AS p95_ms,
    ${p95MsSql(source, `${spans}.duration`, inBase)} AS base_p95_ms`);
  const ds = datastoreColumns(source);

  const { sql, params } = chSql`
    WITH ServerSpans AS (${serverCTE}), ClientSpans AS (${clientCTE})
    SELECT 'service' AS kind, serviceName AS name,
      ${unsafe(ds.empty)},
      ${metrics('ServerSpans')}
    FROM ServerSpans
    GROUP BY name
    UNION ALL
    SELECT 'datastore' AS kind, '' AS name,
      ${unsafe(ds.select)},
      ${metrics('ClientSpans')}
    FROM ClientSpans
    WHERE ${unsafe(ds.filter)}
    GROUP BY a0, a1, a2, a3
  `;
  const result = await target.client.query({
    query: sql,
    query_params: params,
    format: 'JSON',
    clickhouse_settings: { max_execution_time: 60, join_algorithm: 'auto' },
  });
  const rows = (await result.json<Row>()).data;

  const acc = new Map<
    string,
    {
      req: number;
      err: number;
      breq: number;
      berr: number;
      p95: number | null;
      bp95: number | null;
    }
  >();
  for (const r of rows) {
    let node: string | null;
    if (r.kind === 'service') {
      if (!r.name) continue;
      node = serviceKey(r.name);
    } else {
      node = datastoreKey({
        'db.system': r.a0,
        'server.address': r.a1,
        'net.peer.name': r.a2,
        'db.name': r.a3,
      });
      if (!node) continue;
    }
    const cur = {
      req: Number(r.requests),
      err: Number(r.errors),
      breq: Number(r.base_requests),
      berr: Number(r.base_errors),
      p95: p95(Number(r.requests), r.p95_ms),
      bp95: p95(Number(r.base_requests), r.base_p95_ms),
    };
    const prev = acc.get(node);
    const max = (a: number | null, b: number | null) =>
      a == null ? b : b == null ? a : Math.max(a, b);
    acc.set(
      node,
      prev
        ? {
            req: prev.req + cur.req,
            err: prev.err + cur.err,
            breq: prev.breq + cur.breq,
            berr: prev.berr + cur.berr,
            p95: max(prev.p95, cur.p95),
            bp95: max(prev.bp95, cur.bp95),
          }
        : cur,
    );
  }

  const out = new Map<string, NodeDelta>();
  for (const [node, a] of acc) {
    if (a.req === 0 && a.breq === 0) continue;
    out.set(node, {
      node,
      requests: a.req,
      baselineRequests: a.breq,
      errorRate: rate(a.err, a.req),
      baselineErrorRate: rate(a.berr, a.breq),
      p95Ms: a.p95,
      baselineP95Ms: a.bp95,
    });
  }
  return out;
}
