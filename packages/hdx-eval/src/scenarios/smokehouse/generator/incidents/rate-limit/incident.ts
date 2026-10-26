import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const JOB = 'refund-sweep';
const QUEUED = 18_400;
const PROGRESS_MS = 15_000;
const FRAUD_MODEL_MS = -2 * 60_000;

// A refund batch inside payment shares the provider API key with live charges, so once it
// starts the key's quota runs out and a share of charges get 429s. fraud swaps its model two
// minutes earlier, with no effect.
export const rateLimit: Incident = {
  name: 'rate-limit',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.payment.failIf = ctx =>
      ctx.rng.next() >= 0.45
        ? null
        : {
            status: 503,
            message:
              'PaymentProviderError: payments.example.com returned 429 Too Many Requests',
            durationMs: ctx.rng.gauss(140, 40),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'PaymentProviderError: payments.example.com returned 429 Too Many Requests (x-ratelimit-limit 100, x-ratelimit-remaining 0, retry-after 1)\n    at ProviderClient.charge (/app/payment/provider.js:88:15)\n    at chargeCard (/app/payment/charge.js:40:11)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const fraudAt = onset.getTime() + FRAUD_MODEL_MS;
    for (let i = 1; i <= 6; i++) {
      if (crossed(t, stepMs, fraudAt + i * 500))
        emitLog(
          'fraud',
          `fraud-${i}`,
          '1.4.2',
          fraudAt + i * 500,
          'INFO',
          `config.change: fraud model risk-v37 -> risk-v38 loaded on fraud-${i} (change CFG-3140)`,
          {
            'event.name': 'config.change',
            'config.key': 'fraud.model',
            'config.from': 'risk-v37',
            'config.to': 'risk-v38',
          },
        );
    }
    const attrs = { 'event.name': 'batch.progress', 'batch.job': JOB };
    if (crossed(t, stepMs, onset.getTime()))
      emitLog(
        'payment',
        'payment-4',
        '1.4.2',
        onset.getTime(),
        'INFO',
        `batch ${JOB} started: ${QUEUED} refunds queued, concurrency 40, provider payments.example.com`,
        attrs,
      );
    const when = Math.floor(t.getTime() / PROGRESS_MS) * PROGRESS_MS;
    if (when <= onset.getTime() || !crossed(t, stepMs, when)) return;
    const n = (when - onset.getTime()) / PROGRESS_MS;
    emitLog(
      'payment',
      'payment-4',
      '1.4.2',
      when,
      'WARN',
      `batch ${JOB}: ${Math.min(QUEUED, Math.round(n * 1100))} of ${QUEUED} refunds submitted, provider answered 429 on ${180 + ((n * 37) % 90)} calls in the last 15s`,
      attrs,
    );
  },
};
