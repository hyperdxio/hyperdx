import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const NODE = 'ip-10-0-3-17.ec2.internal';
const BAD = ['catalog-2', 'catalog-5'];
const REPORT_MS = 20_000;
const nodeAttrs = { 'host.name': NODE, 'k8s.node.name': NODE };

// Two catalog pods share one node whose disk is throttled. Nothing about catalog itself
// changed: the other four pods and catalog-db stay healthy.
export const badNode: Incident = {
  name: 'bad-node',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.catalog.podLatencyMs = Object.fromEntries(
      BAD.map(p => [p, { mean: 400, sd: 150 }]),
    );
    world.catalog.failIf = ctx =>
      !BAD.includes(ctx.pod) || ctx.rng.next() >= 0.03
        ? null
        : {
            status: 503,
            message: 'i/o timeout reading local cache',
            log: {
              severity: 'ERROR',
              every: 3,
              body: `Error: EIO: i/o timeout, read /var/cache/catalog/entries.db (host ${NODE})`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    if (crossed(t, stepMs, onset.getTime())) {
      for (const pod of BAD)
        emitLog(
          'catalog',
          pod,
          '1.4.2',
          onset.getTime(),
          'WARN',
          `node.condition: ${NODE} DiskPressure=True, EBS volume throughput throttled, iowait 78%`,
          { 'event.name': 'node.condition', ...nodeAttrs },
        );
    }
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS;
    if (when <= onset.getTime() || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS;
    emitLog(
      'catalog',
      BAD[n % 2],
      '1.4.2',
      when,
      'WARN',
      `iowait ${70 + (n % 17)}% on host ${NODE}, ${3 + (n % 9)} processes blocked on disk`,
      { 'event.name': 'host.iowait', ...nodeAttrs },
    );
  },
};
