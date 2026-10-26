import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const RAMP_MS = 4 * 60_000;
const PEAK = 700,
  BASE = 6;
const NEW = '1.5.0',
  OLD = '1.4.2';

// The alerting path's own service ships a healthy build minutes before a callee's store slows;
// checkout then fails only through its 500 ms timeout on promo.apply.
export const deployRedHerring: Incident = {
  name: 'deploy-red-herring',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= onset.getTime() - 3 * 60_000 + (i - 1) * 10_000)
        world.checkout.versions[`checkout-${i}`] = NEW;
    if (t < onset) return world;
    const frac = Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);
    world.promo.storeLatencyMs = {
      mean: BASE + (PEAK - BASE) * frac,
      sd: 50 * frac + 3,
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - 3 * 60_000 + (i - 1) * 10_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: checkout-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
  },
};
