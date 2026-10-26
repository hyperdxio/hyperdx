import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Behaviour } from '../../world';
import type { Incident } from '../index';

const OLD = '1.4.2';
const APPLY_LEAD_MS = 30_000,
  RAMP_MS = 4 * 60_000,
  MAX_SHARE = 0.12,
  EJECT_MS = 20_000,
  YELLOW_LEAD_MS = 8 * 60_000;
const CALLERS = ['web-bff', 'mobile-bff', 'search'];
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// A mesh policy for catalog ejects a pod after a single 5xx, for 30 seconds, with no cap on how many.
// Callers' sidecars keep finding no catalog pod to send to and answer 503 themselves; catalog never sees those requests.
export const outlierEjection: Incident = {
  name: 'outlier-ejection',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    const f = ramp(t, onset);
    if (f === 0) return world;
    const noUpstream: Behaviour['afterCall'] = (ctx, callee) =>
      callee.service !== 'catalog' || ctx.rng.next() >= MAX_SHARE * f
        ? null
        : {
            status: 503,
            message:
              'upstream connect error or disconnect/reset before headers. reset reason: no healthy upstream (outbound|8080||catalog.shop.svc.cluster.local)',
            durationMs: ctx.rng.gauss(2, 1),
          };
    for (const s of CALLERS) world[s].afterCall = noUpstream;
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = onset.getTime() - APPLY_LEAD_MS + i * 5000;
      if (crossed(t, stepMs, when))
        emitLog(
          'catalog',
          `catalog-${i}`,
          OLD,
          when,
          'INFO',
          'config.change: mesh DestinationRule catalog updated by platform (PLAT-6302): outlierDetection consecutive5xxErrors 50 -> 1, baseEjectionTime 30s, maxEjectionPercent 100',
          { 'event.name': 'mesh.config' },
        );
    }
    const eject = Math.floor(t.getTime() / EJECT_MS) * EJECT_MS;
    if (ramp(new Date(eject), onset) > 0 && crossed(t, stepMs, eject)) {
      const n = eject / EJECT_MS,
        caller = CALLERS[n % 3],
        pod = `${caller}-${1 + (n % 6)}`;
      emitLog(
        caller,
        pod,
        OLD,
        eject,
        'WARN',
        `envoy on ${pod}: outlier detection ejected catalog-${1 + ((n * 5) % 6)} from outbound|8080||catalog.shop.svc.cluster.local for 30s (consecutive 5xx: 1), ${2 + (n % 5)} of 6 hosts ejected`,
        { 'event.name': 'envoy.outlier' },
      );
    }
    // Unrelated: a replica shard on the search cluster is unassigned while one data node restarts.
    const start = onset.getTime() - YELLOW_LEAD_MS;
    const yellow = start + Math.floor((t.getTime() - start) / 45_000) * 45_000;
    if (yellow >= start && crossed(t, stepMs, yellow))
      emitLog(
        'search',
        `search-${1 + (((yellow - start) / 45_000) % 6)}`,
        OLD,
        yellow,
        'WARN',
        'elasticsearch cluster health yellow on catalog-index: 1 unassigned replica shard while node es-data-2 restarts',
        { 'event.name': 'es.health' },
      );
  },
};
