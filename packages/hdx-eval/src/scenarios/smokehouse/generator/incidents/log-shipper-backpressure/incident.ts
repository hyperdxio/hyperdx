import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  RECO_NEW = '2.0.1';
const RELOAD_STEP_MS = 15_000,
  RETRY_MS = 15_000,
  REJECT_SHARE = 0.12;
const ROLL_LEAD_MS = 20 * 60_000,
  ROLL_STEP_MS = 45_000;
const reloadAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * RELOAD_STEP_MS;
// Each pod's 5 MB buffer fills at its own rate, depending on how much traffic it logged.
const pausedAt = (i: number, onset: Date) =>
  reloadAt(i, onset) + (150 + ((i * 47) % 120)) * 1000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;
const paused = (t: Date, onset: Date) =>
  new Set(
    [1, 2, 3, 4, 5, 6]
      .filter(i => t.getTime() >= pausedAt(i, onset))
      .map(i => `edge-gateway-${i}`),
  );

// The observability team points the gateway's fluent-bit sidecar at a new collector that throttles it.
// Retries fill the sidecar's buffer, it stops reading the access log fifo, and the gateway's workers
// block writing each request's log line: slower on every route, then out of worker connections.
export const logShipperBackpressure: Incident = {
  name: 'log-shipper-backpressure',
  defaultOnsetMs: -13 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.recommendation.versions[`recommendation-${i}`] = RECO_NEW;
    const on = paused(t, onset);
    if (on.size === 0) return world;
    world['edge-gateway'].delayMs = ctx =>
      on.has(ctx.pod) ? Math.max(0, ctx.rng.gauss(240, 90)) : 0;
    world['edge-gateway'].failIf = ctx =>
      !on.has(ctx.pod) || ctx.rng.next() >= REJECT_SHARE
        ? null
        : {
            status: 503,
            message:
              '503 Service Unavailable: 1024 worker_connections are not enough',
            durationMs: ctx.rng.gauss(3, 1),
            log: {
              severity: 'ERROR',
              every: 4,
              body: `[alert] 1024 worker_connections are not enough while connecting to upstream on ${ctx.pod}, request: "${ctx.route} HTTP/1.1"`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'recommendation',
          `recommendation-${i}`,
          RECO_NEW,
          roll,
          'INFO',
          `deployment.rollout: recommendation-${i} updated ${OLD} -> ${RECO_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': RECO_NEW,
          },
        );
      const reload = reloadAt(i, onset);
      if (crossed(t, stepMs, reload))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          OLD,
          reload,
          'INFO',
          `fluent-bit[edge-gateway-${i}]: hot reload complete, output loki.logging:3100 replaced by opentelemetry otel-gw.observability:4318 (OBS-918)`,
          {
            'event.name': 'fluentbit.reload',
            'k8s.container.name': 'fluent-bit',
          },
        );
      const pause = pausedAt(i, onset);
      if (crossed(t, stepMs, pause))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          OLD,
          pause,
          'WARN',
          `fluent-bit[edge-gateway-${i}]: [input:tail] paused (mem buf overlimit 5.0M), not reading /var/log/gateway/access.fifo`,
          {
            'event.name': 'fluentbit.input_paused',
            'k8s.container.name': 'fluent-bit',
          },
        );
    }
    const when = Math.floor(t.getTime() / RETRY_MS) * RETRY_MS;
    if (when < reloadAt(1, onset) || !crossed(t, stepMs, when)) return;
    const n = when / RETRY_MS,
      i = 1 + (n % 6);
    if (when < reloadAt(i, onset)) return;
    emitLog(
      'edge-gateway',
      `edge-gateway-${i}`,
      OLD,
      when,
      'WARN',
      `fluent-bit[edge-gateway-${i}]: [output:opentelemetry] chunk retry in ${2 + (n % 9)}s: HTTP 429 Too Many Requests from otel-gw.observability:4318`,
      { 'event.name': 'fluentbit.retry', 'k8s.container.name': 'fluent-bit' },
    );
  },
};
