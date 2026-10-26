import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const NAT = 'nat-0b7e21',
  NAT_IP = '3.91.204.17';
// Pod n of each service runs on node n; nodes 3 and 6 are the ones whose subnet moved.
const MOVED: Record<number, string> = {
  3: 'ip-10-0-9-14.ec2.internal',
  6: 'ip-10-0-9-37.ec2.internal',
};

// The platform team sends one subnet's egress through a new NAT gateway. The carrier only accepts
// calls from allowlisted addresses, so shipping pods on those nodes have every booking refused.
export const natAllowlist: Incident = {
  name: 'nat-allowlist',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.shipping.failIf = ctx =>
      !MOVED[Number(ctx.pod.split('-').pop())]
        ? null
        : {
            status: 502,
            message: `carrier api.shipco.example.com returned 403: source address ${NAT_IP} is not permitted for account SHOP-4471`,
            durationMs: ctx.rng.gauss(90, 25),
            log: {
              severity: 'ERROR',
              every: 2,
              body: `booking failed on ${ctx.pod}: carrier api.shipco.example.com returned 403 Forbidden {"error":"ip_not_allowed","detail":"source address ${NAT_IP} is not permitted for account SHOP-4471"}`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at)) {
      for (const [n, node] of Object.entries(MOVED))
        for (const service of ['shipping', 'payment']) {
          emitLog(
            service,
            `${service}-${n}`,
            OLD,
            at,
            'INFO',
            `network.event: node ${node} now egresses through ${NAT} (public ${NAT_IP}) after route table change NET-882 by platform (NAT capacity for us-east-1c)`,
            { 'event.name': 'network.route_change', 'k8s.node.name': node },
          );
        }
    }
    // Unrelated: a label format change for one warehouse, three minutes earlier.
    const label = at - 3 * 60_000;
    if (crossed(t, stepMs, label))
      emitLog(
        'shipping',
        'shipping-1',
        OLD,
        label,
        'INFO',
        'config.change: shipping label format for warehouse SEA-3 set PDF -> ZPL (WH-219, new thermal printers)',
        { 'event.name': 'config.change', 'config.key': 'labels.format.SEA-3' },
      );
  },
};
