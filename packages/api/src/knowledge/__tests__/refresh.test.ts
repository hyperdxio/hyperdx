import type { KnowledgeTarget } from '@/knowledge/target';
import { refreshTopologyIfStale } from '@/knowledge/topology/refresh';
import logger from '@/utils/logger';

const mockComputeTopology = jest.fn();
jest.mock('@/knowledge/topology/compute', () => ({
  computeTopology: (...a: unknown[]) => mockComputeTopology(...a),
}));

const query = jest.fn().mockResolvedValue({
  json: async () => ({ data: [{ n: '0', ts: '0' }] }),
});
// Only the fields the refresh reads.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const target = {
  client: { query },
  database: 'db',
  teamId: 't1',
  sourceId: 's1',
} as unknown as KnowledgeTarget;

describe('refreshTopologyIfStale', () => {
  afterEach(() => jest.useRealTimers());

  it('falls back on failure and waits 5 minutes before retrying', async () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 26) });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockComputeTopology.mockRejectedValue(new Error('ch down'));

    await expect(refreshTopologyIfStale(target)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 't1' }),
      expect.stringMatching(/topology refresh failed/),
    );
    jest.setSystemTime(Date.UTC(2026, 9, 26, 0, 4));
    await refreshTopologyIfStale(target);
    expect(mockComputeTopology).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.UTC(2026, 9, 26, 0, 6));
    await refreshTopologyIfStale(target);
    expect(mockComputeTopology).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
