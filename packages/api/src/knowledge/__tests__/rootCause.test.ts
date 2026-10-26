import type { NodeDelta } from '@/knowledge/topology/anomaly';
import { buildGraph, type GraphEdge } from '@/knowledge/topology/graph';
import {
  blastRadius,
  rankRootCauses,
  UNKNOWN_START_HINT,
} from '@/knowledge/topology/rootCause';

const e = (src: string, dst: string): GraphEdge => ({
  src,
  dst,
  requestCount: 1,
  errorCount: 0,
  p95Ms: 1,
});

const delta = (node: string, errorRate = 0): NodeDelta => ({
  node,
  requests: 100,
  baselineRequests: 100,
  errorRate,
  baselineErrorRate: 0,
  p95Ms: null,
  baselineP95Ms: null,
});

const deltaMap = (...ds: NodeDelta[]) => new Map(ds.map(d => [d.node, d]));

describe('rankRootCauses', () => {
  const chain = buildGraph([
    e('gateway', 'checkout'),
    e('checkout', 'orders-db'),
  ]);

  it('ranks the only anomalous downstream node first with its path', () => {
    const result = rankRootCauses(
      chain,
      deltaMap(
        delta('gateway', 0.2),
        delta('checkout'),
        delta('orders-db', 0.5),
      ),
      'gateway',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.candidates.map(c => c.node)).toEqual(['orders-db']);
    expect(result.candidates[0].depth).toBe(2);
    expect(result.candidates[0].path).toEqual([
      'gateway',
      'checkout',
      'orders-db',
    ]);
    expect(result.alerting?.node).toBe('gateway');
    expect(result.hops.map(h => [h.node, h.depth])).toEqual([
      ['checkout', 1],
      ['orders-db', 2],
    ]);
  });

  it('orders same-depth candidates by error rate delta', () => {
    const graph = buildGraph([e('a', 'b'), e('a', 'c')]);
    const result = rankRootCauses(
      graph,
      deltaMap(delta('a'), delta('b', 0.1), delta('c', 0.4)),
      'a',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.candidates.map(c => c.node)).toEqual(['c', 'b']);
  });

  it('prefers deeper candidates over bigger deltas and caps at topN', () => {
    const graph = buildGraph([e('a', 'b'), e('b', 'c'), e('a', 'd')]);
    const deltas = deltaMap(delta('b', 0.9), delta('c', 0.1), delta('d', 0.9));
    const result = rankRootCauses(graph, deltas, 'a', 2);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.candidates.map(c => c.node)).toEqual(['c', 'b']);
  });

  it('returns the start as the candidate when nothing downstream is anomalous', () => {
    const result = rankRootCauses(
      chain,
      deltaMap(delta('gateway', 0.2), delta('checkout'), delta('orders-db')),
      'gateway',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.candidates).toEqual([
      expect.objectContaining({ node: 'gateway', depth: 0, path: ['gateway'] }),
    ]);
  });

  it('returns no candidates when the start has no delta and nothing is anomalous', () => {
    const result = rankRootCauses(
      chain,
      deltaMap(delta('checkout')),
      'gateway',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.alerting).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.hops[0]).toEqual({
      node: 'checkout',
      depth: 1,
      delta: expect.objectContaining({ node: 'checkout' }),
    });
    expect(result.hops[1]).toEqual({
      node: 'orders-db',
      depth: 2,
      delta: null,
    });
  });

  it('reports no_data for an empty window', () => {
    expect(rankRootCauses(chain, new Map(), 'gateway')).toEqual({
      status: 'no_data',
    });
  });

  it('reports no_data when only the baseline window has traffic', () => {
    const baselineOnly = { ...delta('checkout', 0.5), requests: 0 };
    expect(rankRootCauses(chain, deltaMap(baselineOnly), 'gateway')).toEqual({
      status: 'no_data',
    });
  });

  it('returns no candidates and a hint when the start is unknown', () => {
    const result = rankRootCauses(
      chain,
      deltaMap(delta('checkout', 0.5)),
      'service:typo',
    );
    expect(result).toEqual({
      status: 'ok',
      alerting: null,
      candidates: [],
      hops: [],
      hint: UNKNOWN_START_HINT,
    });
  });
});

describe('blastRadius', () => {
  it('lists upstream callers with hop count and delta', () => {
    const graph = buildGraph([
      e('gateway', 'checkout'),
      e('checkout', 'orders-db'),
    ]);
    const hits = blastRadius(
      graph,
      deltaMap(delta('checkout', 0.3)),
      'orders-db',
    );
    expect(hits.map(h => [h.node, h.depth])).toEqual([
      ['checkout', 1],
      ['gateway', 2],
    ]);
    expect(hits[0].path).toEqual(['orders-db', 'checkout']);
    expect(hits[0].delta?.errorRate).toBe(0.3);
    expect(hits[1].delta).toBeNull();
  });
});
