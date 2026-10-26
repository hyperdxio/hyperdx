import { emitLog } from '../../emit';
import type { Incident } from '../index';

const NEW = '1.5.0',
  OLD = '1.4.2';

export const segmentRegression: Incident = {
  name: 'segment-regression',
  defaultOnsetMs: -8 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    for (const p of Object.keys(world.pricing.versions))
      world.pricing.versions[p] = NEW;
    world.pricing.failIf = ctx => {
      if (ctx.attrs.tenantTier !== 'enterprise' || ctx.attrs.cacheHit)
        return null;
      return {
        status: 500,
        message: 'FallbackHandlerError',
        log: {
          severity: 'ERROR',
          body: 'FallbackHandlerError: schema mismatch in enterprise_v2_response (expected price_cents, got priceCents)\n    at enterpriseFallback (/app/pricing/fallback.js:77:11)',
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - 30_000 + (i - 1) * 5_000;
      if (t.getTime() - stepMs < when && when <= t.getTime())
        emitLog(
          'pricing',
          `pricing-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: pricing-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
  },
};
