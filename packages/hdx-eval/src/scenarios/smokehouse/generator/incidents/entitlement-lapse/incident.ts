import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const TENANT = 'umbrella';
// Minutes after the billing sync that each auth pod's cached entitlements for the tenant expire.
const EXPIRY_MIN = [30, 30.5, 31.5, 32, 33, 34];
const CONFIG_MS = 29 * 60_000;

const expiredAt = (i: number, onset: Date) =>
  onset.getTime() + EXPIRY_MIN[i - 1] * 60_000;

// Billing marks one tenant past_due and revokes its plan. auth caches entitlements for thirty
// minutes, then builds claims from a null plan and throws on every request from that tenant.
// web-bff changes its render cache TTL a minute before the first failures, harmlessly.
export const entitlementLapse: Incident = {
  name: 'entitlement-lapse',
  defaultOnsetMs: -36 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.auth.failIf = ctx =>
      ctx.attrs.tenantId !== TENANT ||
      t.getTime() < expiredAt(Number(ctx.pod.split('-').pop()), onset)
        ? null
        : {
            status: 500,
            message:
              "TypeError: Cannot read properties of null (reading 'features')",
            log: {
              severity: 'ERROR',
              every: 3,
              body: `TypeError: Cannot read properties of null (reading 'features')\n    at buildClaims (/app/auth/claims.js:52:31)\n    at verifyToken (/app/auth/verify.js:40:17)\n    tenant=${TENANT} plan=null subscription_status=past_due`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'auth',
        'auth-2',
        '1.4.2',
        at,
        'INFO',
        `billing-sync: tenant ${TENANT} subscription active -> past_due (invoice INV-88412, card declined); plan pro-annual entitlements revoked`,
        { 'event.name': 'billing.sync', 'tenant.id': TENANT },
      );
    for (let i = 1; i <= 6; i++) {
      const when = expiredAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'auth',
          `auth-${i}`,
          '1.4.2',
          when,
          'INFO',
          `entitlements cache refreshed for tenant ${TENANT} on auth-${i}: plan none, 0 features`,
          { 'event.name': 'entitlements.refresh', 'tenant.id': TENANT },
        );
      const change = at + CONFIG_MS + i * 1_000;
      if (crossed(t, stepMs, change))
        emitLog(
          'web-bff',
          `web-bff-${i}`,
          '1.4.2',
          change,
          'INFO',
          `config.change: render cache ttl 60s -> 300s on web-bff-${i} (change CFG-3177)`,
          {
            'event.name': 'config.change',
            'config.key': 'render.cache.ttl',
            'config.from': '60s',
            'config.to': '300s',
          },
        );
    }
  },
};
