import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const HOST = 'catalog-index.search.svc';
// Pooled keep-alive connections survive the expiry; only new handshakes fail, so errors climb
// as the pool recycles.
const RECYCLE_MS = 5 * 60_000;
const WARN_EVERY_MS = 10 * 60_000;
const share = (t: Date, onset: Date) =>
  t < onset
    ? 0
    : 0.95 * Math.min(1, (t.getTime() - onset.getTime()) / RECYCLE_MS);

// The TLS certificate on the Elasticsearch cluster behind search expires. Nothing ships and
// search's own code is unchanged; the expiry checker warned for an hour beforehand.
export const esCertExpiry: Incident = {
  name: 'es-cert-expiry',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    const s = share(t, onset);
    if (s === 0) return world;
    world.search.failIf = ctx =>
      ctx.rng.next() >= s
        ? null
        : {
            status: 503,
            message: `ConnectionError: certificate has expired (CERT_HAS_EXPIRED) connecting to https://${HOST}:9200`,
            log: {
              severity: 'ERROR',
              every: 4,
              body: `ConnectionError: certificate has expired\n    code: 'CERT_HAS_EXPIRED', host: '${HOST}', port: 9200\n    at TLSSocket.onConnectSecure (node:_tls_wrap:1674:34)\n    at EsClient.search (/app/search/es.js:52:17)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let before = 6; before >= 1; before--) {
      const when = onset.getTime() - before * WARN_EVERY_MS;
      if (crossed(t, stepMs, when))
        emitLog(
          'search',
          `search-${1 + (before % 6)}`,
          '1.4.2',
          when,
          'WARN',
          `tls.expiry: certificate CN=*.search.svc for ${HOST} (issuer internal-ca) expires in ${before * 10} minutes, not renewed`,
          { 'event.name': 'tls.expiry', 'tls.server.name': HOST },
        );
    }
    if (crossed(t, stepMs, onset.getTime()))
      emitLog(
        'search',
        'search-1',
        '1.4.2',
        onset.getTime(),
        'ERROR',
        `tls.expiry: certificate CN=*.search.svc for ${HOST} expired, notAfter ${onset.toISOString()}`,
        { 'event.name': 'tls.expiry', 'tls.server.name': HOST },
      );
  },
};
