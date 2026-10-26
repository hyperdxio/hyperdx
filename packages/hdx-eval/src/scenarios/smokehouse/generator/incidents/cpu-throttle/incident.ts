import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const EVICT_STEP_MS = 2 * 60_000;
const STATS_MS = 60_000;
// CFS throttling stalls a scoring call for whole 100 ms periods, so the tail is long.
const THROTTLED = { mean: 220, sd: 200 };
// Services the same VPA change resized. review and notification are light and keep headroom.
const RESIZED: Array<[string, string, string]> = [
  ['fraud', '1000m/2000m', '250m/500m'],
  ['review', '500m/1000m', '200m/400m'],
  ['notification', '500m/1000m', '150m/300m'],
];
const evictedAt = (i: number, onset: Date, offsetMs = 0) =>
  onset.getTime() + offsetMs + (i - 1) * EVICT_STEP_MS;

// The platform team turns on VPA auto mode for the namespace. It recreates fraud's pods one by one
// with a quarter of their CPU, and model scoring is throttled past checkout's 500 ms timeout.
export const cpuThrottle: Incident = {
  name: 'cpu-throttle',
  defaultOnsetMs: -24 * 60_000,
  apply(t, onset, world) {
    const podLatencyMs: Record<string, { mean: number; sd: number }> = {};
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= evictedAt(i, onset))
        podLatencyMs[`fraud-${i}`] = THROTTLED;
    if (Object.keys(podLatencyMs).length)
      world.fraud.podLatencyMs = podLatencyMs;
    return world;
  },
  events(t, onset, stepMs) {
    const change = onset.getTime() - 60_000;
    if (crossed(t, stepMs, change))
      emitLog(
        'fraud',
        'fraud-1',
        OLD,
        change,
        'INFO',
        'config.change: VerticalPodAutoscaler for namespace shop set updateMode Off -> Auto for fraud, review, notification (change PLAT-4127 by platform, "cost programme: right-size requests")',
        { 'event.name': 'config.change', 'config.key': 'vpa.updateMode' },
      );
    RESIZED.forEach(([service, from, to], k) => {
      for (let i = 1; i <= 6; i++) {
        const when = evictedAt(i, onset, k * 20_000);
        if (crossed(t, stepMs, when))
          emitLog(
            service,
            `${service}-${i}`,
            OLD,
            when,
            'INFO',
            `k8s.event: pod ${service}-${i} evicted by vpa-updater and recreated, cpu request/limit ${from} -> ${to}`,
            {
              'event.name': 'k8s.pod.evicted',
              'k8s.pod.name': `${service}-${i}`,
            },
          );
      }
    });
    // Emitted before onset too, so the unthrottled baseline is there to compare against.
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    for (let i = 1; i <= 6; i++) {
      const when = stat + i * 1_000;
      if (!crossed(t, stepMs, when)) continue;
      const hit = when >= evictedAt(i, onset),
        n = (when / STATS_MS) % 9;
      emitLog(
        'fraud',
        `fraud-${i}`,
        OLD,
        when,
        hit ? 'WARN' : 'INFO',
        `runtime stats on fraud-${i}: cpu limit ${hit ? 500 : 2000}m, throttled in ${hit ? 58 + n * 3 : n % 2} percent of cfs periods, model scoring p99 ${hit ? 610 + n * 20 : 48 + n}ms`,
        { 'event.name': 'runtime.stats' },
      );
    }
  },
};
