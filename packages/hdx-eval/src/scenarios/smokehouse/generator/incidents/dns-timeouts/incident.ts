import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 3 * 60_000,
  PEAK = 0.18,
  FLAG_LEAD_MS = 5 * 60_000,
  REPORT_MS = 15_000;
const share = (t: number, onset: Date) =>
  t < onset.getTime() ? 0 : PEAK * Math.min(1, (t - onset.getTime()) / RAMP_MS);

// CoreDNS is scaled down to two replicas and they fall behind at peak. payment and email-worker
// resolve their external hosts on every new connection, through ndots 5 and four search domains,
// so a share of lookups time out or come back SERVFAIL. Nothing in the services changed.
export const dnsTimeouts: Incident = {
  name: 'dns-timeouts',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    const s = share(t.getTime(), onset);
    if (s === 0) return world;
    world.payment.failIf = ctx => {
      if (ctx.rng.next() >= s) return null;
      return ctx.rng.next() < 0.5
        ? {
            status: 502,
            message: 'getaddrinfo EAI_AGAIN payments.example.com',
            durationMs: ctx.rng.gauss(2505, 20),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'Error: getaddrinfo EAI_AGAIN payments.example.com\n    at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:107:26)\n    at chargeCard (/app/payment/gateway-client.js:41:9)',
            },
          }
        : {
            status: 502,
            message: 'queryA ESERVFAIL payments.example.com',
            durationMs: ctx.rng.gauss(45, 10),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'Error: queryA ESERVFAIL payments.example.com\n    at QueryReqWrap.onresolve [as oncomplete] (node:internal/dns/callback_resolver:45:19)\n    at chargeCard (/app/payment/gateway-client.js:41:9)',
            },
          };
    };
    world['email-worker'].failIf = ctx =>
      ctx.rng.next() >= s
        ? null
        : {
            status: 500,
            message: 'getaddrinfo EAI_AGAIN smtp.example.com',
            durationMs: ctx.rng.gauss(2505, 20),
            log: {
              severity: 'ERROR',
              every: 2,
              body: 'Error: getaddrinfo EAI_AGAIN smtp.example.com\n    at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:107:26)\n    at SMTPConnection.connect (/app/node_modules/nodemailer/lib/smtp-connection/index.js:236:13)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - FLAG_LEAD_MS + i * 2_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          OLD,
          when,
          'INFO',
          `feature flag checkout.express_pay now serving 10% of web sessions on checkout-${i} (PAY-2210)`,
          {
            'event.name': 'feature_flag.update',
            'flag.key': 'checkout.express_pay',
          },
        );
    }
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (share(when, onset) === 0 || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS;
    emitLog(
      'payment',
      `payment-${1 + (n % 6)}`,
      OLD,
      when,
      'WARN',
      `dns: lookup payments.example.com via nameserver 10.96.0.10 timed out after 2500ms on payment-${1 + (n % 6)} (attempt 2 of 2, ndots 5, 4 search domains tried first)`,
      { 'event.name': 'dns.lookup_timeout', 'server.address': '10.96.0.10' },
    );
    if (n % 2 === 0)
      emitLog(
        'email-worker',
        `email-worker-${1 + (n % 6)}`,
        OLD,
        when,
        'WARN',
        `smtp.example.com lookup failed on email-worker-${1 + (n % 6)}: SERVFAIL from nameserver 10.96.0.10, message requeued`,
        { 'event.name': 'dns.lookup_failed', 'server.address': '10.96.0.10' },
      );
  },
};
