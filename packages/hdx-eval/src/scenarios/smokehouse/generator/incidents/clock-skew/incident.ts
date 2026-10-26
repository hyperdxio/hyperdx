import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NODE = 'ip-10-0-7-42.ec2.internal';
const ON_NODE = ['payment-2', 'payment-4'];
// fraud-3 shares the node but signs nothing, so it stays healthy.
const BYSTANDER = 'fraud-3';
const DRIFT_S_PER_MIN = 4.5,
  TOLERANCE_S = 300,
  WARN_S = 120;
const WARN_EVERY_MS = 30_000;
const NOTICE_MS = 64 * 60_000;
const nodeAttrs = { 'host.name': NODE, 'k8s.node.name': NODE };

const skewS = (t: Date, onset: Date) =>
  Math.max(0, (DRIFT_S_PER_MIN * (t.getTime() - onset.getTime())) / 60_000);

// chronyd dies on one node and its clock runs fast. payment signs each charge with a timestamp,
// and once the skew passes the provider's 300 s tolerance every charge from the two payment pods
// on that node is rejected. The provider posts an unrelated maintenance notice meanwhile.
export const clockSkew: Incident = {
  name: 'clock-skew',
  defaultOnsetMs: -80 * 60_000,
  apply(t, onset, world) {
    const skew = Math.round(skewS(t, onset));
    if (skew <= TOLERANCE_S) return world;
    const stamp = new Date(t.getTime() + skew * 1000).toISOString();
    world.payment.failIf = ctx =>
      !ON_NODE.includes(ctx.pod)
        ? null
        : {
            status: 502,
            message:
              'ProviderAuthError: payments.example.com returned 401 timestamp_out_of_tolerance',
            durationMs: ctx.rng.gauss(130, 30),
            log: {
              severity: 'ERROR',
              every: 2,
              body: `ProviderAuthError: payments.example.com returned 401 timestamp_out_of_tolerance: X-Request-Timestamp ${stamp} differs from server time by ${skew}s (tolerance ${TOLERANCE_S}s)\n    at ProviderClient.charge (/app/payment/provider.js:88:15)\n    at chargeCard (/app/payment/charge.js:40:11)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at)) {
      for (const pod of [...ON_NODE, BYSTANDER])
        emitLog(
          pod.replace(/-\d$/, ''),
          pod,
          '1.4.2',
          at,
          'WARN',
          `node.log: ${NODE} chronyd.service: Main process exited, code=killed, status=9/KILL (oom-kill); unit not restarted, system clock unsynchronised`,
          { 'event.name': 'node.log', ...nodeAttrs },
        );
    }
    const notice = at + NOTICE_MS;
    if (crossed(t, stepMs, notice))
      emitLog(
        'payment',
        'payment-1',
        '1.4.2',
        notice,
        'INFO',
        'provider notice from payments.example.com: scheduled maintenance MNT-7731 on the payouts API starts now, expected duration 45 minutes',
        {
          'event.name': 'provider.notice',
          'server.address': 'payments.example.com',
        },
      );
    const when = Math.floor(t.getTime() / WARN_EVERY_MS) * WARN_EVERY_MS;
    const skew = Math.round(skewS(new Date(when), onset));
    if (skew < WARN_S || skew > TOLERANCE_S || !crossed(t, stepMs, when))
      return;
    const pod = ON_NODE[(when / WARN_EVERY_MS) % 2];
    emitLog(
      'payment',
      pod,
      '1.4.2',
      when,
      'WARN',
      `payments.example.com response header on ${pod}: Warning: 299 - "request timestamp is ${skew}s ahead of server time; requests beyond ${TOLERANCE_S}s will be rejected"`,
      {
        'event.name': 'provider.warning',
        'server.address': 'payments.example.com',
      },
    );
  },
};
