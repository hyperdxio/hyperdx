import type { Incident } from '../index';

const RAMP_MS = 10 * 60_000;
const PEAK = 900,
  BASE = 6;

// Only the Postgres leaf under inventory changes. Timeouts in cart and checkout, and the
// gateway's latency, all follow from the walker's timeout rule.
export const dependencyCascade: Incident = {
  name: 'dependency-cascade',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    const frac = Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);
    world.inventory.storeLatencyMs = {
      mean: BASE + (PEAK - BASE) * frac,
      sd: 60 * frac + 3,
    };
    return world;
  },
};
