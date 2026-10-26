import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  BFF_NEW = '1.4.3';
const RAMP_MS = 20 * 60_000,
  PEAK = 0.25;
const ROLL_LEAD_MS = 35 * 60_000,
  ROLL_STEP_MS = 40_000,
  REPORT_MS = 10_000;
const share = (t: number, onset: Date) =>
  t < onset.getTime() ? 0 : PEAK * Math.min(1, (t - onset.getTime()) / RAMP_MS);
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// A tag manager publish writes an experiment cookie that grows with every exposure. Once a browser's
// request headers pass Node's 16 KiB limit, web-bff's parser drops the socket before any handler or
// span runs, so only edge-gateway records the failure.
export const cookieHeaderOverflow: Incident = {
  name: 'cookie-header-overflow',
  defaultOnsetMs: -22 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world['web-bff'].versions[`web-bff-${i}`] = BFF_NEW;
    const s = share(t.getTime(), onset);
    if (s === 0) return world;
    world['edge-gateway'].failIf = ctx =>
      ctx.attrs.platform !== 'web' || ctx.rng.next() >= s
        ? null
        : {
            status: 502,
            message:
              'upstream prematurely closed connection while reading response header from upstream web-bff',
            durationMs: ctx.rng.gauss(4, 1),
            log: {
              severity: 'ERROR',
              every: 4,
              body: `upstream prematurely closed connection while reading response header from upstream, request: "${ctx.route} HTTP/1.1", upstream: "http://web-bff.commerce.svc.cluster.local:8080"`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'web-bff',
          `web-bff-${i}`,
          BFF_NEW,
          when,
          'INFO',
          `deployment.rollout: web-bff-${i} updated ${OLD} -> ${BFF_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': BFF_NEW,
          },
        );
    }
    const when = Math.floor(t.getTime() / REPORT_MS) * REPORT_MS,
      s = share(when, onset);
    if (s === 0 || !crossed(t, stepMs, when)) return;
    const n = when / REPORT_MS,
      pod = `web-bff-${1 + (n % 6)}`,
      f = s / PEAK;
    emitLog(
      'web-bff',
      pod,
      BFF_NEW,
      when,
      'WARN',
      `clientError HPE_HEADER_OVERFLOW on ${pod}: ${1 + Math.round(f * (6 + (n % 5)))} connections closed before parsing in the last 10s; request headers up to ${(16.1 + 3 * f).toFixed(1)} KiB against max-http-header-size 16384, largest cookie _exp_bundle ${(12 + 3 * f).toFixed(1)} KiB`,
      {
        'event.name': 'http.client_error',
        'error.code': 'HPE_HEADER_OVERFLOW',
      },
    );
  },
};
