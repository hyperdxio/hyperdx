import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import { TENANTS } from '../../world';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 25 * 60_000,
  PEAK_EXTRA = 0.14,
  CAPACITY = 0.3,
  HPA_MS = 30_000;
const SITEMAP_START_MS = 3 * 60_000,
  SITEMAP_RUN_MS = 6 * 60_000 + 40_000;
const load = (t: number, onset: Date) =>
  t < onset.getTime() ? 0 : Math.min(1, (t - onset.getTime()) / RAMP_MS);
// Six pods carry the evening peak until about a third of the way up; past that only scaling would help.
const over = (f: number) => Math.max(0, (f - CAPACITY) / (1 - CAPACITY));

// The evening peak arrives as it does every day, but search's HPA cannot add pods: the subnet its
// nodes draw pod IPs from has none left, taken by another team's batch node group. The six pods
// saturate on their own work while search's stores and callees stay flat.
export const subnetExhaustion: Incident = {
  name: 'subnet-exhaustion',
  defaultOnsetMs: -20 * 60_000,
  apply(t, onset, world) {
    const o = over(load(t.getTime(), onset));
    if (o === 0) return world;
    world.search.latencyMs = { mean: 12 + 550 * o, sd: 4 + 180 * o };
    world.search.failIf = ctx =>
      ctx.rng.next() >= 0.06 * o
        ? null
        : {
            status: 503,
            message:
              '503 Service Unavailable: search concurrency limit reached (64 in flight)',
            log: {
              severity: 'WARN',
              every: 4,
              body: `search concurrency limit reached on ${ctx.pod}: 64 in flight, rejecting`,
            },
          };
    return world;
  },
  surge(t, onset) {
    const f = load(t.getTime(), onset);
    if (f === 0) return null;
    const s = Math.floor(t.getTime() / 1000);
    return {
      forced: {
        route: 'GET /search',
        bff: s % 5 < 3 ? 'web-bff' : 'mobile-bff',
        tenantId: TENANTS[s % TENANTS.length][0],
      },
      perTick: PEAK_EXTRA * f,
    };
  },
  events(t, onset, stepMs) {
    const sitemap = onset.getTime() + SITEMAP_START_MS,
      attrs = { 'event.name': 'cron.job', 'job.name': 'sitemap-rebuild' };
    if (crossed(t, stepMs, sitemap))
      emitLog(
        'catalog',
        'catalog-4',
        OLD,
        sitemap,
        'INFO',
        'cron: sitemap-rebuild started on catalog-4: 1,180,000 product URLs in 24 shards',
        attrs,
      );
    if (crossed(t, stepMs, sitemap + SITEMAP_RUN_MS))
      emitLog(
        'catalog',
        'catalog-4',
        OLD,
        sitemap + SITEMAP_RUN_MS,
        'INFO',
        'cron: sitemap-rebuild finished on catalog-4 in 6m40s, 24 shards written',
        attrs,
      );
    const when = Math.floor(t.getTime() / HPA_MS) * HPA_MS,
      f = load(when, onset);
    if (f < 0.2 || !crossed(t, stepMs, when)) return;
    const desired = 6 + Math.ceil(6 * (f - 0.1)),
      n = when / HPA_MS;
    emitLog(
      'search',
      `search-${1 + (n % 6)}`,
      OLD,
      when,
      'WARN',
      `hpa search: desired replicas ${desired}, current 6; ${desired - 6} pods Pending: failed to assign an IP address to container (subnet-0a1b2c3d in us-east-1b has 0 free IPs)`,
      { 'event.name': 'k8s.hpa.scale_blocked' },
    );
  },
};
