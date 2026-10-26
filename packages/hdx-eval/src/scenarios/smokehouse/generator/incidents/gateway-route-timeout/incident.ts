import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  NEW = '2.8.0';
const ROUTE_TIMEOUT_MS = 400,
  CLOSED_MS = 20_000;

// edge-gateway 2.8.0 renamed route.timeout to upstream_timeout and ignores the old key, so every route falls
// back to the listener default of 400 ms. The backends finish their work; the gateway has stopped waiting for them.
export const gatewayRouteTimeout: Incident = {
  name: 'gateway-route-timeout',
  defaultOnsetMs: -9 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    for (let i = 1; i <= 6; i++)
      world['edge-gateway'].versions[`edge-gateway-${i}`] = NEW;
    world['edge-gateway'].timeoutMs = ROUTE_TIMEOUT_MS;
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    for (let i = 1; i <= 6; i++) {
      if (crossed(t, stepMs, at))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          NEW,
          at,
          'INFO',
          `deployment.rollout: edge-gateway-${i} updated ${OLD} -> ${NEW} (blue/green cutover, ${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
      const boot = at + 1500 + i * 100;
      if (crossed(t, stepMs, boot))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          NEW,
          boot,
          'WARN',
          `config on edge-gateway-${i}: unknown key route.timeout on 7 routes ignored (renamed upstream_timeout in 2.8), using listener default ${ROUTE_TIMEOUT_MS}ms`,
          { 'event.name': 'config.load' },
        );
    }
    // The BFFs see the gateway hang up on them, and say so without knowing why.
    const when = Math.floor(t.getTime() / CLOSED_MS) * CLOSED_MS;
    if (when <= at || !crossed(t, stepMs, when)) return;
    const n = when / CLOSED_MS,
      bff = n % 5 < 3 ? 'web-bff' : 'mobile-bff',
      pod = `${bff}-${1 + (n % 6)}`;
    emitLog(
      bff,
      pod,
      OLD,
      when,
      'WARN',
      `${pod}: client closed the connection before the response was written on POST /checkout (499), ${4 + (n % 15)} in the last 20s`,
      { 'event.name': 'http.client_closed' },
    );
  },
};
