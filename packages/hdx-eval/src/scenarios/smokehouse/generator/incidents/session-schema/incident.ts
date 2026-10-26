import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NEW = '2.1.0',
  OLD = '1.4.2';
const ROLL_STEP_MS = 30_000;
// Share of requests whose session user-profile 2.1.0 has rewritten; it grows as users load their profile.
const MAX_SHARE = 0.15,
  TAU_MS = 12 * 60_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * ROLL_STEP_MS;
const rewritten = (t: Date, onset: Date) =>
  t < onset
    ? 0
    : MAX_SHARE * (1 - Math.exp(-(t.getTime() - onset.getTime()) / TAU_MS));

// user-profile 2.1.0 writes a new field into session records in the shared sessions Redis.
// auth decodes sessions against a strict schema and fails every request whose session was
// rewritten. user-profile itself stays healthy, and auth did not change.
export const sessionSchema: Incident = {
  name: 'session-schema',
  defaultOnsetMs: -16 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world['user-profile'].versions[`user-profile-${i}`] = NEW;
    const share = rewritten(t, onset);
    if (share === 0) return world;
    world.auth.failIf = ctx =>
      ctx.rng.next() >= share
        ? null
        : {
            status: 500,
            message:
              "SessionDecodeError: ZodError: Unrecognized key(s) in object: 'display_prefs'",
            log: {
              severity: 'ERROR',
              every: 3,
              body: "SessionDecodeError: session record failed schema check\n    ZodError: Unrecognized key(s) in object: 'display_prefs'\n    record keys: uid, tenant, roles, exp, display_prefs\n    at decodeSession (/app/auth/session.js:33:28)\n    at verify (/app/auth/verify.js:21:19)",
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (!crossed(t, stepMs, when)) continue;
      emitLog(
        'user-profile',
        `user-profile-${i}`,
        NEW,
        when,
        'INFO',
        `deployment.rollout: user-profile-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
        {
          'event.name': 'deployment.rollout',
          'deployment.from': OLD,
          'deployment.to': NEW,
        },
      );
      emitLog(
        'user-profile',
        `user-profile-${i}`,
        NEW,
        when + 1_500,
        'INFO',
        `session enrichment enabled on user-profile-${i}: writing display_prefs to session records on profile load (redis sessions)`,
        { 'event.name': 'feature.enabled' },
      );
    }
  },
};
