import { isAnomalous, type NodeDelta } from '@/knowledge/topology/anomaly';

const delta = (o: Partial<NodeDelta>): NodeDelta => ({
  node: 'service:a',
  requests: 100,
  baselineRequests: 100,
  errorRate: 0,
  baselineErrorRate: 0,
  p95Ms: 100,
  baselineP95Ms: 100,
  ...o,
});

describe('isAnomalous', () => {
  it.each([
    [{ baselineErrorRate: 0.01, errorRate: 0.06 }, true],
    [{ baselineErrorRate: 0.01, errorRate: 0.05 }, false],
    [{ baselineP95Ms: 100, p95Ms: 160 }, true],
    [{ baselineP95Ms: 20, p95Ms: 40 }, false],
    [{ baselineP95Ms: 100, p95Ms: 140 }, false],
    [{ baselineP95Ms: null, p95Ms: 500 }, false],
  ])('%j -> %s', (o, expected) => {
    expect(isAnomalous(delta(o))).toBe(expected);
  });
});
