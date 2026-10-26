import { type ChSql, chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { errorStatusPredicateSql } from '@hyperdx/common-utils/dist/core/spanPredicates';

import type { KnowledgeTarget } from '@/knowledge/target';

import { datastoreKey, parseNodeKey, serviceKey } from './nodeKey';
import {
  datastoreColumns,
  p95MsSql,
  renderSpanCtes,
  traceSourceOf,
} from './sql';

type EdgeRow = {
  team_id: string;
  source_id: string;
  src: string;
  rel: 'CALLS';
  dst: string;
  request_count: number;
  error_count: number;
  p95_ms: number;
  observed_at: string;
};
type NodeRow = {
  team_id: string;
  source_id: string;
  node_key: string;
  kind: string;
  label: string;
  attrs: string;
  observed_at: string;
};
export type Topology = { rows: number; nodes: NodeRow[]; edges: EdgeRow[] };

// Same server/client CTE join as getServiceMapQuery in useServiceMap.tsx,
// inner-joined because only edges are wanted here.
async function buildTopologyEdgeSql(
  target: KnowledgeTarget,
  dateRange: [Date, Date],
): Promise<ChSql> {
  const source = traceSourceOf(target);
  const [serverCTE, clientCTE] = await renderSpanCtes(target, dateRange);
  const ds = datastoreColumns(source);
  const unsafe = (s: string) => ({ UNSAFE_RAW_SQL: s });

  return chSql`
    WITH ServerSpans AS (${serverCTE}), ClientSpans AS (${clientCTE})
    SELECT 'service' AS kind, ClientSpans.serviceName AS src, ServerSpans.serviceName AS dst,
      ${unsafe(ds.empty)},
      count() AS request_count,
      countIf(${unsafe(errorStatusPredicateSql('ServerSpans.statusCode'))}) AS error_count,
      ${unsafe(p95MsSql(source, 'ServerSpans.duration'))} AS p95_ms
    FROM ServerSpans
      INNER JOIN ClientSpans
        ON ServerSpans.traceId = ClientSpans.traceId
        AND ServerSpans.parentSpanId = ClientSpans.spanId
    WHERE ServerSpans.serviceName != ClientSpans.serviceName
    GROUP BY src, dst
    UNION ALL
    SELECT 'datastore' AS kind, ClientSpans.serviceName AS src, '' AS dst,
      ${unsafe(ds.select)},
      count() AS request_count,
      countIf(${unsafe(errorStatusPredicateSql('ClientSpans.statusCode'))}) AS error_count,
      ${unsafe(p95MsSql(source, 'ClientSpans.duration'))} AS p95_ms
    FROM ClientSpans
    WHERE ${unsafe(ds.filter)}
    GROUP BY src, a0, a1, a2, a3
  `;
}

type SqlRow = {
  kind: 'service' | 'datastore';
  src: string;
  dst: string;
  a0: string;
  a1: string;
  a2: string;
  a3: string;
  request_count: string;
  error_count: string;
  p95_ms: number;
};

// Service and datastore CALLS edges for the range, stamped with observedAt. No writes.
export async function computeTopology(
  target: KnowledgeTarget,
  range: [Date, Date],
  observedAt: string,
): Promise<Topology> {
  const { sql, params } = await buildTopologyEdgeSql(target, range);
  const result = await target.client.query({
    query: sql,
    query_params: params,
    format: 'JSON',
    clickhouse_settings: { max_execution_time: 60, join_algorithm: 'auto' },
  });
  const rows = (await result.json<SqlRow>()).data;

  const base = {
    team_id: target.teamId,
    source_id: target.sourceId,
    observed_at: observedAt,
  };
  const edges = new Map<string, EdgeRow>();
  const nodes = new Map<string, NodeRow>();
  const addNode = (key: string, attrs: object = {}) => {
    if (nodes.has(key)) return;
    const { kind, label } = parseNodeKey(key);
    nodes.set(key, {
      ...base,
      node_key: key,
      kind,
      label,
      attrs: JSON.stringify(attrs),
    });
  };

  for (const r of rows) {
    if (!r.src || (r.kind === 'service' && !r.dst)) continue;
    const src = serviceKey(r.src);
    let dst: string | null;
    if (r.kind === 'service') {
      dst = serviceKey(r.dst);
      addNode(dst);
    } else {
      dst = datastoreKey({
        'db.system': r.a0,
        'server.address': r.a1,
        'net.peer.name': r.a2,
        'db.name': r.a3,
      });
      if (!dst) continue;
      addNode(dst, { db_system: r.a0 });
    }
    addNode(src);
    const id = `${src}\u0000${dst}`;
    const prev = edges.get(id);
    // Datastore rows that differ only in unused attributes collapse to one key.
    edges.set(id, {
      ...base,
      src,
      rel: 'CALLS',
      dst,
      request_count: Number(r.request_count) + (prev?.request_count ?? 0),
      error_count: Number(r.error_count) + (prev?.error_count ?? 0),
      p95_ms: Math.max(Number(r.p95_ms), prev?.p95_ms ?? 0),
    });
  }
  return {
    rows: rows.length,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
