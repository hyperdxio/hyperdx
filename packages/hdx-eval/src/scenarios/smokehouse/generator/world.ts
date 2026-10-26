import type { Rng } from './rng';
import { pods, SERVICES } from './topology';

// durationMs is for failures that wait on something first (a lock, a remote reply); the default fails fast.
export type Failure = {
  status: number;
  message: string;
  log?: { severity: 'ERROR' | 'WARN'; body: string; every?: number };
  durationMs?: number;
};
export type RequestAttrs = {
  tenantId: string;
  tenantTier: 'free' | 'pro' | 'enterprise';
  platform: 'web' | 'ios' | 'android';
  region: string;
  promoCode?: string;
  cacheHit: boolean;
};
export type HopCtx = {
  t: Date;
  service: string;
  pod: string;
  route: string;
  attrs: RequestAttrs;
  rng: Rng;
};
export type Behaviour = {
  latencyMs: { mean: number; sd: number };
  storeLatencyMs: { mean: number; sd: number };
  errorRate: number;
  versions: Record<string, string>;
  timeoutMs: number;
  // Overrides latencyMs for single pods, as when some pods share a bad node.
  podLatencyMs?: Record<string, { mean: number; sd: number }>;
  // Overrides storeLatencyMs for one store by name, for services that read a cache in front of a database.
  storeLatencyByName?: Record<string, { mean: number; sd: number }>;
  // Extra attempts on a 5xx or timeout, keyed by callee service.
  retries?: Record<string, number>;
  failIf?: (ctx: HopCtx) => Failure | null;
  // Runs after each service callee returns without a 5xx, for faults the caller only hits once it has a reply.
  afterCall?: (
    ctx: HopCtx,
    callee: { service: string; op: string; pod: string; version: string },
  ) => Failure | null;
  // Extra time before a successful reply, for waits that differ per request, like a third party slow in one region.
  delayMs?: (ctx: HopCtx) => number;
};
export type World = Record<string, Behaviour>;

export const TENANTS: Array<[string, RequestAttrs['tenantTier']]> = [
  ['acme', 'enterprise'],
  ['globex', 'enterprise'],
  ['initech', 'pro'],
  ['umbrella', 'pro'],
  ['hooli', 'free'],
  ['vandelay', 'free'],
  ['wonka', 'free'],
  ['stark', 'pro'],
];
export const PROMO_CODES = [
  'SAVE10',
  'VIP20',
  'WELCOME15',
  'SPRING25',
  'FREESHIP',
  'FLAT5',
  'GIFT10',
];

// Base error rate is low on purpose: errors propagate to the gateway, and the alert
// threshold (25 per 5 minutes per service) has to sit above steady state there.
export function steadyState(): World {
  const world: World = {};
  for (const s of SERVICES) {
    world[s] = {
      latencyMs: { mean: 12, sd: 4 },
      storeLatencyMs: { mean: 6, sd: 3 },
      errorRate: 0.0002,
      versions: Object.fromEntries(pods(s).map(p => [p, '1.4.2'])),
      timeoutMs: 500,
    };
  }
  world['search'].storeLatencyMs = { mean: 40, sd: 15 };
  world['payment'].storeLatencyMs = { mean: 120, sd: 40 };
  world['payment'].timeoutMs = 2000;
  world['fraud'].latencyMs = { mean: 30, sd: 10 };
  world['email-worker'].latencyMs = { mean: 80, sd: 20 };
  return world;
}
