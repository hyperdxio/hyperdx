import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  CHECKOUT_NEW = '1.4.6';
const FIRST_SWEEP_MS = 45_000,
  SWEEP_MS = 60_000,
  EMPTY_SHARE = 0.55;
const ROLL_LEAD_MS = 30 * 60_000,
  ROLL_STEP_MS = 40_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// A retention setting saved without a unit is read as seconds, so cart's sweeper deletes every cart
// idle for over 72 seconds. cart.get answers 200 with an empty cart; checkout assumes a cart it was
// sent to has lines and throws building the order. cart itself never errors.
export const cartRetention: Incident = {
  name: 'cart-retention',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.checkout.versions[`checkout-${i}`] = CHECKOUT_NEW;
    if (t.getTime() < onset.getTime() + FIRST_SWEEP_MS) return world;
    world.checkout.afterCall = (ctx, callee) =>
      callee.service !== 'cart' || ctx.rng.next() >= EMPTY_SHARE
        ? null
        : {
            status: 500,
            message:
              "TypeError: Cannot read properties of undefined (reading 'currency')",
            durationMs: ctx.rng.gauss(4, 1),
            log: {
              severity: 'ERROR',
              every: 3,
              body: "TypeError: Cannot read properties of undefined (reading 'currency')\n    at buildOrder (/app/checkout/order.js:88:31)\n    at placeOrder (/app/checkout/place.js:41:19)",
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'checkout',
          `checkout-${i}`,
          CHECKOUT_NEW,
          roll,
          'INFO',
          `deployment.rollout: checkout-${i} updated ${OLD} -> ${CHECKOUT_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': CHECKOUT_NEW,
          },
        );
    }
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'cart',
        'cart-1',
        OLD,
        at,
        'INFO',
        'cart-sweeper: retention settings saved from ops-console by j.alvarez (CART-2044): abandon_after 168h -> 72, sweep every 60s',
        {
          'event.name': 'cart.sweeper.settings',
          'sweeper.abandon_after': '72',
        },
      );
    const first = at + FIRST_SWEEP_MS;
    if (t.getTime() < first) return;
    const sweep =
      first + Math.floor((t.getTime() - first) / SWEEP_MS) * SWEEP_MS;
    if (!crossed(t, stepMs, sweep)) return;
    const n = (sweep - first) / SWEEP_MS,
      pod = `cart-${1 + (n % 6)}`;
    emitLog(
      'cart',
      pod,
      OLD,
      sweep,
      'INFO',
      `evicted ${n === 0 ? 61240 : 420 + ((n * 97) % 480)} abandoned carts on ${pod}`,
      { 'event.name': 'runtime.chatter' },
    );
  },
};
