import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const TENANT = 'globex';
const RULES = 212_480;
// One globex cache miss reaches each pod every thirteen seconds or so, and each one blocks its event loop.
const SLOT_MS = 13_000;

// Deterministic per pod and slot, so apply and events agree on when a pod is blocked.
function block(pod: number, slot: number): { start: number; ms: number } {
  let h = Math.imul(pod * 7919 + slot, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return { start: slot * SLOT_MS + (h % 9_000), ms: 1_500 + ((h >>> 8) % 800) };
}
function blockedAt(
  pod: number,
  t: number,
  onset: Date,
): { start: number; ms: number } | null {
  const b = block(pod, Math.floor(t / SLOT_MS));
  return b.start >= onset.getTime() && t >= b.start && t < b.start + b.ms
    ? b
    : null;
}

// globex republished a price list twenty times larger. pricing compiles a tenant's rules
// synchronously on a cache miss, and the result is too big to cache, so every globex miss blocks
// the pod's event loop and stalls whatever else that pod is serving.
export const eventLoopBlock: Incident = {
  name: 'event-loop-block',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    const podLatencyMs: Record<string, { mean: number; sd: number }> = {};
    for (let i = 1; i <= 6; i++) {
      const b = blockedAt(i, t.getTime(), onset);
      // The walker spends about five sixths of mean latency in the handler, so scale to end with the block.
      if (b)
        podLatencyMs[`pricing-${i}`] = {
          mean: 12 + 1.2 * (b.start + b.ms - t.getTime()),
          sd: 5,
        };
    }
    if (Object.keys(podLatencyMs).length)
      world.pricing.podLatencyMs = podLatencyMs;
    return world;
  },
  events(t, onset, stepMs) {
    if (crossed(t, stepMs, onset.getTime()))
      emitLog(
        'pricing',
        'pricing-1',
        '1.4.2',
        onset.getTime(),
        'INFO',
        `price list import for tenant ${TENANT}: ${RULES} rules published (previously 9,120), source catalog-admin, change PL-8812`,
        { 'event.name': 'pricing.import', 'tenant.id': TENANT },
      );
    for (let i = 1; i <= 6; i++) {
      const b = block(i, Math.floor(t.getTime() / SLOT_MS));
      if (b.start < onset.getTime() || !crossed(t, stepMs, b.start)) continue;
      const pod = `pricing-${i}`;
      emitLog(
        'pricing',
        pod,
        '1.4.2',
        b.start,
        'WARN',
        `compiled price rules for tenant ${TENANT} on ${pod}: ${RULES} rules in ${b.ms}ms (synchronous); compiled set 38.4 MiB exceeds rule-cache max entry 8 MiB, not cached`,
        { 'event.name': 'pricing.rules.compile', 'tenant.id': TENANT },
      );
      emitLog(
        'pricing',
        pod,
        '1.4.2',
        b.start + b.ms,
        'WARN',
        `event loop blocked for ${b.ms}ms on ${pod}, ${3 + (b.ms % 11)} requests delayed`,
        { 'event.name': 'runtime.event_loop_lag' },
      );
    }
  },
};
