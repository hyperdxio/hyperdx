import { trace } from '@opentelemetry/api';

import { fmt, insertRows, KG_TABLES, qualifiedTable } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';
import logger from '@/utils/logger';

import { computeTopology } from './compute';
import { MAX_EDGES } from './graph';
import { TOPOLOGY_WINDOW_MS } from './sql';

const STALE_AFTER_MS = 15 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

// An empty refresh writes no rows, so freshness is also tracked in process.
const lastRefreshed = new Map<string, number>();
const lastFailed = new Map<string, number>();
const inFlight = new Map<string, Promise<{ nodes: number; edges: number }>>();
const targetKey = (t: KnowledgeTarget) => `${t.teamId}\u0000${t.sourceId}`;

async function runRefresh(
  target: KnowledgeTarget,
  opts: { windowMs?: number; now?: Date },
): Promise<{ nodes: number; edges: number }> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const range: [Date, Date] = [
    new Date(now.getTime() - (opts.windowMs ?? TOPOLOGY_WINDOW_MS)),
    now,
  ];
  const { rows, nodes, edges } = await computeTopology(target, range, fmt(now));
  if (edges.length >= MAX_EDGES) {
    logger.warn(
      { teamId: target.teamId, edges: edges.length, cap: MAX_EDGES },
      'topology has more edges than the graph loads; the quietest are dropped',
    );
  }
  if (nodes.length > 0) await insertRows(target, KG_TABLES.nodes, nodes);
  if (edges.length > 0) await insertRows(target, KG_TABLES.edges, edges);
  lastRefreshed.set(targetKey(target), Date.now());
  trace.getActiveSpan()?.setAttributes({
    'knowledge.refresh.span_rows': rows,
    'knowledge.refresh.nodes': nodes.length,
    'knowledge.refresh.edges': edges.length,
    'knowledge.refresh.duration_ms': Date.now() - started,
  });
  return { nodes: nodes.length, edges: edges.length };
}

export function refreshTopology(
  target: KnowledgeTarget,
  opts: { windowMs?: number; now?: Date } = {},
): Promise<{ nodes: number; edges: number }> {
  const key = targetKey(target);
  const running = inFlight.get(key);
  if (running) return running;
  const p = runRefresh(target, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export async function topologyAgeMs(
  target: KnowledgeTarget,
): Promise<number | null> {
  const result = await target.client.query({
    query: `SELECT count() AS n, toUnixTimestamp64Milli(max(observed_at)) AS ts FROM ${qualifiedTable(target.database, KG_TABLES.edges)} WHERE team_id = {teamId:String} AND source_id = {sourceId:String} AND rel = 'CALLS'`,
    query_params: { teamId: target.teamId, sourceId: target.sourceId },
    format: 'JSON',
  });
  const [row] = (await result.json<{ n: string; ts: string }>()).data;
  if (!row || Number(row.n) === 0) return null;
  return Date.now() - Number(row.ts);
}

// Never throws: on failure the caller reads the edges already stored.
export async function refreshTopologyIfStale(
  target: KnowledgeTarget,
): Promise<void> {
  const key = targetKey(target);
  const last = lastRefreshed.get(key);
  if (last !== undefined && Date.now() - last <= STALE_AFTER_MS) return;
  const failed = lastFailed.get(key);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_FAILURE_MS)
    return;
  try {
    const age = await topologyAgeMs(target);
    if (age === null || age > STALE_AFTER_MS) await refreshTopology(target);
    lastFailed.delete(key);
  } catch (err) {
    lastFailed.set(key, Date.now());
    logger.warn(
      { err, teamId: target.teamId },
      'topology refresh failed, using the stored graph',
    );
  }
}
