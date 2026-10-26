import { findSimilarIncidents } from '@/knowledge/incidents/find';
import type { KnowledgeTarget } from '@/knowledge/target';

const mockEmbedText = jest.fn();
const mockListIncidents = jest.fn();
const mockRankIncidents = jest.fn();
jest.mock('@/knowledge/incidents/embedding', () => ({
  embedText: (...a: unknown[]) => mockEmbedText(...a),
}));
jest.mock('@/knowledge/incidents/listing', () => ({
  listIncidents: (...a: unknown[]) => mockListIncidents(...a),
}));
jest.mock('@/knowledge/incidents/similarity', () => ({
  rankIncidents: (...a: unknown[]) => mockRankIncidents(...a),
}));
jest.mock('@/knowledge/topology/graph', () => ({
  loadGraph: jest.fn().mockResolvedValue({}),
}));

// Only the fields findSimilarIncidents reads.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const target = { teamId: 't1' } as KnowledgeTarget;
const ranked = [{ score: 1 }];
const rankQuery = () => mockRankIncidents.mock.calls[0][0];
const listOpts = () => mockListIncidents.mock.calls[0][1];

describe('findSimilarIncidents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListIncidents.mockResolvedValue([]);
    mockRankIncidents.mockReturnValue(ranked);
    mockEmbedText.mockResolvedValue(null);
  });

  it('passes the query embedding to ranking and reads stored embeddings', async () => {
    mockEmbedText.mockResolvedValue([1, 2]);
    await findSimilarIncidents(target, { service: 'checkout', text: 'slow' });
    expect(mockEmbedText).toHaveBeenCalledWith('slow');
    expect(rankQuery().embedding).toEqual([1, 2]);
    expect(listOpts().withEmbedding).toBe(true);
  });

  it('still ranks without an embedding when the provider fails', async () => {
    mockEmbedText.mockRejectedValue(new Error('provider down'));
    const out = await findSimilarIncidents(target, {
      service: 'checkout',
      text: 'slow',
    });
    expect(out).toBe(ranked);
    expect(rankQuery().embedding).toBeUndefined();
    expect(listOpts().withEmbedding).toBe(false);
  });

  it('accepts a bare name or a node key without double prefixing', async () => {
    await findSimilarIncidents(target, { service: 'service:checkout' });
    expect(rankQuery().node).toBe('service:checkout');
    expect(rankQuery().symptomKeys).toEqual(['service:checkout']);
  });

  it('includes unconfirmed incidents when the caller or the team asks', async () => {
    await findSimilarIncidents(target, { service: 'a' });
    await findSimilarIncidents(target, {
      service: 'a',
      includeUnconfirmed: true,
    });
    await findSimilarIncidents(
      { ...target, includeUnconfirmed: true },
      { service: 'a' },
    );
    expect(
      mockListIncidents.mock.calls.map(c => c[1].includeUnconfirmed),
    ).toEqual([false, true, true]);
  });
});
