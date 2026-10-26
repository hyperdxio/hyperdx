import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  MOBILE_NEW = '2.9.0';
const LOAD_STEP_MS = 7_000,
  MOBILE_LEAD_MS = 22 * 60_000;
const loadedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * LOAD_STEP_MS;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() - MOBILE_LEAD_MS + (i - 1) * 30_000;

// The risk team publishes a ruleset whose new rule reads the device fingerprint, which only the
// mobile apps send. fraud hot-loads it, and every web checkout throws in the rules engine.
export const fraudRulePublish: Incident = {
  name: 'fraud-rule-publish',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world['mobile-bff'].versions[`mobile-bff-${i}`] = MOBILE_NEW;
    const loaded = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= loadedAt(i, onset))
        .map(i => `fraud-${i}`),
    );
    if (loaded.size === 0) return world;
    world.fraud.failIf = ctx =>
      !loaded.has(ctx.pod) || ctx.attrs.platform !== 'web'
        ? null
        : {
            status: 500,
            message:
              'RuleEvalError: rule R-2207 (device_velocity_v2): field device.fingerprint is undefined',
            durationMs: ctx.rng.gauss(6, 2),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'RuleEvalError: rule R-2207 (device_velocity_v2): field device.fingerprint is undefined\n    at evaluate (/app/fraud/rules/engine.js:144:15)\n    at score (/app/fraud/score.js:37:20)',
            },
          };
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
      const load = loadedAt(i, onset);
      if (crossed(t, stepMs, load))
        emitLog(
          'fraud',
          `fraud-${i}`,
          OLD,
          load,
          'INFO',
          `rules engine on fraud-${i} hot-loaded risk-rules v203 published by risk-ops (RISK-640): 412 rules, 3 added, 1 changed`,
          { 'event.name': 'rules.loaded', 'rules.version': 'v203' },
        );
    }
  },
};
