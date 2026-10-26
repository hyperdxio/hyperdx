import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const TIMEOUT_MS = 150;
const PROVIDER_NOTICE_MS = -6 * 60_000;

// A change meant to fail fast on fraud scoring lowers checkout's default client timeout for every
// callee. payment charges take their usual ~130 ms, so a share of them now time out at checkout
// after the charge has gone through. A provider status notice six minutes earlier changes nothing.
export const clientTimeout: Incident = {
  name: 'client-timeout',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    if (t >= onset) world.checkout.timeoutMs = TIMEOUT_MS;
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() + i * 800;
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          '1.4.2',
          when,
          'INFO',
          `config.change: http.client.default_timeout 500ms -> ${TIMEOUT_MS}ms on checkout-${i} (change CFG-3202 "fail fast on fraud scoring")`,
          {
            'event.name': 'config.change',
            'config.key': 'http.client.default_timeout',
            'config.from': '500ms',
            'config.to': `${TIMEOUT_MS}ms`,
          },
        );
    }
    const notice = onset.getTime() + PROVIDER_NOTICE_MS;
    if (crossed(t, stepMs, notice))
      emitLog(
        'payment',
        'payment-2',
        '1.4.2',
        notice,
        'WARN',
        'provider status: payments.example.com opened incident PSP-7781 "elevated latency for some API requests in eu"',
        { 'event.name': 'provider.status', 'provider.incident': 'PSP-7781' },
      );
  },
};
