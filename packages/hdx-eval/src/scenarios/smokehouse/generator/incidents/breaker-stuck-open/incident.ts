import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const FRAUD_NEW = '2.0.0',
  OLD = '1.4.2';
const BLIP_MS = 28 * 60_000,
  BLIP_LEN_MS = 50_000;
const DRAIN_MS = 34 * 60_000;
const DRAINED = ['checkout-3', 'checkout-5'];
const PROBE_MS = 30_000;

const rolledAt = (i: number, onset: Date) => onset.getTime() + (i - 1) * 30_000;

// fraud 2.0.0 moves its health check off /healthz. Harmless until a fifty second fraud blip opens
// checkout's breaker to fraud: the half-open probe still asks /healthz, gets 404, and the breaker
// never closes. Only pods restarted by a node drain come back.
export const breakerStuckOpen: Incident = {
  name: 'breaker-stuck-open',
  defaultOnsetMs: -40 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.fraud.versions[`fraud-${i}`] = FRAUD_NEW;
    const blip = onset.getTime() + BLIP_MS,
      now = t.getTime();
    if (now < blip) return world;
    if (now < blip + BLIP_LEN_MS) {
      world.fraud.failIf = () => ({
        status: 503,
        message:
          'upstream connect error: fraud model server not ready (reloading model)',
      });
      return world;
    }
    const drained = now >= onset.getTime() + DRAIN_MS;
    // checkout calls promo just before fraud, so failing after promo is the breaker refusing the fraud call.
    world.checkout.afterCall = (ctx, callee) =>
      callee.service !== 'promo' || (drained && DRAINED.includes(ctx.pod))
        ? null
        : {
            status: 503,
            message:
              'CircuitBreakerOpenError: circuit fraud is OPEN, failing fast',
            log: {
              severity: 'ERROR',
              every: 4,
              body: 'CircuitBreakerOpenError: circuit fraud is OPEN, failing fast\n    at Breaker.call (/app/node_modules/opossum/lib/circuit.js:612:21)\n    at scoreOrder (/app/checkout/fraud-client.js:30:14)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'fraud',
          `fraud-${i}`,
          FRAUD_NEW,
          when,
          'INFO',
          `deployment.rollout: fraud-${i} updated ${OLD} -> ${FRAUD_NEW} (${i}/6); health endpoints now /health/live and /health/ready`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': FRAUD_NEW,
          },
        );
    }
    const blip = onset.getTime() + BLIP_MS,
      drain = onset.getTime() + DRAIN_MS;
    for (let i = 1; i <= 6; i++) {
      const pod = `checkout-${i}`,
        at = blip + 4_000 + i * 700;
      if (crossed(t, stepMs, at))
        emitLog(
          'checkout',
          pod,
          OLD,
          at,
          'WARN',
          `circuit fraud on ${pod}: OPEN after 5 consecutive failures (503 from fraud)`,
          {
            'event.name': 'circuit.state',
            'circuit.name': 'fraud',
            'circuit.state': 'open',
          },
        );
    }
    if (crossed(t, stepMs, blip + BLIP_LEN_MS))
      emitLog(
        'fraud',
        'fraud-2',
        FRAUD_NEW,
        blip + BLIP_LEN_MS,
        'INFO',
        'model server ready: risk-v38 loaded, serving',
        { 'event.name': 'fraud.model.ready' },
      );
    for (const pod of DRAINED) {
      if (crossed(t, stepMs, drain))
        emitLog(
          'checkout',
          pod,
          OLD,
          drain,
          'WARN',
          `k8s.event: pod ${pod} evicted by node drain (node ip-10-0-7-41.ec2.internal), rescheduled`,
          { 'event.name': 'k8s.pod.evicted' },
        );
      if (crossed(t, stepMs, drain + 20_000))
        emitLog(
          'checkout',
          pod,
          OLD,
          drain + 20_000,
          'INFO',
          `circuit fraud on ${pod}: CLOSED (initial state)`,
          {
            'event.name': 'circuit.state',
            'circuit.name': 'fraud',
            'circuit.state': 'closed',
          },
        );
    }
    const probe = Math.floor(t.getTime() / PROBE_MS) * PROBE_MS;
    if (probe <= blip + BLIP_LEN_MS || !crossed(t, stepMs, probe)) return;
    for (let i = 1; i <= 6; i++) {
      const pod = `checkout-${i}`;
      if (probe >= drain && DRAINED.includes(pod)) continue;
      emitLog(
        'checkout',
        pod,
        OLD,
        probe + i * 300,
        'WARN',
        `circuit fraud on ${pod}: half-open probe GET http://fraud:8080/healthz returned 404, reopening for 30s`,
        {
          'event.name': 'circuit.state',
          'circuit.name': 'fraud',
          'circuit.state': 'open',
        },
      );
      emitLog(
        'fraud',
        `fraud-${i}`,
        FRAUD_NEW,
        probe + i * 300 + 2,
        'INFO',
        `route not found: GET /healthz from ${pod}`,
        { 'event.name': 'http.not_found' },
      );
    }
  },
};
