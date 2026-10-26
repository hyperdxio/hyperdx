import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const OUTAGE_LEAD_MS = 10 * 60_000,
  EXPIRY_STEP_MS = 40_000,
  LEGACY_SHARE = 0.6,
  PRICING_LEAD_MS = 60_000;
const expiresAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * EXPIRY_STEP_MS;

// The hosted flag service drops checkout's stream. Each pod serves cached flags for ten minutes, then
// the code defaults, where checkout.tax_engine_v2 is off: taxed orders go to a tax host retired months ago.
export const flagSdkDefaults: Incident = {
  name: 'flag-sdk-defaults',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    const expired = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= expiresAt(i, onset))
        .map(i => `checkout-${i}`),
    );
    if (expired.size === 0) return world;
    world.checkout.failIf = ctx =>
      !expired.has(ctx.pod) || ctx.rng.next() >= LEGACY_SHARE
        ? null
        : {
            status: 500,
            message: 'LegacyTaxError: getaddrinfo ENOTFOUND tax-v1.internal',
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'LegacyTaxError: getaddrinfo ENOTFOUND tax-v1.internal (checkout.tax_engine_v2=false)\n    at GetAddrInfoReqWrap.onlookup (node:dns:109:26)\n    at legacyTaxQuote (/app/checkout/tax/v1.js:22:9)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const down = onset.getTime() - OUTAGE_LEAD_MS,
      sdk = {
        'event.name': 'flags.sdk',
        'server.address': 'flags.example.com',
      };
    for (let i = 1; i <= 6; i++) {
      const pod = `checkout-${i}`,
        lost = down + i * 2000;
      if (crossed(t, stepMs, lost))
        emitLog(
          'checkout',
          pod,
          OLD,
          lost,
          'WARN',
          `flag sdk on ${pod}: stream to flags.example.com disconnected (503 Service Unavailable), serving cached flag values, cache ttl 10m`,
          sdk,
        );
      const retry = lost + Math.floor((t.getTime() - lost) / 60_000) * 60_000;
      if (retry > lost && crossed(t, stepMs, retry))
        emitLog(
          'checkout',
          pod,
          OLD,
          retry,
          'WARN',
          `flag sdk on ${pod}: reconnect to flags.example.com failed (503), attempt ${(retry - lost) / 60_000}`,
          sdk,
        );
      const exp = expiresAt(i, onset);
      if (crossed(t, stepMs, exp))
        emitLog(
          'checkout',
          pod,
          OLD,
          exp,
          'WARN',
          `flag sdk on ${pod}: cached values expired, serving code defaults for 214 flags`,
          sdk,
        );
      // Unrelated: pricing doubles its price cache TTL a minute before onset.
      const ttl = onset.getTime() - PRICING_LEAD_MS + i * 4000;
      if (crossed(t, stepMs, ttl))
        emitLog(
          'pricing',
          `pricing-${i}`,
          OLD,
          ttl,
          'INFO',
          `config.change: price-cache ttl 300s -> 600s on pricing-${i} (PRC-118)`,
          { 'event.name': 'config.change' },
        );
    }
  },
};
