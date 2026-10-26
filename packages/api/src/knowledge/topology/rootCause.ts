import { isAnomalous, type NodeDelta } from './anomaly';
import { type Graph, walkCallees, walkCallers } from './graph';

type Candidate = {
  node: string;
  depth: number;
  path: string[];
  delta: NodeDelta;
};
export type RootCauseResult =
  | { status: 'no_data' }
  | {
      status: 'ok';
      alerting: NodeDelta | null;
      candidates: Candidate[];
      hops: Array<{ node: string; depth: number; delta: NodeDelta | null }>;
      hint?: string;
    };
export type BlastHit = {
  node: string;
  depth: number;
  path: string[];
  delta: NodeDelta | null;
};

export const UNKNOWN_START_HINT =
  'This service has no spans or calls in the topology for this window. Check the service name.';
const DEFAULT_TOP_N = 3;
const errorRise = (d: NodeDelta) => d.errorRate - d.baselineErrorRate;
const byDepthThenNode = (a: { depth: number; node: string }, b: typeof a) =>
  a.depth - b.depth || a.node.localeCompare(b.node);

export function rankRootCauses(
  graph: Graph,
  deltas: Map<string, NodeDelta>,
  start: string,
  topN = DEFAULT_TOP_N,
): RootCauseResult {
  // Baseline traffic alone does not count: nothing happened in the window.
  let requests = 0;
  for (const d of deltas.values()) requests += d.requests;
  if (requests === 0) return { status: 'no_data' };
  if (!graph.nodes.has(start) && !deltas.has(start)) {
    return {
      status: 'ok',
      alerting: null,
      candidates: [],
      hops: [],
      hint: UNKNOWN_START_HINT,
    };
  }

  const walked = walkCallees(graph, start).sort(byDepthThenNode);
  const alerting = deltas.get(start) ?? null;
  const anomalous: Candidate[] = [];
  for (const hit of walked) {
    const delta = deltas.get(hit.node);
    if (delta && isAnomalous(delta)) anomalous.push({ ...hit, delta });
  }
  anomalous.sort(
    (a, b) =>
      b.depth - a.depth ||
      errorRise(b.delta) - errorRise(a.delta) ||
      a.node.localeCompare(b.node),
  );

  let candidates = anomalous.slice(0, topN);
  // Nothing downstream is wrong, so point at the alerting service itself.
  if (anomalous.length === 0 && alerting) {
    candidates = [{ node: start, depth: 0, path: [start], delta: alerting }];
  }

  return {
    status: 'ok',
    alerting,
    candidates,
    hops: walked.map(h => ({
      node: h.node,
      depth: h.depth,
      delta: deltas.get(h.node) ?? null,
    })),
  };
}

export function blastRadius(
  graph: Graph,
  deltas: Map<string, NodeDelta>,
  start: string,
): BlastHit[] {
  return walkCallers(graph, start)
    .sort(byDepthThenNode)
    .map(h => ({ ...h, delta: deltas.get(h.node) ?? null }));
}
