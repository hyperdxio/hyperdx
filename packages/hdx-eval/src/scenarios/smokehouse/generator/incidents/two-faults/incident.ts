import { dependencyCascade } from '../dependency-cascade/incident';
import type { Incident } from '../index';
import { segmentRegression } from '../segment-regression/incident';

// Two unrelated faults a few minutes apart, so no single origin explains the alert.
const PRICING_LAG_MS = 4 * 60_000;

export const twoFaults: Incident = {
  name: 'two-faults',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    return segmentRegression.apply(
      t,
      new Date(onset.getTime() + PRICING_LAG_MS),
      dependencyCascade.apply(t, onset, world),
    );
  },
  events(t, onset, stepMs) {
    segmentRegression.events!(
      t,
      new Date(onset.getTime() + PRICING_LAG_MS),
      stepMs,
    );
  },
};
