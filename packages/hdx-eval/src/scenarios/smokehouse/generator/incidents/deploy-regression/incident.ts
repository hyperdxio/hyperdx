import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const FLIP_MS = 2 * 60_000;
const NEW = '2.0.0-rc1',
  OLD = '1.4.2';
const FIXED_AMOUNT = new Set(['FREESHIP', 'FLAT5', 'GIFT10']);
const flippedPods = (t: Date, onset: Date) =>
  Math.min(
    3,
    Math.max(0, Math.floor((t.getTime() - onset.getTime()) / FLIP_MS) + 1),
  );

export const deployRegression: Incident = {
  name: 'deploy-regression',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    // Distractor: payment finished a full rollout, one pod a minute, ending before checkout
    // started one. The versions follow the same schedule the rollout logs describe.
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= onset.getTime() - 10 * 60_000 + (i - 1) * 60_000)
        world.payment.versions[`payment-${i}`] = '3.7.0';
    const n = t < onset ? 0 : flippedPods(t, onset);
    if (n === 0) return world;
    const flipped = new Set([1, 2, 3].slice(0, n).map(i => `checkout-${i}`));
    for (const p of flipped) world.checkout.versions[p] = NEW;
    world.checkout.failIf = ctx => {
      if (!flipped.has(ctx.pod)) return null;
      if (!ctx.attrs.promoCode || !FIXED_AMOUNT.has(ctx.attrs.promoCode))
        return null;
      return {
        status: 500,
        message: 'Unhandled error processing POST /checkout',
        log: {
          severity: 'ERROR',
          every: 7,
          body: "TypeError: Cannot read properties of undefined (reading 'percentOff')\n    at applyPromotion (/app/handlers/promotion.js:42:19)\n    at placeOrder (/app/handlers/checkout.js:118:5)",
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - 10 * 60_000 + (i - 1) * 60_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'payment',
          `payment-${i}`,
          '3.7.0',
          when,
          'INFO',
          `deployment.rollout: payment-${i} updated 3.6.2 -> 3.7.0 (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': '3.6.2',
            'deployment.to': '3.7.0',
          },
        );
    }
    for (let i = 1; i <= 3; i++) {
      const when = onset.getTime() + (i - 1) * FLIP_MS;
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: checkout-${i} updated ${OLD} -> ${NEW} (${i}/6)${i === 3 ? ', rollout paused for canary observation' : ''}`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
    // Distractor: the new build emits a WARN flood unrelated to the failure, from each flipped
    // pod, on every third tick. Emitted here rather than from failIf so apply stays pure.
    const n = t < onset ? 0 : flippedPods(t, onset);
    if (n > 0 && Math.floor(t.getTime() / stepMs) % 3 === 0) {
      for (let i = 1; i <= n; i++)
        emitLog(
          'checkout',
          `checkout-${i}`,
          NEW,
          t.getTime(),
          'WARN',
          'DeprecationWarning: legacy session-cookie format detected',
          { 'event.name': 'runtime.deprecation' },
        );
    }
  },
};
