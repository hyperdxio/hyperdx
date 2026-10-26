import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  CATALOG_NEW = '1.4.3';
const RAMP_MS = 2 * 60_000,
  STEAL_MS = 30_000,
  CATALOG_LEAD_MS = 6 * 60_000;
const NODES: Record<string, string> = {
  'search-1': 'ip-10-0-5-21',
  'search-4': 'ip-10-0-5-88',
};
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);
const catalogAt = (i: number, onset: Date) =>
  onset.getTime() - CATALOG_LEAD_MS + (i - 1) * 30_000;

// Another team's CronJob with no CPU limit lands on the two nodes that host search-1 and search-4 and
// takes most of their CPU. Those two pods slow on their own work; Elasticsearch and the other pods do not.
export const noisyNeighbour: Incident = {
  name: 'noisy-neighbour',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= catalogAt(i, onset))
        world.catalog.versions[`catalog-${i}`] = CATALOG_NEW;
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.search.podLatencyMs = Object.fromEntries(
      Object.keys(NODES).map(p => [p, { mean: 12 + 370 * f, sd: 4 + 120 * f }]),
    );
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = catalogAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'catalog',
          `catalog-${i}`,
          CATALOG_NEW,
          roll,
          'INFO',
          `deployment.rollout: catalog-${i} updated ${OLD} -> ${CATALOG_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': CATALOG_NEW,
          },
        );
    }
    const at = onset.getTime();
    Object.entries(NODES).forEach(([pod, node], k) => {
      const when = at + k * 4000;
      if (crossed(t, stepMs, when))
        emitLog(
          'search',
          pod,
          OLD,
          when,
          'INFO',
          `node ${node}: pod data-science/ml-feature-backfill-28817-${k ? 'p7wd' : 'x2kq'} scheduled by cronjob ml-feature-backfill, cpu request 500m, no cpu limit`,
          { 'event.name': 'k8s.event', 'k8s.node.name': node },
        );
      const steal = Math.floor(t.getTime() / STEAL_MS) * STEAL_MS + k * 7000;
      if (
        steal <= when ||
        ramp(new Date(steal), onset) < 0.5 ||
        !crossed(t, stepMs, steal)
      )
        return;
      const n = steal / STEAL_MS;
      emitLog(
        'search',
        pod,
        OLD,
        steal,
        'WARN',
        `runtime on ${pod}: event loop delay p99 ${160 + (n % 120)}ms, cpu steal ${34 + (n % 15)}% on node ${node}`,
        { 'event.name': 'runtime.health', 'k8s.node.name': node },
      );
    });
  },
};
