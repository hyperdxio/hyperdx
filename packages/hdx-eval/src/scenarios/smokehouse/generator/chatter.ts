import { emitLog } from './emit';
import type { Rng } from './rng';
import { crossed } from './tick';
import { pods } from './topology';
import type { World } from './world';

export type ChatterPattern = {
  service: string;
  severity: 'INFO' | 'WARN';
  perMinute: number;
  body: (n: (lo: number, hi: number) => number, pod: string) => string;
};

// Routine logs from a healthy system. Without them the only pattern in a window is the
// planted one, and a detector for new or spiking patterns has nothing to tell apart.
export const CHATTER_PATTERNS: ChatterPattern[] = [
  {
    service: 'edge-gateway',
    severity: 'INFO',
    perMinute: 8,
    body: (n, pod) =>
      `upstream pool ${pod}: ${n(20, 60)} idle, ${n(0, 9)} pending`,
  },
  {
    service: 'web-bff',
    severity: 'INFO',
    perMinute: 5,
    body: (n, pod) =>
      `render cache ${pod}: ${n(70, 99)} percent hit over ${n(1000, 9000)} lookups`,
  },
  {
    service: 'mobile-bff',
    severity: 'WARN',
    perMinute: 2,
    body: (n, pod) =>
      `client sent an unsupported api-version header to ${pod} on ${n(1, 40)} requests`,
  },
  {
    service: 'auth',
    severity: 'INFO',
    perMinute: 6,
    body: (n, pod) =>
      `rotated the signing key on ${pod}, next rotation in ${n(20, 90)} minutes`,
  },
  {
    service: 'catalog',
    severity: 'INFO',
    perMinute: 4,
    body: (n, pod) => `warmed ${n(200, 900)} catalog entries on ${pod}`,
  },
  {
    service: 'search',
    severity: 'WARN',
    perMinute: 3,
    body: (n, pod) =>
      `slow query on ${pod} took ${n(400, 1200)}ms, above the 400ms budget`,
  },
  {
    service: 'cart',
    severity: 'INFO',
    perMinute: 5,
    body: (n, pod) => `evicted ${n(10, 300)} abandoned carts on ${pod}`,
  },
  {
    service: 'checkout',
    severity: 'INFO',
    perMinute: 4,
    body: (n, pod) =>
      `idempotency cache on ${pod} holds ${n(100, 900)} keys with ${n(1, 20)} collisions`,
  },
  {
    service: 'orders',
    severity: 'INFO',
    perMinute: 4,
    body: (n, pod) => `flushed ${n(5, 80)} order events from ${pod}`,
  },
  {
    service: 'inventory',
    severity: 'WARN',
    perMinute: 2,
    body: (n, pod) =>
      `reservation retried on ${pod} after ${n(1, 3)} conflicts`,
  },
  {
    service: 'payment',
    severity: 'INFO',
    perMinute: 3,
    body: (n, pod) =>
      `gateway heartbeat from ${pod} answered in ${n(20, 200)}ms`,
  },
  {
    service: 'fraud',
    severity: 'INFO',
    perMinute: 3,
    body: (n, pod) => `model scored ${n(50, 400)} requests on ${pod}`,
  },
  {
    service: 'notification',
    severity: 'INFO',
    perMinute: 4,
    body: (n, pod) => `delivered ${n(5, 60)} notifications from ${pod}`,
  },
  {
    service: 'email-worker',
    severity: 'INFO',
    perMinute: 3,
    body: (n, pod) =>
      `smtp pool ${pod} holds ${n(1, 8)} connections with ${n(0, 4)} queued`,
  },
];

const REINDEX_PERIOD_MS = 10 * 60_000;
const REINDEX_LINES = 40;

// Test seam: (service, pod, body) is the shape a test wants to assert on. Without an override,
// send goes to emitLog with the full version/severity/attrs a real log record needs.
type EmitBody = (service: string, pod: string, body: string) => void;

export function chatter(
  t: Date,
  stepMs: number,
  world: World,
  r: Rng,
  emit?: EmitBody,
): void {
  const n = (lo: number, hi: number) =>
    lo + Math.floor(r.next() * (hi - lo + 1));
  const version = (service: string, pod: string) =>
    world[service].versions[pod];
  const send = (
    service: string,
    pod: string,
    atMs: number,
    severity: 'INFO' | 'WARN',
    body: string,
    attrs: Record<string, string>,
  ) => {
    if (emit) emit(service, pod, body);
    else
      emitLog(service, pod, version(service, pod), atMs, severity, body, attrs);
  };
  for (const p of CHATTER_PATTERNS) {
    if (r.next() >= (p.perMinute * stepMs) / 60_000) continue;
    const pod = r.pick(pods(p.service));
    send(p.service, pod, t.getTime(), p.severity, p.body(n, pod), {
      'event.name': 'runtime.chatter',
    });
  }
  // Benign and periodic: a detector that takes the biggest mover in the window flags this,
  // one that compares against an hour of history does not.
  const period =
    Math.floor(t.getTime() / REINDEX_PERIOD_MS) * REINDEX_PERIOD_MS;
  if (!crossed(t, stepMs, period)) return;
  for (let i = 0; i < REINDEX_LINES; i++) {
    const pod = r.pick(pods('catalog'));
    send(
      'catalog',
      pod,
      period + i * 50,
      'INFO',
      `reindex batch ${i + 1} of ${REINDEX_LINES} on ${pod} covered ${n(500, 2000)} documents`,
      { 'event.name': 'catalog.reindex' },
    );
  }
}
