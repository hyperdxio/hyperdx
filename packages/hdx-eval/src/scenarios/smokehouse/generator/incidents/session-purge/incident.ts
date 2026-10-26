import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  PROFILE_NEW = '1.5.1';
const USERS = 1214,
  CALL_MS = 6_000,
  BLOCK_MS = 900,
  PROGRESS_MS = 60_000,
  WAIT_MS = 30_000;
const ROLL_LEAD_MS = 20 * 60_000,
  ROLL_STEP_MS = 30_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// A forced logout for one tenant runs a KEYS pattern per user against the sessions Redis. Each KEYS
// walks the whole keyspace and blocks Redis for most of a second, so every auth.verify that lands in
// that window waits, and the ones that wait longest outlast the BFFs' 500 ms timeout.
export const sessionPurge: Incident = {
  name: 'session-purge',
  defaultOnsetMs: -16 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world['user-profile'].versions[`user-profile-${i}`] = PROFILE_NEW;
    const since = t.getTime() - onset.getTime();
    if (since < 0 || since >= USERS * CALL_MS) return world;
    const phase = since % CALL_MS;
    if (phase < BLOCK_MS)
      world.auth.storeLatencyMs = { mean: BLOCK_MS - phase + 6, sd: 4 };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'user-profile',
          `user-profile-${i}`,
          PROFILE_NEW,
          roll,
          'INFO',
          `deployment.rollout: user-profile-${i} updated ${OLD} -> ${PROFILE_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': PROFILE_NEW,
          },
        );
    }
    const at = onset.getTime(),
      attrs = {
        'event.name': 'auth.session_purge',
        'server.address': 'sessions',
      };
    if (crossed(t, stepMs, at))
      emitLog(
        'auth',
        'auth-2',
        OLD,
        at,
        'INFO',
        `session purge for tenant initech started on auth-2 by security (SECOPS-1207, forced logout after a credential stuffing report): ${USERS.toLocaleString('en-US')} users, matching each user's keys with KEYS session:initech:<user>:* then DEL`,
        attrs,
      );
    const progress = Math.floor(t.getTime() / PROGRESS_MS) * PROGRESS_MS;
    if (progress > at && crossed(t, stepMs, progress)) {
      const done = Math.min(USERS, Math.floor((progress - at) / CALL_MS));
      emitLog(
        'auth',
        'auth-2',
        OLD,
        progress,
        'INFO',
        `session purge initech on auth-2: ${done} of ${USERS.toLocaleString('en-US')} users, ${(done * 2.4).toFixed(0)} sessions deleted`,
        attrs,
      );
    }
    const wait = Math.floor(t.getTime() / WAIT_MS) * WAIT_MS;
    if (wait <= at || !crossed(t, stepMs, wait)) return;
    const n = wait / WAIT_MS,
      pod = `auth-${1 + (n % 6)}`;
    emitLog(
      'auth',
      pod,
      OLD,
      wait,
      'WARN',
      `redis sessions on ${pod}: ${4 + (n % 9)} commands waited over 250ms in the last 30s, longest ${820 + (n % 80)}ms`,
      { 'event.name': 'redis.slow_command', 'server.address': 'sessions' },
    );
  },
};
