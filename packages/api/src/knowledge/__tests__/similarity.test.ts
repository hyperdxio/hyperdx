import {
  cosine,
  jaccard,
  proximity,
  rankIncidents,
  scoreIncident,
} from '@/knowledge/incidents/similarity';
import type { IncidentRow } from '@/knowledge/incidents/types';
import { buildGraph, type GraphEdge, nearby } from '@/knowledge/topology/graph';

const e = (src: string, dst: string): GraphEdge => ({
  src,
  dst,
  requestCount: 1,
  errorCount: 0,
  p95Ms: 1,
});
// A - B - C - D
const graph = buildGraph([e('A', 'B'), e('B', 'C'), e('C', 'D')]);
const now = new Date('2026-10-26T00:00:00.000Z');
const q = { node: 'A', symptomKeys: ['service:a', 'x:y'], now };
const nearA = nearby(graph, 'A', 2);

const inc = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  incident_id: 'i1',
  title: 't',
  status: 'resolved',
  opened_at: '2026-10-25 00:00:00.000',
  resolved_at: '2026-10-26 00:00:00.000',
  alerting_node: 'A',
  root_cause_node: 'A',
  root_cause: '',
  resolution: '',
  symptom_keys: ['service:a', 'x:y'],
  summary: '',
  embedding: [],
  confirmed_by: 'u',
  version: 1,
  path: '',
  ...over,
});

describe('jaccard', () => {
  it('handles overlap, identity and empties', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard(['a'], ['a'])).toBe(1);
    expect(jaccard([], [])).toBe(0);
  });
});

describe('cosine', () => {
  it('scores identical 1, orthogonal 0', () => {
    expect(cosine([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it('is 0 for empty, mismatched length or zero magnitude', () => {
    expect(cosine([], [1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('proximity', () => {
  it('is 1 on alerting or root cause node', () => {
    expect(proximity(nearA, 'A', inc())).toBe(1);
    expect(
      proximity(
        nearby(graph, 'D', 2),
        'D',
        inc({ alerting_node: 'X', root_cause_node: 'D' }),
      ),
    ).toBe(1);
  });
  it('is 0.5 within 2 hops, else 0', () => {
    expect(
      proximity(nearA, 'A', inc({ alerting_node: 'C', root_cause_node: 'C' })),
    ).toBe(0.5);
    expect(
      proximity(nearA, 'A', inc({ alerting_node: 'D', root_cause_node: 'D' })),
    ).toBe(0);
    expect(
      proximity(nearA, 'A', inc({ alerting_node: 'Z', root_cause_node: 'Z' })),
    ).toBe(0);
  });
});

describe('scoreIncident', () => {
  it('same keys and node, age 0 scores 0.8', () => {
    expect(scoreIncident(q, inc(), nearA).score).toBeCloseTo(0.8);
  });
  it('node 2 hops away scores 0.65', () => {
    const i = inc({ alerting_node: 'C', root_cause_node: 'C' });
    expect(scoreIncident(q, i, nearA).score).toBeCloseTo(0.65);
  });
  it('180 days halves the score', () => {
    const i = inc({ resolved_at: '2026-04-29 00:00:00.000' });
    expect(scoreIncident(q, i, nearA).score).toBeCloseTo(0.4);
  });
  it('uses opened_at when unresolved, and ignores future timestamps', () => {
    const i = inc({ resolved_at: null, opened_at: '2027-01-01 00:00:00.000' });
    expect(scoreIncident(q, i, nearA).terms.recency).toBe(1);
  });
  it('adds the embedding term', () => {
    const s = scoreIncident(
      { ...q, embedding: [1, 0] },
      inc({ embedding: [1, 0] }),
      nearA,
    );
    expect(s.score).toBeCloseTo(1);
  });
});

describe('rankIncidents', () => {
  const far = inc({
    incident_id: 'far',
    symptom_keys: ['n:o'],
    alerting_node: 'D',
    root_cause_node: 'D',
  });
  it('drops scores under minScore and sorts descending', () => {
    const weak = inc({ incident_id: 'weak', symptom_keys: ['service:a'] });
    const r = rankIncidents(q, [far, weak, inc()], graph);
    expect(r.map(x => x.incident.incident_id)).toEqual(['i1', 'weak']);
  });
  it('truncates to topK after sorting', () => {
    const list = [
      inc({ incident_id: 'a', resolved_at: '2026-10-20 00:00:00.000' }),
      inc({ incident_id: 'b' }),
    ];
    const r = rankIncidents(q, list, graph, { topK: 1 });
    expect(r.map(x => x.incident.incident_id)).toEqual(['b']);
  });
  it('breaks ties by newer date then incident_id', () => {
    const r = rankIncidents(
      q,
      [inc({ incident_id: 'b' }), inc({ incident_id: 'a' })],
      graph,
    );
    expect(r.map(x => x.incident.incident_id)).toEqual(['a', 'b']);
  });
});
