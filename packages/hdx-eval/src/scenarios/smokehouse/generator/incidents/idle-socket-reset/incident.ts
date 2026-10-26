import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  NEW = '1.4.3';
const SHARE = 0.22;
const ROLL_MS = 5 * 60_000,
  ROLL_STEP_MS = 30_000;
const STATS_MS = 30_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() + ROLL_MS + (i - 1) * ROLL_STEP_MS;

// The payment provider moves its API behind new load balancers that drop connections idle for 30s.
// payment's agent keeps idle sockets for 60s, so charges sent on a socket idle in between are reset.
// payment's own 1.4.3 rollout starts five minutes later and changes nothing.
export const idleSocketReset: Incident = {
  name: 'idle-socket-reset',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.payment.versions[`payment-${i}`] = NEW;
    if (t < onset) return world;
    world.payment.failIf = ctx => {
      if (ctx.rng.next() >= SHARE) return null;
      const idle = 30 + Math.floor(ctx.rng.next() * 30);
      return {
        status: 502,
        message:
          'PaymentProviderError: read ECONNRESET calling payments.example.com',
        durationMs: ctx.rng.gauss(40, 12),
        log: {
          severity: 'ERROR',
          every: 3,
          body: `PaymentProviderError: read ECONNRESET\n    request POST https://payments.example.com/v2/charges on reused socket idle ${idle}s (agent freeSocketTimeout 60s), not retried: charge is not idempotent\n    at TLSSocket.socketErrorListener (node:_http_client:501:9)\n    at chargeCard (/app/payment/charge.js:40:11)`,
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'payment',
          `payment-${i}`,
          NEW,
          when,
          'INFO',
          `deployment.rollout: payment-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
    // Emitted before onset too: the provider's server header and the reset count both change at onset.
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    if (!crossed(t, stepMs, stat)) return;
    const n = stat / STATS_MS,
      i = 1 + (n % 6),
      after = stat >= onset.getTime();
    const version = stat >= rolledAt(i, onset) ? NEW : OLD;
    emitLog(
      'payment',
      `payment-${i}`,
      version,
      stat,
      'INFO',
      `http agent payments.example.com on payment-${i}: ${8 + (n % 7)} sockets free, ${after ? 9 + (n % 11) : 0} reset by peer in the last 30s, server header "${after ? 'envoy' : 'pgw-edge/4.2'}"`,
      {
        'event.name': 'http.agent.stats',
        'server.address': 'payments.example.com',
      },
    );
  },
};
