import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

// Phased release of the iOS app: [minutes after onset, share of iOS users on 7.2.0].
const PHASES: Array<[number, number]> = [
  [0, 0.01],
  [15, 0.02],
  [30, 0.05],
  [45, 0.1],
  [55, 0.25],
  [63, 0.5],
];
const ANDROID_MS = 40 * 60_000;

const share = (t: Date, onset: Date) => {
  const min = (t.getTime() - onset.getTime()) / 60_000;
  return PHASES.filter(([m]) => min >= m).pop()?.[1] ?? 0;
};

// iOS 7.2.0 sends a list of ETags in If-None-Match, which mobile-bff's product handler cannot
// parse. Errors grow with the phased release; android 5.9.0 ships in between and is healthy.
export const clientRelease: Incident = {
  name: 'client-release',
  defaultOnsetMs: -70 * 60_000,
  apply(t, onset, world) {
    const s = share(t, onset);
    if (s === 0) return world;
    world['mobile-bff'].failIf = ctx =>
      ctx.route !== 'GET /product/{id}' ||
      ctx.attrs.platform !== 'ios' ||
      ctx.rng.next() >= s
        ? null
        : {
            status: 500,
            message:
              "TypeError: Cannot read properties of undefined (reading 'replace')",
            log: {
              severity: 'ERROR',
              every: 2,
              body: 'TypeError: Cannot read properties of undefined (reading \'replace\')\n    at parseIfNoneMatch (/app/mobile-bff/etag.js:19:24)\n    at productHandler (/app/mobile-bff/routes/product.js:44:17)\n    user-agent: ShopApp/7.2.0 (iPhone; iOS 18.1) if-none-match: W/"p-81c2", W/"p-81c3"',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (const [m, s] of PHASES) {
      const when = onset.getTime() + m * 60_000;
      if (crossed(t, stepMs, when))
        emitLog(
          'mobile-bff',
          'mobile-bff-1',
          '1.4.2',
          when,
          'INFO',
          `client.release: ios app 7.2.0 (build 7201) phased release now at ${s * 100}% of users`,
          {
            'event.name': 'client.release',
            'client.platform': 'ios',
            'client.app_version': '7.2.0',
          },
        );
    }
    const android = onset.getTime() + ANDROID_MS;
    if (crossed(t, stepMs, android))
      emitLog(
        'mobile-bff',
        'mobile-bff-1',
        '1.4.2',
        android,
        'INFO',
        'client.release: android app 5.9.0 (build 5904) released to 100% of users',
        {
          'event.name': 'client.release',
          'client.platform': 'android',
          'client.app_version': '5.9.0',
        },
      );
  },
};
