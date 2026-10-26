import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const KID = 'idp-eu-2026-10';
// Access tokens live fifteen minutes, so the share signed with the new key grows as EU sessions refresh.
const REFRESH_MS = 15 * 60_000,
  REPORT_MS = 20_000,
  BFF_MS = 30_000;
const share = (t: number, onset: Date) =>
  t < onset.getTime() ? 0 : Math.min(1, (t - onset.getTime()) / REFRESH_MS);

// The external identity provider rotates its EU signing key without publishing it ahead of time.
// auth caches the provider's JWKS for a day and does not refetch on an unknown kid, so every EU token
// signed with the new key fails verification. US tokens and auth's own session keys are untouched.
export const idpKeyRotation: Incident = {
  name: 'idp-key-rotation',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    const s = share(t.getTime(), onset);
    if (s === 0) return world;
    world.auth.failIf = ctx =>
      ctx.attrs.region !== 'eu-west-1' || ctx.rng.next() >= s
        ? null
        : {
            status: 500,
            message: `SigningKeyNotFoundError: no key matching kid "${KID}" in cached JWKS from login.example.com`,
            log: {
              severity: 'ERROR',
              every: 5,
              body: `SigningKeyNotFoundError: no key matching kid "${KID}" in cached JWKS from login.example.com\n    at JwksClient.getSigningKey (/app/node_modules/jwks-rsa/src/JwksClient.js:72:13)\n    at verifyToken (/app/auth/verify.js:34:22)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS,
      s = share(when, onset);
    if (s > 0 && crossed(t, stepMs, when)) {
      const n = when / REPORT_MS;
      emitLog(
        'auth',
        `auth-${1 + (n % 6)}`,
        OLD,
        when,
        'WARN',
        `jwks: unknown kid ${KID} on ${1 + Math.round(s * (8 + (n % 6)))} tokens in the last 20s; cached keyset from login.example.com has idp-eu-2026-04, idp-us-2026-04 (fetched 19h ago, refreshes every 24h)`,
        {
          'event.name': 'jwks.unknown_kid',
          'server.address': 'login.example.com',
        },
      );
    }
    const bff = Math.floor(t.getTime() / BFF_MS) * BFF_MS,
      sb = share(bff, onset);
    if (sb === 0 || !crossed(t, stepMs, bff)) return;
    const n = bff / BFF_MS,
      svc = n % 2 === 0 ? 'web-bff' : 'mobile-bff';
    emitLog(
      svc,
      `${svc}-${1 + (n % 6)}`,
      OLD,
      bff,
      'WARN',
      `${svc}-${1 + (n % 6)}: ${2 + Math.round(sb * (10 + (n % 7)))} requests answered 502 in the last 30s after auth.verify returned 500`,
      { 'event.name': 'upstream.errors' },
    );
  },
};
