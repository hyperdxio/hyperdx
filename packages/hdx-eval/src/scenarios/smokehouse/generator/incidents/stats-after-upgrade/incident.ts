import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  REVIEW_NEW = '2.2.0';
const SLOW = { mean: 430, sd: 220 };
// autovacuum analyzes users once enough rows change, long after the anchor.
const ANALYZED_MS = 40 * 60_000;
const SLOW_LOG_MS = 20_000;
const REVIEW_LEAD_MS = 9 * 60_000;
const slowNow = (t: Date, onset: Date) =>
  t >= onset && t.getTime() < onset.getTime() + ANALYZED_MS;

// The DBA team upgrades users-db from PostgreSQL 14 to 16 by blue/green switchover. pg_upgrade does
// not carry planner statistics, so until users is analyzed the profile lookup plans a sequential scan.
export const statsAfterUpgrade: Incident = {
  name: 'stats-after-upgrade',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= onset.getTime() - REVIEW_LEAD_MS + (i - 1) * 20_000)
        world.review.versions[`review-${i}`] = REVIEW_NEW;
    if (slowNow(t, onset)) world['user-profile'].storeLatencyMs = SLOW;
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    for (let i = 1; i <= 6; i++) {
      const roll = at - REVIEW_LEAD_MS + (i - 1) * 20_000;
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
      const reconnect = at + 2_000 + i * 700;
      if (crossed(t, stepMs, reconnect))
        emitLog(
          'user-profile',
          `user-profile-${i}`,
          OLD,
          reconnect,
          'INFO',
          `db.connection: pool users-db re-established on user-profile-${i} after blue/green switchover (DBA-3410 by data-platform), server_version 14.11 -> 16.4`,
          { 'event.name': 'db.connection.reset', 'server.address': 'users-db' },
        );
    }
    const when = Math.floor(t.getTime() / SLOW_LOG_MS) * SLOW_LOG_MS;
    if (!slowNow(new Date(when), onset) || !crossed(t, stepMs, when)) return;
    const n = when / SLOW_LOG_MS,
      pod = `user-profile-${1 + (n % 6)}`;
    emitLog(
      'user-profile',
      pod,
      OLD,
      when,
      'WARN',
      `slow query on ${pod}: SELECT u.*, p.prefs FROM users u JOIN user_preferences p ON p.user_id = u.id WHERE u.tenant_id = $1 AND u.id = $2 took ${520 + ((n * 37) % 600)}ms, ${18 + (n % 25)} statements over 250ms in the last 20s (users-db)`,
      { 'event.name': 'db.slow_statement', 'server.address': 'users-db' },
    );
  },
};
