import type { HyperdxApiClient } from '@/hyperdx/api';
import { runRetrievalEval, summarise } from '@/retrieval/kgRetrieval';
import { relatedIncidents } from '@/scenarios/smokehouse/families';
import { GROUND_TRUTH } from '@/scenarios/smokehouse/groundTruth';
import {
  EVAL_TITLE_PREFIX,
  syntheticRecord,
} from '@/scenarios/smokehouse/memory';
import { alertingService } from '@/scenarios/smokehouse/shared';

const NAME = 'cache-stampede';
const SCENARIO = `sh-${NAME}`;
const gt = GROUND_TRUTH[NAME];
const prefix = EVAL_TITLE_PREFIX(SCENARIO);
const relatedTitle = (n: string) => `${prefix} ${GROUND_TRUTH[n].scenario}`;

function mockApi(similar: () => Promise<unknown>) {
  let n = 0;
  let sources: Array<{ id: string; name: string; kind: string }> = [];
  return {
    listSourcesV2: jest.fn(async () => sources),
    createSourceV2: jest.fn(async (b: { name: string; kind: string }) => {
      const src = { ...b, id: `src-${++n}` };
      sources.push(src);
      return src;
    }),
    deleteSourceV2: jest.fn(async (id: string) => {
      sources = sources.filter(x => x.id !== id);
    }),
    putKnowledgeSettings: jest.fn(async () => ({})),
    openIncident: jest.fn(async () => ({ incident_id: `id-${++n}` })),
    recordAction: jest.fn(async () => ({})),
    resolveIncident: jest.fn(async () => ({})),
    confirmIncident: jest.fn(async () => ({})),
    deleteIncidents: jest.fn(async () => 0),
    similarIncidents: jest.fn(similar),
  };
}
const asClient = (m: ReturnType<typeof mockApi>) =>
  m as unknown as HyperdxApiClient;
const hit = (title: string, score = 0.5) => ({ incident: { title }, score });

describe('summarise', () => {
  it('computes recall@1, recall@3 and MRR, counting null as a miss', () => {
    const mk = (relatedRank: number | null) => ({
      incident: 'x',
      relatedRank,
      top: [],
    });
    expect(summarise([mk(1), mk(3), mk(null), mk(2)])).toEqual({
      recallAt1: 0.25,
      recallAt3: 0.75,
      mrr: (1 + 1 / 3 + 0 + 1 / 2) / 4,
      n: 4,
    });
  });

  it('returns zeros for no results', () => {
    expect(summarise([])).toEqual({ recallAt1: 0, recallAt3: 0, mrr: 0, n: 0 });
  });
});

describe('runRetrievalEval', () => {
  const related = relatedIncidents(NAME);

  it('seeds, queries with the synthetic symptom keys and ranks the first related title', async () => {
    const api = mockApi(async () => [
      hit('unrelated title'),
      hit(relatedTitle(related[0])),
    ]);
    const [r] = await runRetrievalEval(asClient(api), [SCENARIO], 'conn');

    expect(r.relatedRank).toBe(2);
    expect(r.top[0]).toEqual({ title: 'unrelated title', score: 0.5 });
    expect(api.openIncident.mock.calls.length).toBeGreaterThanOrEqual(
      related.length,
    );
    expect(api.confirmIncident).toHaveBeenCalledTimes(
      api.openIncident.mock.calls.length,
    );
    expect(api.similarIncidents).toHaveBeenCalledWith({
      service: alertingService(gt),
      symptomKeys: syntheticRecord(gt).open.symptomKeys,
      text: gt.expected.summary,
      topK: 10,
    });
    expect(api.deleteIncidents).toHaveBeenLastCalledWith(prefix);
  });

  it('pins one smokehouse trace source for the whole run and unpins after', async () => {
    const api = mockApi(async () => []);
    await runRetrievalEval(asClient(api), [SCENARIO, related[0]], 'conn');
    expect(api.putKnowledgeSettings).toHaveBeenCalledTimes(2);
    expect(api.putKnowledgeSettings).toHaveBeenNthCalledWith(1, {
      traceSourceId: expect.stringMatching(/^src-/),
      includeUnconfirmed: false,
    });
    expect(api.putKnowledgeSettings).toHaveBeenLastCalledWith({
      traceSourceId: null,
      includeUnconfirmed: false,
    });
    expect(await api.listSourcesV2()).toEqual([]);
  });

  it('accepts a bare name and gives null when no related title is returned', async () => {
    const api = mockApi(async () => [hit('other')]);
    const [r] = await runRetrievalEval(asClient(api), [NAME], 'conn');
    expect(r.incident).toBe(SCENARIO);
    expect(r.relatedRank).toBeNull();
  });

  it('clears even when the query throws', async () => {
    const api = mockApi(async () => {
      throw new Error('boom');
    });
    await expect(
      runRetrievalEval(asClient(api), [SCENARIO], 'conn'),
    ).rejects.toThrow('boom');
    expect(api.deleteIncidents).toHaveBeenLastCalledWith(prefix);
    expect(api.deleteIncidents.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
