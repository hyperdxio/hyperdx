import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 2 * 60_000;
const PEAK = 0.32;
const SUNSET_EVERY_MS = 60_000;
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// The tax provider pricing calls for checkout quotes starts failing a share of calculations on its
// side. Only checkout quotes need tax, so product, search and cart prices are unaffected.
export const taxProviderErrors: Incident = {
  name: 'tax-provider-errors',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.pricing.failIf = ctx =>
      ctx.route !== 'POST /checkout' || ctx.rng.next() >= PEAK * f
        ? null
        : {
            status: 502,
            message:
              'TaxProviderError: tax.example.com returned 503 Service Unavailable',
            durationMs: ctx.rng.gauss(140, 40),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'TaxProviderError: tax.example.com returned 503 Service Unavailable (POST /v2/transactions/calculate, request-id tx-req-9f2c)\n    body: {"error":"upstream_unavailable","message":"calculation engine temporarily unavailable"}\n    at TaxClient.calculate (/app/pricing/tax-client.js:64:11)\n    at quoteCheckout (/app/pricing/quote.js:112:20)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    // Steady background since long before the incident: the provider's sunset notice on every pod.
    const when = Math.floor(t.getTime() / SUNSET_EVERY_MS) * SUNSET_EVERY_MS;
    if (!crossed(t, stepMs, when)) return;
    const pod = `pricing-${1 + ((when / SUNSET_EVERY_MS) % 6)}`;
    emitLog(
      'pricing',
      pod,
      OLD,
      when,
      'WARN',
      `tax.example.com replied with Deprecation: true and Sunset: Wed, 31 Mar 2027 00:00:00 GMT for /v2/transactions/calculate on ${pod}; move to /v3 before then`,
      {
        'event.name': 'http.client.deprecation',
        'server.address': 'tax.example.com',
      },
    );
  },
};
