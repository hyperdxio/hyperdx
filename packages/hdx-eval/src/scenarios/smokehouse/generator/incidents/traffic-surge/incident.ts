import type { Incident } from '../index';

const RAMP_MS = 3 * 60_000;
// Extra requests per tick at the peak; the base mix sends /search about 0.2 per tick, so ~7x.
const PEAK_EXTRA = 1.2;
const load = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// One free-tier tenant scrapes search from the web client. search slows and sheds with its
// volume, for every tenant, while its own store and callees stay flat.
export const trafficSurge: Incident = {
  name: 'traffic-surge',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    const f = load(t, onset);
    if (f === 0) return world;
    world.search.latencyMs = { mean: 12 + 290 * f, sd: 4 + 90 * f };
    world.search.failIf = ctx =>
      ctx.rng.next() >= 0.04 * f
        ? null
        : {
            status: 503,
            message: 'search overloaded: request queue full, shedding',
          };
    return world;
  },
  surge(t, onset) {
    const f = load(t, onset);
    return f === 0
      ? null
      : {
          forced: { route: 'GET /search', bff: 'web-bff', tenantId: 'hooli' },
          perTick: PEAK_EXTRA * f,
        };
  },
};
