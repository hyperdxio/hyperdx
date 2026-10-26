import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const SEAL_LEAD_MS = 40 * 60_000,
  EXPIRY_STEP_MS = 150_000,
  RECYCLE_MS = 4 * 60_000,
  RENEW_MS = 5 * 60_000;
const USERS = ['4Fh2Qx', 'p9LzTa', 'Wc81mE', 'k3RvYo', 'Zt6uNd', 'b0QsJh'];
const expiresAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * EXPIRY_STEP_MS;
// Pooled connections outlive the credential; only new ones fail, so each pod's share grows as its pool recycles.
const lapsed = (i: number, t: Date, onset: Date) =>
  Math.max(0, Math.min(1, (t.getTime() - expiresAt(i, onset)) / RECYCLE_MS));

// Vault sealed and stopped renewing promo's dynamic Postgres credentials. Each pod's credential was issued
// at a different time, so the pods lose their database logins one after another.
export const vaultSealed: Incident = {
  name: 'vault-sealed',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    if (lapsed(1, t, onset) === 0) return world;
    world.promo.failIf = ctx => {
      const i = Number(ctx.pod.split('-').pop());
      if (ctx.rng.next() >= lapsed(i, ctx.t, onset)) return null;
      const message = `error: password authentication failed for user "v-kubernetes-promo-ro-${USERS[i - 1]}"`;
      return {
        status: 500,
        message,
        durationMs: ctx.rng.gauss(14, 4),
        log: {
          severity: 'ERROR',
          every: 3,
          body: `${message}\n    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:287:98)\n    at applyPromo (/app/promo/apply.js:19:22)`,
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    const seal = onset.getTime() - SEAL_LEAD_MS,
      attrs = {
        'event.name': 'vault.agent',
        'server.address': 'vault.internal',
      };
    for (let i = 1; i <= 6; i++) {
      const pod = `promo-${i}`,
        sealedAt = seal + i * 1000;
      if (crossed(t, stepMs, sealedAt))
        emitLog(
          'promo',
          pod,
          OLD,
          sealedAt,
          'WARN',
          `vault agent on ${pod}: vault.internal answered 503 Vault is sealed; lease renewal for database/creds/promo-ro will retry`,
          attrs,
        );
      const renew =
        Math.floor((t.getTime() - sealedAt) / RENEW_MS) * RENEW_MS + sealedAt;
      if (renew <= sealedAt || !crossed(t, stepMs, renew)) continue;
      const left = Math.round((expiresAt(i, onset) - renew) / 60_000);
      emitLog(
        'promo',
        pod,
        OLD,
        renew,
        'WARN',
        `vault agent on ${pod}: lease renewal for database/creds/promo-ro failed: 503 Vault is sealed; credential v-kubernetes-promo-ro-${USERS[i - 1]} ${left > 0 ? `expires in ${left}m` : `expired ${-left}m ago`}`,
        attrs,
      );
    }
    // Unrelated: a checkout banner experiment widens just before the first pod's credential lapses.
    const flag = onset.getTime() - 2 * 60_000;
    for (let i = 1; i <= 6; i++) {
      const when = flag + i * 3000;
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          OLD,
          when,
          'INFO',
          `feature flag checkout.promo_banner_v2 now serving 25% of web sessions on checkout-${i} (MKT-1182)`,
          {
            'event.name': 'feature_flag.update',
            'flag.key': 'checkout.promo_banner_v2',
          },
        );
    }
  },
};
