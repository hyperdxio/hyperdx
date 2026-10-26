import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const LOAD_STEP_MS = 45_000,
  DEGRADED_EVERY_MS = 20_000;
const loadedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * LOAD_STEP_MS;
const loadedPods = (t: Date, onset: Date) =>
  [1, 2, 3, 4, 5, 6]
    .filter(i => t.getTime() >= loadedAt(i, onset))
    .map(i => `recommendation-${i}`);

// The ML platform team publishes a larger ranking model and recommendation hot-loads it with no
// release. Requests without precomputed recommendations now run inference past the BFFs' 500 ms
// timeout. The BFFs treat the call as optional, but the wait alone takes them past edge-gateway's own 500 ms.
export const recoModelSwap: Incident = {
  name: 'reco-model-swap',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    const loaded = new Set(loadedPods(t, onset));
    if (loaded.size === 0) return world;
    world.recommendation.delayMs = ctx =>
      !loaded.has(ctx.pod) || ctx.attrs.cacheHit
        ? 0
        : Math.max(0, ctx.rng.gauss(640, 120));
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = loadedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'recommendation',
          `recommendation-${i}`,
          OLD,
          when,
          'INFO',
          `model registry: loaded reco-two-tower-v19 (2.1 GiB, replacing reco-two-tower-v18 at 0.6 GiB) on recommendation-${i}, published by ml-platform (ML-1043)`,
          { 'event.name': 'model.reload', 'model.name': 'reco-two-tower-v19' },
        );
    }
    // The BFFs report their own degraded renders, a symptom that names no cause.
    const loaded = loadedPods(t, onset).length,
      when = Math.floor(t.getTime() / DEGRADED_EVERY_MS) * DEGRADED_EVERY_MS;
    if (loaded === 0 || !crossed(t, stepMs, when)) return;
    const n = when / DEGRADED_EVERY_MS,
      bff = n % 2 ? 'web-bff' : 'mobile-bff',
      pod = `${bff}-${1 + (n % 6)}`;
    emitLog(
      bff,
      pod,
      OLD,
      when,
      'WARN',
      `degraded render on ${pod}: ${loaded * (3 + (n % 4))} /home responses served without personalised rows in the last 20s (reco.for_user timed out after 500ms)`,
      { 'event.name': 'render.degraded' },
    );
  },
};
