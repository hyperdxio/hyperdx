import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const MAX_AGE_MS = 60 * 60_000,
  REFRESH_MS = 5 * 60_000;
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

// pricing refreshes FX rates every five minutes and refuses to quote a non-USD price on rates older
// than an hour. The provider revoked the key, so the last good rates age out an hour after they were fetched.
export const fxRatesStale: Incident = {
  name: 'fx-rates-stale',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.pricing.failIf = ctx =>
      ctx.attrs.region !== 'eu-west-1'
        ? null
        : {
            status: 500,
            message:
              'StaleRatesError: fx rate EUR/USD older than max_age 60m, refusing to quote',
            log: {
              severity: 'ERROR',
              every: 3,
              body: `StaleRatesError: fx rate EUR/USD older than max_age 60m, refusing to quote\n    at assertFresh (/app/pricing/fx.js:88:11)\n    at quote (/app/pricing/quote.js:41:5)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const fetched = onset.getTime() - MAX_AGE_MS,
      attrs = {
        'event.name': 'fx.refresh',
        'server.address': 'rates.example.com',
      };
    const when =
      fetched + Math.floor((t.getTime() - fetched) / REFRESH_MS) * REFRESH_MS;
    if (crossed(t, stepMs, when)) {
      if (when <= fetched)
        emitLog(
          'pricing',
          'pricing-1',
          OLD,
          when,
          'INFO',
          'fx rates refreshed from rates.example.com on pricing-1: 31 currencies, base USD',
          attrs,
        );
      else
        emitLog(
          'pricing',
          'pricing-1',
          OLD,
          when,
          'WARN',
          `fx rates refresh from rates.example.com failed on pricing-1: 401 invalid_api_key (key fxk_live_...7Qd revoked); serving rates fetched at ${hm(fetched)}Z`,
          attrs,
        );
    }
    // Unrelated: promo's nightly sweep of codes past their end date.
    const sweep = onset.getTime() - 4 * 60_000,
      cron = { 'event.name': 'cron.run', 'cron.job': 'promo-expiry-sweep' };
    if (crossed(t, stepMs, sweep))
      emitLog(
        'promo',
        'promo-3',
        OLD,
        sweep,
        'INFO',
        'cron promo-expiry-sweep started on promo-3: 1,920 codes past their end date to expire',
        cron,
      );
    if (crossed(t, stepMs, sweep + 95_000))
      emitLog(
        'promo',
        'promo-3',
        OLD,
        sweep + 95_000,
        'INFO',
        'cron promo-expiry-sweep finished on promo-3: 1,920 codes expired in 95s',
        cron,
      );
  },
};
