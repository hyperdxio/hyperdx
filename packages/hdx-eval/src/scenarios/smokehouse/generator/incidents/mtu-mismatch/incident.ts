import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const NODE_STEP_MS = 4 * 60_000;
// Nodes in upgrade order, with the catalog pod and the neighbours scheduled on each; the neighbours' replies are small.
const NODES: Array<[string, string[]]> = [
  ['ip-10-0-5-21.ec2.internal', ['catalog-3', 'payment-5', 'notification-4']],
  ['ip-10-0-6-48.ec2.internal', ['catalog-1', 'email-worker-1', 'fraud-2']],
  ['ip-10-0-5-77.ec2.internal', ['catalog-6', 'auth-3', 'promo-1']],
  ['ip-10-0-7-12.ec2.internal', ['catalog-4', 'inventory-5', 'shipping-3']],
];
// Product and search lookups return full product bodies; /home asks for tiles that fit in one packet.
const LARGE = new Set(['GET /product/{id}', 'GET /search']);
// Callers on upgraded nodes share the larger MTU and get their replies.
const DROPPED = 0.85;
const upgradedAt = (i: number, onset: Date) =>
  onset.getTime() + i * NODE_STEP_MS;

// The platform team upgrades the CNI node by node, which raises the tunnel MTU. Replies larger
// than the old MTU from catalog pods on upgraded nodes to callers on old nodes are dropped.
export const mtuMismatch: Incident = {
  name: 'mtu-mismatch',
  defaultOnsetMs: -13 * 60_000,
  apply(t, onset, world) {
    const upgraded = new Set(
      NODES.filter((_, i) => t.getTime() >= upgradedAt(i, onset)).map(
        ([, pods]) => pods[0],
      ),
    );
    if (upgraded.size === 0) return world;
    world.catalog.failIf = ctx =>
      !upgraded.has(ctx.pod) ||
      !LARGE.has(ctx.route) ||
      ctx.rng.next() >= DROPPED
        ? null
        : {
            status: 500,
            message:
              'write ETIMEDOUT: response stalled, peer stopped acknowledging',
            durationMs: ctx.rng.gauss(1500, 200),
            log: {
              severity: 'ERROR',
              every: 3,
              body: `response write stalled on ${ctx.pod}: 2,896 of ${18_000 + Math.floor(ctx.rng.next() * 9_000)} bytes acknowledged after 1500ms, socket closed (write ETIMEDOUT)\n    at Socket._onTimeout (node:net:595:8)\n    at writeProduct (/app/catalog/respond.js:31:9)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    NODES.forEach(([node, pods], i) => {
      const at = upgradedAt(i, onset);
      pods.forEach((pod, k) => {
        const when = at + k * 1_500;
        if (crossed(t, stepMs, when))
          emitLog(
            pod.slice(0, pod.lastIndexOf('-')),
            pod,
            OLD,
            when,
            'INFO',
            `k8s.event: node ${node}: cilium-agent restarted with 1.16.1 (was 1.15.6) for PLAT-5207 CNI upgrade, tunnel MTU 1450 -> 8951; pod ${pod} networking re-attached`,
            { 'event.name': 'k8s.node.network', 'k8s.node.name': node },
          );
      });
    });
  },
};
