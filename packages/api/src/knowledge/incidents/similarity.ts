import type { IncidentRow } from '@/knowledge/incidents/types';
import { type Graph, nearby } from '@/knowledge/topology/graph';

export type SimilarityQuery = {
  node: string;
  symptomKeys: string[];
  embedding?: number[];
  now: Date;
};

export type ScoredIncident = {
  incident: IncidentRow;
  score: number;
  terms: {
    jaccard: number;
    proximity: number;
    cosine: number;
    recency: number;
  };
};

const HALF_LIFE_DAYS = 180;
const DAY_MS = 86_400_000;

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const union = new Set([...sa, ...sb]).size;
  if (union === 0) return 0;
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  return inter / union;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [i, x] of a.entries()) {
    const y = b.at(i) ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

const NEAR_HOPS = 2;

// near: nodes within NEAR_HOPS of the query node, from one BFS per query.
export function proximity(
  near: Map<string, number>,
  queryNode: string,
  incident: IncidentRow,
): number {
  const nodes = [incident.alerting_node, incident.root_cause_node];
  if (nodes.includes(queryNode)) return 1;
  return nodes.some(n => near.has(n)) ? 0.5 : 0;
}

// Stored timestamps are 'YYYY-MM-DD HH:MM:SS.mmm' in UTC with no zone suffix.
const parseUtc = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).getTime();

const incidentTime = (i: IncidentRow) => parseUtc(i.resolved_at ?? i.opened_at);

export function scoreIncident(
  q: SimilarityQuery,
  incident: IncidentRow,
  near: Map<string, number>,
): ScoredIncident {
  const ageDays = Math.max(
    0,
    (q.now.getTime() - incidentTime(incident)) / DAY_MS,
  );
  const terms = {
    jaccard: jaccard(q.symptomKeys, incident.symptom_keys),
    proximity: proximity(near, q.node, incident),
    cosine: cosine(q.embedding ?? [], incident.embedding),
    recency: 0.5 ** (ageDays / HALF_LIFE_DAYS),
  };
  const score =
    (0.5 * terms.jaccard + 0.3 * terms.proximity + 0.2 * terms.cosine) *
    terms.recency;
  return { incident, score, terms };
}

export function rankIncidents(
  q: SimilarityQuery,
  incidents: IncidentRow[],
  graph: Graph,
  opts: { topK?: number; minScore?: number } = {},
): ScoredIncident[] {
  const { topK = 5, minScore = 0.2 } = opts;
  const near = nearby(graph, q.node, NEAR_HOPS);
  return incidents
    .map(i => scoreIncident(q, i, near))
    .filter(s => s.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        incidentTime(b.incident) - incidentTime(a.incident) ||
        a.incident.incident_id.localeCompare(b.incident.incident_id),
    )
    .slice(0, topK);
}
