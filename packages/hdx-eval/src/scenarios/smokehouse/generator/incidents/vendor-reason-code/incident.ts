import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 20 * 60_000,
  MAX_SHARE = 0.3;
const FIELD_LEAD_MS = 25 * 60_000,
  FIELD_EVERY_MS = 10 * 60_000;
const CRON_EVERY_MS = 60 * 60_000,
  CRON_LEAD_MS = 3 * 60_000,
  CRON_RUN_MS = 2 * 60_000 + 4_000;
const share = (t: Date, onset: Date) =>
  t < onset
    ? 0
    : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS) * MAX_SHARE;

// The device-intelligence vendor fraud calls inline starts returning a new reason code, DI-417, on a
// growing share of responses. fraud maps reason codes through a closed table and throws on one it has
// never seen. The vendor's new response field showed up first and fraud only warned about it.
export const vendorReasonCode: Incident = {
  name: 'vendor-reason-code',
  defaultOnsetMs: -16 * 60_000,
  apply(t, onset, world) {
    const s = share(t, onset);
    if (s === 0) return world;
    world.fraud.failIf = ctx =>
      ctx.rng.next() >= s
        ? null
        : {
            status: 500,
            message:
              'UnmappedReasonCodeError: deviceintel.example.com returned reason_code "DI-417" not in reason map v12',
            durationMs: ctx.rng.gauss(42, 10),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'UnmappedReasonCodeError: deviceintel.example.com returned reason_code "DI-417" not in reason map v12\n    at mapReason (/app/fraud/vendors/deviceintel.js:77:11)\n    at Array.map (<anonymous>)\n    at scoreSignals (/app/fraud/score.js:58:34)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const first = onset.getTime() - FIELD_LEAD_MS + i * 20_000;
      if (t.getTime() < first) continue;
      const when =
        first +
        Math.floor((t.getTime() - first) / FIELD_EVERY_MS) * FIELD_EVERY_MS;
      if (crossed(t, stepMs, when))
        emitLog(
          'fraud',
          `fraud-${i}`,
          OLD,
          when,
          'WARN',
          `deviceintel.example.com response on fraud-${i} has unrecognised field signals.emulator_score (x-di-schema 2026-09-15); ignoring it`,
          { 'event.name': 'vendor.response.unknown_field' },
        );
    }
    // An hourly job that refreshes fraud's local feature cache, unrelated to the vendor.
    const start = onset.getTime() - CRON_LEAD_MS;
    const run =
        start +
        Math.floor((t.getTime() - start) / CRON_EVERY_MS) * CRON_EVERY_MS,
      attrs = { 'event.name': 'cron.job', 'job.name': 'risk-feature-cache' };
    if (crossed(t, stepMs, run))
      emitLog(
        'fraud',
        'fraud-3',
        OLD,
        run,
        'INFO',
        'cron: risk-feature-cache started on fraud-3, reading device and account features from feature-store',
        attrs,
      );
    if (crossed(t, stepMs, run + CRON_RUN_MS))
      emitLog(
        'fraud',
        'fraud-3',
        OLD,
        run + CRON_RUN_MS,
        'INFO',
        `cron: risk-feature-cache finished on fraud-3 in 2m04s, ${1_204_000 + ((run / CRON_EVERY_MS) % 900)} features loaded`,
        attrs,
      );
  },
};
