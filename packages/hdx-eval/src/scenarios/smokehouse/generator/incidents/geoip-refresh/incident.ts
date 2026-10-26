import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const STEP_MS = 30_000,
  WEB_LEAD_MS = 2 * 60_000,
  MISS_SHARE = 0.2;
const loadedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * STEP_MS;

// The weekly GeoIP refresh on edge-gateway downloaded a truncated GeoLite2-City file and reloaded it
// unchecked. Lookups that miss the gateway's IP cache walk past the end of the file and throw.
export const geoipRefresh: Incident = {
  name: 'geoip-refresh',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    const on = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= loadedAt(i, onset))
        .map(i => `edge-gateway-${i}`),
    );
    if (on.size === 0) return world;
    world['edge-gateway'].failIf = ctx =>
      !on.has(ctx.pod) || ctx.rng.next() >= MISS_SHARE
        ? null
        : {
            status: 500,
            message:
              'GeoIPLookupError: unexpected end of database while reading search tree node (GeoLite2-City.mmdb)',
            log: {
              severity: 'ERROR',
              every: 4,
              body: `GeoIPLookupError: unexpected end of database while reading search tree node ${2_400_000 + Math.floor(ctx.rng.next() * 900_000)} (GeoLite2-City.mmdb build 20260922)\n    at Reader.readNode (/app/node_modules/maxmind/lib/reader.js:112:13)\n    at resolveRegion (/app/gateway/geo.js:41:19)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = loadedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          OLD,
          when,
          'INFO',
          `geoipupdate on edge-gateway-${i}: downloaded GeoLite2-City.mmdb build 20260922 (14.1 MB, previous build 68.4 MB), checksum not verified, reloaded the geo resolver`,
          { 'event.name': 'geoip.update' },
        );
      // Unrelated: web-bff doubles its render cache TTL two minutes earlier.
      const ttl = onset.getTime() - WEB_LEAD_MS + i * 5000;
      if (crossed(t, stepMs, ttl))
        emitLog(
          'web-bff',
          `web-bff-${i}`,
          OLD,
          ttl,
          'INFO',
          `config.change: render cache ttl 30s -> 60s on web-bff-${i} (WEB-771)`,
          { 'event.name': 'config.change' },
        );
    }
  },
};
