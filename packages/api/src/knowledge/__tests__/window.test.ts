import type { KnowledgeTarget } from '@/knowledge/target';
import { graphForWindow } from '@/knowledge/topology/window';

const mockRefreshIfStale = jest.fn();
const mockComputeTopology = jest.fn();
const mockLoadGraph = jest.fn();
jest.mock('@/knowledge/topology/refresh', () => ({
  refreshTopologyIfStale: (...a: unknown[]) => mockRefreshIfStale(...a),
}));
jest.mock('@/knowledge/topology/compute', () => ({
  computeTopology: (...a: unknown[]) => mockComputeTopology(...a),
}));
jest.mock('@/knowledge/topology/graph', () => ({
  ...jest.requireActual('@/knowledge/topology/graph'),
  loadGraph: (...a: unknown[]) => mockLoadGraph(...a),
}));

// Only the fields the window logic reads.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const target = { teamId: 't1', sourceId: 's1' } as KnowledgeTarget;
const MIN = 60_000;
const now = Date.UTC(2026, 9, 26, 12, 0, 0);
const range = (endAgoMs: number): [Date, Date] => [
  new Date(now - endAgoMs - 10 * MIN),
  new Date(now - endAgoMs),
];
const edge = {
  src: 'service:a',
  dst: 'service:b',
  request_count: 3,
  error_count: 1,
  p95_ms: 7,
};

describe('graphForWindow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadGraph.mockResolvedValue('persisted');
    mockComputeTopology.mockResolvedValue({ nodes: [], edges: [edge] });
  });

  it('refreshes and loads the persisted graph for a recent window', async () => {
    expect(await graphForWindow(target, range(14 * MIN), now)).toBe(
      'persisted',
    );
    expect(mockRefreshIfStale).toHaveBeenCalledWith(target);
    expect(mockComputeTopology).not.toHaveBeenCalled();
  });

  it('computes an older window in memory for the 6 hours before its end, once per minute', async () => {
    const g = await graphForWindow(target, range(2 * 60 * MIN), now);
    expect(g.out.get('service:a')).toEqual([
      {
        src: 'service:a',
        dst: 'service:b',
        requestCount: 3,
        errorCount: 1,
        p95Ms: 7,
      },
    ]);
    const [, [start, end]] = mockComputeTopology.mock.calls[0];
    expect(end.getTime()).toBe(now - 2 * 60 * MIN);
    expect(end.getTime() - start.getTime()).toBe(6 * 60 * MIN);
    expect(mockRefreshIfStale).not.toHaveBeenCalled();
    expect(mockLoadGraph).not.toHaveBeenCalled();

    const sameMinute = range(2 * 60 * MIN - 20_000);
    expect(await graphForWindow(target, sameMinute, now)).toBe(g);
    await graphForWindow({ ...target, sourceId: 's2' }, sameMinute, now);
    await graphForWindow({ ...target, teamId: 't2' }, sameMinute, now);
    expect(mockComputeTopology).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed computation', async () => {
    mockComputeTopology.mockRejectedValueOnce(new Error('boom'));
    const r = range(3 * 60 * MIN);
    await expect(graphForWindow(target, r, now)).rejects.toThrow('boom');
    await graphForWindow(target, r, now);
    expect(mockComputeTopology).toHaveBeenCalledTimes(2);
  });
});
