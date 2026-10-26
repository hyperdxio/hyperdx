import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NEW = '2.3.0',
  OLD = '1.4.2';
const CANARY = [2, 4, 5];
const STEP_MS = 90_000;

const rolledAt = (k: number, onset: Date) => onset.getTime() + k * STEP_MS;

// promo 2.3.0 serializes discount.amount as a string when a code applies. promo answers 200 and its
// canary analysis passes; checkout throws parsing the reply, so the errors land one hop up.
export const malformedResponse: Incident = {
  name: 'malformed-response',
  defaultOnsetMs: -8 * 60_000,
  apply(t, onset, world) {
    CANARY.forEach((i, k) => {
      if (t.getTime() >= rolledAt(k, onset))
        world.promo.versions[`promo-${i}`] = NEW;
    });
    if (t < onset) return world;
    world.checkout.afterCall = (ctx, callee) =>
      callee.service !== 'promo' ||
      callee.version !== NEW ||
      !ctx.attrs.promoCode
        ? null
        : {
            status: 500,
            message:
              'PromoResponseError: invalid discount payload from promo: expected number at discount.amount, got string',
            log: {
              severity: 'ERROR',
              every: 2,
              body: `PromoResponseError: invalid discount payload from promo: expected number at discount.amount, got string ("${ctx.attrs.promoCode}")\n    at parseDiscount (/app/checkout/promo-client.js:52:13)\n    at applyPromo (/app/checkout/place.js:88:21)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    CANARY.forEach((i, k) => {
      const when = rolledAt(k, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'promo',
          `promo-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: promo-${i} updated ${OLD} -> ${NEW} (canary step ${k + 1} of 6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    });
    const held = rolledAt(CANARY.length, onset);
    if (crossed(t, stepMs, held))
      emitLog(
        'promo',
        'promo-2',
        NEW,
        held,
        'INFO',
        `canary promo ${NEW}: held at 50% for analysis, analysis passed (promo 5xx rate 0.02%, p99 19ms)`,
        { 'event.name': 'deployment.canary', 'deployment.to': NEW },
      );
  },
};
