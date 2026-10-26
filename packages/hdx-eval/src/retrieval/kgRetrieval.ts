import type { HyperdxApiClient } from '@/hyperdx/api';
import { pinScenario, unpinScenario } from '@/hyperdx/sources';
import {
  misleadingIncidents,
  relatedIncidents,
} from '@/scenarios/smokehouse/families';
import { GROUND_TRUTH } from '@/scenarios/smokehouse/groundTruth';
import {
  clearMemory,
  EVAL_TITLE_PREFIX,
  syntheticRecord,
} from '@/scenarios/smokehouse/memory';
import {
  alertingService,
  SMOKEHOUSE_PREFIX,
} from '@/scenarios/smokehouse/shared';

export type RetrievalResult = {
  incident: string;
  relatedRank: number | null;
  top: Array<{ title: string; score: number }>;
};

const TOP_K = 10;

export function summarise(results: RetrievalResult[]) {
  const n = results.length;
  const hit = (k: number) =>
    n === 0
      ? 0
      : results.filter(r => r.relatedRank !== null && r.relatedRank <= k)
          .length / n;
  const mrr =
    n === 0
      ? 0
      : results.reduce(
          (a, r) => a + (r.relatedRank ? 1 / r.relatedRank : 0),
          0,
        ) / n;
  return { recallAt1: hit(1), recallAt3: hit(3), mrr, n };
}

/** Every smokehouse incident that has at least one related incident. */
export const allRetrievalIncidents = () =>
  Object.keys(GROUND_TRUTH).filter(n => relatedIncidents(n).length > 0);

async function runOne(
  api: HyperdxApiClient,
  name: string,
): Promise<RetrievalResult> {
  const gt = GROUND_TRUTH[name];
  if (!gt) throw new Error(`Unknown smokehouse incident: ${name}`);
  const scenario = `${SMOKEHOUSE_PREFIX}${name}`;
  const prefix = EVAL_TITLE_PREFIX(scenario);
  const related = relatedIncidents(name);
  const relatedTitles = new Set(
    related.map(n => `${prefix} ${GROUND_TRUTH[n].scenario}`),
  );
  try {
    await clearMemory(api, scenario);
    for (const other of [...related, ...misleadingIncidents(name)]) {
      const rec = syntheticRecord(GROUND_TRUTH[other], prefix);
      const { incident_id: id } = await api.openIncident(rec.open);
      for (const a of rec.actions) await api.recordAction(id, a);
      await api.resolveIncident(id, rec.resolve);
      await api.confirmIncident(id);
    }
    const found = await api.similarIncidents({
      service: alertingService(gt),
      symptomKeys: syntheticRecord(gt).open.symptomKeys ?? [],
      text: gt.expected.summary,
      topK: TOP_K,
    });
    const top = found.map(f => ({ title: f.incident.title, score: f.score }));
    const idx = top.findIndex(t => relatedTitles.has(t.title));
    return { incident: scenario, relatedRank: idx < 0 ? null : idx + 1, top };
  } finally {
    await clearMemory(api, scenario);
  }
}

// Sequential: the incidents share one API's memory. Any trace source serves retrieval,
// so one pin covers the run.
export async function runRetrievalEval(
  api: HyperdxApiClient,
  incidents: string[],
  connectionId: string,
): Promise<RetrievalResult[]> {
  const names = incidents.map(i => i.replace(/^sh-/, ''));
  if (names.length === 0) return [];
  const pinned = `${SMOKEHOUSE_PREFIX}${names[0]}`;
  await pinScenario(api, pinned, connectionId, false);
  try {
    const results: RetrievalResult[] = [];
    for (const n of names) results.push(await runOne(api, n));
    return results;
  } finally {
    await unpinScenario(api, pinned);
  }
}
