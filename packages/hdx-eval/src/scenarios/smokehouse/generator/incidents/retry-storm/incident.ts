import type { Incident } from '../index';

const BLIP_MS = 90_000;

// inventory fails for ninety seconds; cart's standing retry policy multiplies the calls, and
// the extra load keeps inventory saturated long after the original fault clears.
export const retryStorm: Incident = {
  name: 'retry-storm',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    world.cart.retries = { inventory: 3 };
    if (t < onset) return world;
    if (t.getTime() - onset.getTime() < BLIP_MS) {
      world.inventory.failIf = ctx =>
        ctx.rng.next() >= 0.7
          ? null
          : { status: 503, message: 'lock service unavailable' };
      return world;
    }
    world.inventory.latencyMs = { mean: 300, sd: 120 };
    world.inventory.failIf = ctx =>
      ctx.rng.next() >= 0.35
        ? null
        : { status: 503, message: 'rejected: worker queue full (depth 512)' };
    return world;
  },
};
