import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const DECLINE_SHARE = 0.7,
  JOB_LEAD_MS = 3 * 60_000,
  JOB_MS = 8 * 60_000,
  SETTLEMENTS = 2318;

// The payment provider starts enforcing strong customer authentication on EEA cards with no notice in
// the logs. payment has no mapping for the new decline code and turns it into a 502 instead of a challenge.
export const scaEnforcement: Incident = {
  name: 'sca-enforcement',
  defaultOnsetMs: -8 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.payment.failIf = ctx =>
      ctx.route !== 'POST /checkout' ||
      ctx.attrs.region !== 'eu-west-1' ||
      ctx.rng.next() >= DECLINE_SHARE
        ? null
        : {
            status: 502,
            message:
              'PaymentProviderError: unmapped decline_code authentication_required',
            durationMs: ctx.rng.gauss(140, 40),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'PaymentProviderError: unmapped decline_code authentication_required from payments.example.com (issuer requires 3-D Secure for EEA card, sca_exemption=none)\n    at mapDecline (/app/payment/provider.js:88:11)\n    at charge (/app/payment/charge.js:44:9)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    // Unrelated: payment's daily payout reconciliation reads settlement files and never touches charges.
    const start = onset.getTime() - JOB_LEAD_MS,
      job = { 'event.name': 'cron.job', 'job.name': 'payout-reconciliation' };
    if (crossed(t, stepMs, start))
      emitLog(
        'payment',
        'payment-2',
        OLD,
        start,
        'INFO',
        `payout reconciliation job started on payment-2 for 2026-09-21: ${SETTLEMENTS.toLocaleString('en-US')} settlements to match`,
        job,
      );
    const tick = start + Math.floor((t.getTime() - start) / 60_000) * 60_000;
    if (tick <= start || tick > start + JOB_MS || !crossed(t, stepMs, tick))
      return;
    const done = Math.round(((tick - start) / JOB_MS) * SETTLEMENTS);
    emitLog(
      'payment',
      'payment-2',
      OLD,
      tick,
      'INFO',
      `payout reconciliation job on payment-2: ${done.toLocaleString('en-US')} of ${SETTLEMENTS.toLocaleString('en-US')} settlements matched, ${done % 7} discrepancies`,
      job,
    );
  },
};
