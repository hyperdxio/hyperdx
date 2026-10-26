import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const API_VERSION = '2022-11-15';
const BROWNOUT_MS = 30 * 60_000,
  REJECT_SHARE = 0.5;
const DEPRECATION_EVERY_MS = 3 * 60_000,
  SUNSET_AFTER_MS = 9 * 24 * 60 * 60_000;
const JOB_EVERY_MS = 60 * 60_000,
  JOB_LEAD_MS = 3 * 60_000,
  JOB_RUN_MS = 4 * 60_000;
const OLD = '1.4.2';

// payment pins the provider's API version 2022-11-15, which the provider is retiring. Ahead of the
// sunset it runs scheduled brownouts that reject half the requests on that version for thirty minutes.
// The deprecation headers have been logged for as long as there is data, so they read as routine.
export const apiVersionBrownout: Incident = {
  name: 'api-version-brownout',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    if (t < onset || t.getTime() >= onset.getTime() + BROWNOUT_MS) return world;
    world.payment.failIf = ctx =>
      ctx.rng.next() >= REJECT_SHARE
        ? null
        : {
            status: 502,
            message: `PaymentGatewayError: payments.example.com returned 400 api_version_deprecated (version ${API_VERSION} is in a scheduled brownout)`,
            durationMs: ctx.rng.gauss(110, 30),
            log: {
              severity: 'ERROR',
              every: 3,
              body: `PaymentGatewayError: payments.example.com returned 400 api_version_deprecated: "API version ${API_VERSION} is temporarily unavailable during a scheduled brownout ahead of its sunset; upgrade to 2025-06-30"\n    at GatewayClient.charge (/app/payment/gateway-client.js:88:15)\n    at chargeCard (/app/payment/charge.js:41:22)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const when =
      Math.floor(t.getTime() / DEPRECATION_EVERY_MS) * DEPRECATION_EVERY_MS;
    if (crossed(t, stepMs, when)) {
      const sunset = new Date(onset.getTime() + SUNSET_AFTER_MS).toUTCString();
      emitLog(
        'payment',
        `payment-${1 + ((when / DEPRECATION_EVERY_MS) % 6)}`,
        OLD,
        when,
        'WARN',
        `payments.example.com sent Deprecation: true and Sunset: ${sunset} for API version ${API_VERSION} on ${70 + ((when / DEPRECATION_EVERY_MS) % 50)} responses in the last 3m`,
        { 'event.name': 'http.deprecation_header' },
      );
    }
    // An hourly finance export that has nothing to do with live charges.
    const first = onset.getTime() - JOB_LEAD_MS;
    const run =
      first + Math.floor((t.getTime() - first) / JOB_EVERY_MS) * JOB_EVERY_MS;
    const attrs = { 'event.name': 'cron.job', 'job.name': 'settlement-export' };
    if (crossed(t, stepMs, run))
      emitLog(
        'payment',
        'payment-4',
        OLD,
        run,
        'INFO',
        `cron: settlement-export started on payment-4, exporting ${5800 + ((run / JOB_EVERY_MS) % 700)} settled charges from the last hour to finance-settlements`,
        attrs,
      );
    if (crossed(t, stepMs, run + JOB_RUN_MS))
      emitLog(
        'payment',
        'payment-4',
        OLD,
        run + JOB_RUN_MS,
        'INFO',
        'cron: settlement-export finished on payment-4 in 4m02s with 0 failures',
        attrs,
      );
  },
};
