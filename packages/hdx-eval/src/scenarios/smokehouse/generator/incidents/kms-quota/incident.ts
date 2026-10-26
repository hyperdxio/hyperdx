import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  REVIEW_NEW = '2.6.0';
const ENABLE_STEP_MS = 20_000,
  THROTTLED = 0.3,
  STATS_MS = 30_000;
const enabledAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * ENABLE_STEP_MS;
const reviewAt = (i: number, onset: Date) =>
  onset.getTime() - 5 * 60_000 + (i - 1) * 30_000;

// Field-level encryption on user-profile decrypts with KMS on every read, and KMS request quota is
// per account. user-profile retries its throttled calls and gets through; payment does not retry and fails.
export const kmsQuota: Incident = {
  name: 'kms-quota',
  defaultOnsetMs: -13 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= reviewAt(i, onset))
        world.review.versions[`review-${i}`] = REVIEW_NEW;
    const on = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= enabledAt(i, onset))
        .map(i => `user-profile-${i}`),
    );
    if (on.size === 0) return world;
    world['user-profile'].delayMs = ctx =>
      on.has(ctx.pod) ? Math.max(0, ctx.rng.gauss(35, 12)) : 0;
    world.payment.failIf = ctx =>
      ctx.rng.next() >= (THROTTLED * on.size) / 6
        ? null
        : {
            status: 503,
            message:
              'ThrottlingException: Rate exceeded (kms:Decrypt on alias/card-vault)',
            durationMs: ctx.rng.gauss(30, 8),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'ThrottlingException: Rate exceeded (kms:Decrypt on alias/card-vault)\n    at deserializeAws_json1_1DecryptCommandError (/app/node_modules/@aws-sdk/client-kms/dist-cjs/protocols/Aws_json1_1.js:1406:41)\n    at unwrapCardKey (/app/payment/vault.js:58:18)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = reviewAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'review',
          `review-${i}`,
          REVIEW_NEW,
          roll,
          'INFO',
          `deployment.rollout: review-${i} updated ${OLD} -> ${REVIEW_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': REVIEW_NEW,
          },
        );
      const when = enabledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'user-profile',
          `user-profile-${i}`,
          OLD,
          when,
          'INFO',
          `config.change: pii.field_encryption enabled on user-profile-${i} by security (SEC-2410): address, phone and date_of_birth decrypted on read with KMS key alias/pii-profile`,
          {
            'event.name': 'config.change',
            'config.key': 'pii.field_encryption',
          },
        );
    }
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    if (stat < enabledAt(1, onset) || !crossed(t, stepMs, stat)) return;
    const n = stat / STATS_MS,
      i = 1 + (n % 6);
    if (stat < enabledAt(i, onset)) return;
    emitLog(
      'user-profile',
      `user-profile-${i}`,
      OLD,
      stat,
      'INFO',
      `kms client on user-profile-${i}: ${1700 + (n % 300)} Decrypt calls in the last 30s, ${180 + (n % 90)} throttled and retried`,
      { 'event.name': 'kms.client.stats' },
    );
  },
};
