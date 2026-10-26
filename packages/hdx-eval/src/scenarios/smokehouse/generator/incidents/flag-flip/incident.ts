import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const FLAG = 'auth.sync_revocation_check';

// A runtime flag, not a build: versions never change, and the config.change log on each pod is
// the only record of the moment behaviour changed.
export const flagFlip: Incident = {
  name: 'flag-flip',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.auth.latencyMs = { mean: 110, sd: 30 };
    world.auth.failIf = ctx =>
      ctx.rng.next() >= 0.015
        ? null
        : {
            status: 500,
            message:
              'RevocationCheckError: revocation list fetch timed out after 150ms',
            log: {
              severity: 'ERROR',
              every: 4,
              body: `RevocationCheckError: revocation list fetch timed out after 150ms (${FLAG}=true)\n    at checkRevocation (/app/auth/revocation.js:61:13)\n    at verifyToken (/app/auth/verify.js:34:9)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() + (i - 1) * 1_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'auth',
          `auth-${i}`,
          '1.4.2',
          when,
          'INFO',
          `config.change: feature flag ${FLAG} changed false -> true on auth-${i} (source flagd, change CFG-2291)`,
          {
            'event.name': 'config.change',
            'flag.key': FLAG,
            'flag.from': 'false',
            'flag.to': 'true',
          },
        );
    }
  },
};
