import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 4 * 60_000;
const SLOW = { mean: 360, sd: 240 };
const REPORT_MS = 15_000;
const DIGEST_LEAD_MS = 6 * 60_000,
  DIGEST_PROGRESS_MS = 30_000,
  DIGEST_TOTAL = 312_000;
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// The SMS provider notification sends order confirmations through slows down. notify.order is
// optional, but checkout waits up to its 500 ms timeout for it, which pushes checkout past the BFFs' own 500 ms.
export const smsProviderSlow: Incident = {
  name: 'sms-provider-slow',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.notification.latencyMs = {
      mean: 12 + (SLOW.mean - 12) * f,
      sd: 4 + (SLOW.sd - 4) * f,
    };
    return world;
  },
  events(t, onset, stepMs) {
    // The weekly digest is scheduled and unrelated: email-worker is off the request path.
    const digest = onset.getTime() - DIGEST_LEAD_MS,
      attrs = { 'event.name': 'cron.weekly_digest' };
    if (crossed(t, stepMs, digest))
      emitLog(
        'email-worker',
        'email-worker-2',
        OLD,
        digest,
        'INFO',
        `cron weekly-digest started on email-worker-2: ${DIGEST_TOTAL.toLocaleString('en-US')} recipients, batch 500, concurrency 20`,
        attrs,
      );
    const step =
      Math.floor(t.getTime() / DIGEST_PROGRESS_MS) * DIGEST_PROGRESS_MS;
    if (step > digest && crossed(t, stepMs, step)) {
      const sent = Math.min(
        DIGEST_TOTAL,
        Math.floor((step - digest) / 1000) * 260,
      );
      emitLog(
        'email-worker',
        'email-worker-2',
        OLD,
        step,
        'INFO',
        `weekly-digest batch progress: ${sent.toLocaleString('en-US')} of ${DIGEST_TOTAL.toLocaleString('en-US')} sent`,
        attrs,
      );
    }
    const f = ramp(t, onset);
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (ramp(new Date(when), onset) < 0.25 || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS,
      pod = `notification-${1 + (n % 6)}`;
    emitLog(
      'notification',
      pod,
      OLD,
      when,
      'WARN',
      `sms send via sms.example.com slow on ${pod}: POST /2010-04-01/Messages p99 ${Math.round(300 + 600 * f + (n % 7) * 40)}ms over the last 15s, ${10 + (n % 9)} order confirmations above the 300ms budget`,
      { 'event.name': 'sms.send.slow', 'server.address': 'sms.example.com' },
    );
  },
};
