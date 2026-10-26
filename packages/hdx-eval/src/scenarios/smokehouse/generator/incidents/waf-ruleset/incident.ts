import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  MOBILE_NEW = '2.4.0';
const APPLY_STEP_MS = 20_000,
  MOBILE_LEAD_MS = 20 * 60_000;
const BLOCK_SHARE = 0.4;
const appliedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * APPLY_STEP_MS;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() - MOBILE_LEAD_MS + (i - 1) * 30_000;

// The security team turns on request body inspection at edge-gateway. One rule's regex backtracks
// on checkout's JSON bodies, so POST /checkout waits on inspection and part of it hits the 250 ms
// inspection timeout and is blocked before it is forwarded. GET routes carry no body and are untouched.
export const wafRuleset: Incident = {
  name: 'waf-ruleset',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world['mobile-bff'].versions[`mobile-bff-${i}`] = MOBILE_NEW;
    const on = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= appliedAt(i, onset))
        .map(i => `edge-gateway-${i}`),
    );
    if (on.size === 0) return world;
    const inspected = (ctx: { route: string; pod: string }) =>
      ctx.route === 'POST /checkout' && on.has(ctx.pod);
    world['edge-gateway'].failIf = ctx =>
      !inspected(ctx) || ctx.rng.next() >= BLOCK_SHARE
        ? null
        : {
            status: 503,
            message:
              'WAF inspection timeout: rule 942440 exceeded 250ms on request body, request blocked',
            durationMs: ctx.rng.gauss(262, 6),
            log: {
              severity: 'WARN',
              every: 3,
              body: `waf: rule 942440 (owasp-crs-4.7 PL2) hit the 250ms inspection timeout on POST /checkout body (${12 + Math.floor(ctx.rng.next() * 9)} KiB), blocking request`,
            },
          };
    world['edge-gateway'].delayMs = ctx =>
      inspected(ctx) ? Math.max(0, ctx.rng.gauss(170, 50)) : 0;
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = shippedAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'mobile-bff',
          `mobile-bff-${i}`,
          MOBILE_NEW,
          roll,
          'INFO',
          `deployment.rollout: mobile-bff-${i} updated ${OLD} -> ${MOBILE_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': MOBILE_NEW,
          },
        );
      const when = appliedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          OLD,
          when,
          'INFO',
          `config.change: waf ruleset owasp-crs-4.7 at paranoia level 2 with request body inspection applied on edge-gateway-${i} by security (SEC-2304), inspection timeout 250ms, fail closed`,
          { 'event.name': 'config.change', 'waf.ruleset': 'owasp-crs-4.7' },
        );
    }
  },
};
