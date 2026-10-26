import { fmt } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';

import { computeTopology } from './compute';
import { buildGraph, type Graph, loadGraph, MAX_EDGES } from './graph';
import { refreshTopologyIfStale } from './refresh';
import { TOPOLOGY_WINDOW_MS } from './sql';

const RECENT_MS = 15 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CACHE_SIZE = 20;

// Graphs for past windows, computed without writing. Oldest entry evicted first.
const pastGraphs = new Map<string, Promise<Graph>>();

async function computePastGraph(
  target: KnowledgeTarget,
  end: number,
): Promise<Graph> {
  const { edges } = await computeTopology(
    target,
    [new Date(end - TOPOLOGY_WINDOW_MS), new Date(end)],
    fmt(new Date(end)),
  );
  // Same cap and order as loadGraph applies to stored edges.
  return buildGraph(
    edges
      .sort((a, b) => b.request_count - a.request_count)
      .slice(0, MAX_EDGES)
      .map(e => ({
        src: e.src,
        dst: e.dst,
        requestCount: e.request_count,
        errorCount: e.error_count,
        p95Ms: e.p95_ms,
      })),
  );
}

// The call graph as it was for the window: the stored, lazily refreshed graph
// when the window ends near now, else the 6 hours before the window end.
export async function graphForWindow(
  target: KnowledgeTarget,
  range: [Date, Date],
  now = Date.now(),
): Promise<Graph> {
  const end = range[1].getTime();
  if (now - end <= RECENT_MS) {
    await refreshTopologyIfStale(target);
    return loadGraph(target);
  }
  const minute = Math.floor(end / MINUTE_MS) * MINUTE_MS;
  const key = `${target.teamId}\u0000${target.sourceId}\u0000${minute}`;
  const cached = pastGraphs.get(key);
  if (cached) return cached;
  const graph = computePastGraph(target, minute);
  pastGraphs.set(key, graph);
  void graph.catch(() => pastGraphs.delete(key));
  if (pastGraphs.size > CACHE_SIZE) {
    pastGraphs.delete(pastGraphs.keys().next().value ?? '');
  }
  return graph;
}
