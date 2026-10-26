import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  PROFILE_NEW = '1.5.1';
const TTL_LEAD_MS = 70 * 60_000,
  MEMORY_LEAD_MS = 60 * 60_000,
  MEMORY_MS = 5 * 60_000;
const PROFILE_LEAD_MS = 4 * 60_000,
  TOUCH_FAIL_SHARE = 0.2;
const profileAt = (i: number, onset: Date) =>
  onset.getTime() - PROFILE_LEAD_MS + (i - 1) * 20_000;
// GiB in use on the sessions Redis: climbing since remember-me sessions stopped expiring after a day.
const usedGiB = (t: number, onset: Date) =>
  Math.min(
    4,
    2.6 + (1.4 * (t - (onset.getTime() - MEMORY_LEAD_MS))) / MEMORY_LEAD_MS,
  );

// Remember-me sessions now live 30 days, so the sessions Redis fills until it reaches maxmemory. It runs
// noeviction, so reads still work but auth's session touch on verify is refused for a share of requests.
export const sessionsMaxmemory: Incident = {
  name: 'sessions-maxmemory',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= profileAt(i, onset))
        world['user-profile'].versions[`user-profile-${i}`] = PROFILE_NEW;
    if (t < onset) return world;
    world.auth.failIf = ctx =>
      ctx.rng.next() >= TOUCH_FAIL_SHARE
        ? null
        : {
            status: 500,
            message:
              "ReplyError: OOM command not allowed when used memory > 'maxmemory'.",
            log: {
              severity: 'ERROR',
              every: 4,
              body: "ReplyError: OOM command not allowed when used memory > 'maxmemory'.\n    at parseError (/app/node_modules/redis-parser/lib/parser.js:179:12)\n    at touchSession (/app/auth/session.js:58:17)",
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const ttl = onset.getTime() - TTL_LEAD_MS + i * 3000;
      if (crossed(t, stepMs, ttl))
        emitLog(
          'auth',
          `auth-${i}`,
          OLD,
          ttl,
          'INFO',
          `config.change: session ttl for remember_me logins 24h -> 30d on auth-${i} (AUTH-512)`,
          { 'event.name': 'config.change' },
        );
      const roll = profileAt(i, onset);
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
    const first = onset.getTime() - MEMORY_LEAD_MS;
    const when =
      first + Math.floor((t.getTime() - first) / MEMORY_MS) * MEMORY_MS;
    if (when < first || !crossed(t, stepMs, when)) return;
    const used = usedGiB(when, onset);
    emitLog(
      'auth',
      'auth-1',
      OLD,
      when,
      'WARN',
      `sessions redis: used_memory ${used.toFixed(2)} GiB of maxmemory 4 GiB (${Math.round((used / 4) * 100)}%), maxmemory-policy noeviction, ${Math.round(used * 1_150_000).toLocaleString('en-US')} keys`,
      { 'event.name': 'redis.memory', 'server.address': 'sessions' },
    );
  },
};
