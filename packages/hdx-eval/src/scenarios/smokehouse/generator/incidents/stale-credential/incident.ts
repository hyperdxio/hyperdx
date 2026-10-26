import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NEW_KID = 'svc-2026-09',
  OLD_KID = 'svc-2026-08';
const GRACE_MS = 42 * 60_000;
const WARN_EVERY_MS = 5 * 60_000;
// Every caller of pricing except search, which mounts the token secret with subPath and never sees the new file.
const RELOADERS = ['web-bff', 'mobile-bff', 'checkout'];

// The platform rotates the service token callers present to pricing. pricing accepts the old
// signing key for a grace period, then drops it, and every search call to pricing gets a 401.
export const staleCredential: Incident = {
  name: 'stale-credential',
  defaultOnsetMs: -50 * 60_000,
  apply(t, onset, world) {
    if (t.getTime() < onset.getTime() + GRACE_MS) return world;
    // Only search calls pricing on GET /search, so the route stands in for the caller's token.
    world.pricing.failIf = ctx =>
      ctx.route !== 'GET /search'
        ? null
        : {
            status: 401,
            message: `invalid_token: signing key ${OLD_KID} is not in the keyring`,
            log: {
              severity: 'WARN',
              every: 6,
              body: `rejected service token from search: kid ${OLD_KID} not in keyring (active ${NEW_KID})`,
            },
          };
    world.search.afterCall = (_ctx, callee) =>
      callee.service !== 'pricing'
        ? null
        : {
            status: 502,
            message: 'PricingClientError: pricing returned 401 Unauthorized',
            log: {
              severity: 'ERROR',
              every: 3,
              body: `PricingClientError: pricing returned 401 Unauthorized (invalid_token, kid ${OLD_KID})\n    token file /var/run/secrets/pricing/token loaded at startup\n    at PricingClient.quote (/app/search/pricing-client.js:47:13)\n    at enrichResults (/app/search/query.js:88:22)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime(),
      retire = at + GRACE_MS;
    for (let i = 1; i <= 6; i++) {
      const keyring = at + i * 400;
      if (crossed(t, stepMs, keyring))
        emitLog(
          'pricing',
          `pricing-${i}`,
          '1.4.2',
          keyring,
          'INFO',
          `keyring: added service token signing key ${NEW_KID} (active); ${OLD_KID} accepted until ${new Date(retire).toISOString()}`,
          { 'event.name': 'keyring.update' },
        );
      for (const [n, service] of RELOADERS.entries()) {
        const when = at + 5_000 + n * 2_000 + i * 300;
        if (crossed(t, stepMs, when))
          emitLog(
            service,
            `${service}-${i}`,
            '1.4.2',
            when,
            'INFO',
            `secret reload: pricing service token updated on ${service}-${i} (kid ${OLD_KID} -> ${NEW_KID})`,
            {
              'event.name': 'secret.reload',
              'secret.name': 'pricing-service-token',
            },
          );
      }
      if (crossed(t, stepMs, retire + i * 400))
        emitLog(
          'pricing',
          `pricing-${i}`,
          '1.4.2',
          retire + i * 400,
          'INFO',
          `keyring: grace period over, removed signing key ${OLD_KID}`,
          { 'event.name': 'keyring.update' },
        );
    }
    // pricing warns that search still signs with the old key, which nobody acts on.
    const when = Math.floor(t.getTime() / WARN_EVERY_MS) * WARN_EVERY_MS;
    if (when <= at || when >= retire || !crossed(t, stepMs, when)) return;
    emitLog(
      'pricing',
      `pricing-${1 + ((when / WARN_EVERY_MS) % 6)}`,
      '1.4.2',
      when,
      'WARN',
      `accepted ${180 + ((when / WARN_EVERY_MS) % 40)} service tokens signed by retiring key ${OLD_KID} in the last 5m, all from search`,
      { 'event.name': 'keyring.deprecated_key' },
    );
  },
};
