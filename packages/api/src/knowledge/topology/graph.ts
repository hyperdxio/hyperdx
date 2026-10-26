import { KG_TABLES, qualifiedTable } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';

export type GraphEdge = {
  src: string;
  dst: string;
  requestCount: number;
  errorCount: number;
  p95Ms: number;
};
export type Graph = {
  nodes: Set<string>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
};
export type WalkHit = { node: string; depth: number; path: string[] };

export const MAX_EDGES = 50000;
const DEFAULT_MAX_DEPTH = 6;

export function buildGraph(edges: GraphEdge[]): Graph {
  const graph: Graph = { nodes: new Set(), out: new Map(), in: new Map() };
  const push = (m: Map<string, GraphEdge[]>, k: string, edge: GraphEdge) => {
    const list = m.get(k);
    if (list) list.push(edge);
    else m.set(k, [edge]);
  };
  for (const edge of edges) {
    graph.nodes.add(edge.src).add(edge.dst);
    push(graph.out, edge.src, edge);
    push(graph.in, edge.dst, edge);
  }
  return graph;
}

type EdgeRow = {
  src: string;
  dst: string;
  request_count: string | number;
  error_count: string | number;
  p95_ms: string | number;
};

export async function loadGraph(target: KnowledgeTarget): Promise<Graph> {
  const table = qualifiedTable(target.database, KG_TABLES.edges);
  const scope = `team_id = {teamId:String} AND source_id = {sourceId:String} AND rel = 'CALLS'`;
  const result = await target.client.query({
    // Edges for services that stopped sending traffic are never deleted, so
    // keep only those near the newest one (not now(), so idle teams still load).
    query: `SELECT src, dst, request_count, error_count, p95_ms FROM ${table} FINAL WHERE ${scope} AND observed_at >= (SELECT max(observed_at) FROM ${table} WHERE ${scope}) - INTERVAL 24 HOUR ORDER BY request_count DESC LIMIT ${MAX_EDGES}`,
    query_params: { teamId: target.teamId, sourceId: target.sourceId },
    format: 'JSON',
  });
  const rows = (await result.json<EdgeRow>()).data;
  return buildGraph(
    rows.map(r => ({
      src: r.src,
      dst: r.dst,
      requestCount: Number(r.request_count),
      errorCount: Number(r.error_count),
      p95Ms: Number(r.p95_ms),
    })),
  );
}

// BFS visits each node once, so cycles terminate.
function walk(
  graph: Graph,
  start: string,
  maxDepth: number,
  neighbours: (node: string) => string[],
): WalkHit[] {
  if (!graph.nodes.has(start)) return [];
  const hits: WalkHit[] = [];
  const seen = new Set([start]);
  let frontier: WalkHit[] = [{ node: start, depth: 0, path: [start] }];
  while (frontier.length > 0 && frontier[0].depth < maxDepth) {
    const next: WalkHit[] = [];
    for (const cur of frontier) {
      for (const n of neighbours(cur.node)) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push({ node: n, depth: cur.depth + 1, path: [...cur.path, n] });
      }
    }
    hits.push(...next);
    frontier = next;
  }
  return hits;
}

export function walkCallees(
  graph: Graph,
  start: string,
  maxDepth = DEFAULT_MAX_DEPTH,
): WalkHit[] {
  return walk(graph, start, maxDepth, n =>
    (graph.out.get(n) ?? []).map(x => x.dst),
  );
}

export function walkCallers(
  graph: Graph,
  start: string,
  maxDepth = DEFAULT_MAX_DEPTH,
): WalkHit[] {
  return walk(graph, start, maxDepth, n =>
    (graph.in.get(n) ?? []).map(x => x.src),
  );
}

// Every node within maxDepth hops of start, ignoring edge direction, with its hop count.
export function nearby(
  graph: Graph,
  start: string,
  maxDepth: number,
): Map<string, number> {
  if (!graph.nodes.has(start)) return new Map();
  const hits = walk(graph, start, maxDepth, n => [
    ...(graph.out.get(n) ?? []).map(x => x.dst),
    ...(graph.in.get(n) ?? []).map(x => x.src),
  ]);
  return new Map([
    [start, 0],
    ...hits.map((h): [string, number] => [h.node, h.depth]),
  ]);
}

export type GraphPath = { nodes: string[]; edges: GraphEdge[] };

// Shortest callee path from one node to another, with each hop's traffic numbers.
export function findCalleePath(
  graph: Graph,
  from: string,
  to: string,
): GraphPath | null {
  const nodes =
    from === to && graph.nodes.has(from)
      ? [from]
      : walkCallees(graph, from).find(h => h.node === to)?.path;
  if (!nodes) return null;
  const edges: GraphEdge[] = [];
  nodes.reduce((src, dst) => {
    const edge = graph.out.get(src)?.find(e => e.dst === dst);
    if (edge) edges.push(edge);
    return dst;
  });
  return { nodes, edges };
}
