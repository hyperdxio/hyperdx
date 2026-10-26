import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import { TENANTS } from '../../world';
import type { Incident } from '../index';

const OLD = '1.4.2';
// Play Console staged rollout steps, minutes from onset, and the share of Android users on 5.10.0.
const STEPS: Array<[number, number]> = [
  [-20, 5],
  [-12, 15],
  [-4, 40],
  [2, 60],
];
const FULL_PCT = 60,
  EXTRA_PER_TICK = 0.6,
  CART_CONFIG_LEAD_MS = 60_000;
const pct = (t: Date, onset: Date) =>
  STEPS.filter(([m]) => t.getTime() >= onset.getTime() + m * 60_000).at(
    -1,
  )?.[1] ?? 0;

// ShopApp-Android 5.10.0 refreshes the cart badge with GET /cart every ten seconds while the app is open.
// Cart reads grow with each rollout step until cart-db slows and cart outlasts its callers' 500 ms timeouts.
export const cartBadgePolling: Incident = {
  name: 'cart-badge-polling',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    const f = pct(t, onset) / FULL_PCT;
    if (f === 0) return world;
    world.cart.storeLatencyByName = {
      'cart-db': { mean: 6 + 200 * f * f, sd: 3 + 80 * f * f },
      carts: { mean: 6 + 10 * f, sd: 3 + 4 * f },
    };
    return world;
  },
  surge(t, onset) {
    const f = pct(t, onset) / FULL_PCT;
    if (f === 0) return null;
    const [tenantId] = TENANTS[Math.floor(t.getTime() / 1000) % TENANTS.length];
    return {
      forced: { route: 'GET /cart', bff: 'mobile-bff', tenantId },
      perTick: EXTRA_PER_TICK * f,
    };
  },
  events(t, onset, stepMs) {
    for (const [m, p] of STEPS) {
      const when = onset.getTime() + m * 60_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'mobile-bff',
          'mobile-bff-1',
          OLD,
          when,
          'INFO',
          `release tracker: ShopApp-Android 5.10.0 staged rollout raised to ${p}% of android users (Play Console)`,
          { 'event.name': 'client.release', 'client.version': '5.10.0' },
        );
    }
    // Unrelated: cart's sweeper evicts in bigger batches from a minute before onset.
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - CART_CONFIG_LEAD_MS + i * 4000;
      if (crossed(t, stepMs, when))
        emitLog(
          'cart',
          `cart-${i}`,
          OLD,
          when,
          'INFO',
          `config.change: abandoned cart eviction batch size 500 -> 1000 on cart-${i} (CART-2101)`,
          { 'event.name': 'config.change' },
        );
    }
  },
};
