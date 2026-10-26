import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  CODE = 'SPRING25';

// Marketing edits one promo code's discount from 25 to 125 percent. promo applies it as written, checkout
// totals go negative, and the payment provider rejects those charges. Only orders using that code fail.
export const discountTypo: Incident = {
  name: 'discount-typo',
  defaultOnsetMs: -13 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.payment.failIf = ctx =>
      ctx.route !== 'POST /checkout' || ctx.attrs.promoCode !== CODE
        ? null
        : {
            status: 502,
            message:
              'payments.example.com rejected charge: invalid_amount (amount must be greater than 0)',
            durationMs: ctx.rng.gauss(130, 40),
            log: {
              severity: 'WARN',
              every: 2,
              body: `charge rejected by payments.example.com on ${ctx.pod}: invalid_amount, amount -${1200 + Math.floor(ctx.rng.next() * 9000)} minor units for tenant ${ctx.attrs.tenantId}`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'promo',
        'promo-5',
        OLD,
        at,
        'INFO',
        `promo admin: rule ${CODE} updated by marketing (MKT-2291): percent_off 25 -> 125, stackable false, ends 2026-10-31`,
        { 'event.name': 'promo.rule.updated', 'promo.code': CODE },
      );
  },
};
