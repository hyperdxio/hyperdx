import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  SHIPPING_NEW = '1.6.0';
const ENFORCE_STEP_MS = 30_000;
const SHIPPING_LEAD_MS = 25 * 60_000;
const enforcedAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * ENFORCE_STEP_MS;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() - SHIPPING_LEAD_MS + (i - 1) * 40_000;

// The security team applies a default-deny egress policy to checkout's namespace. Its allowlist only
// selects pods in that namespace, and shipping runs in logistics, so checkout's connections to it hang.
// shipping.book comes after payment and orders, so each failed checkout has already charged the card.
export const egressPolicy: Incident = {
  name: 'egress-policy',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world.shipping.versions[`shipping-${i}`] = SHIPPING_NEW;
    const enforced = new Set(
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= enforcedAt(i, onset))
        .map(i => `checkout-${i}`),
    );
    if (enforced.size === 0) return world;
    // orders.create is the call before shipping.book, so its reply is when checkout dials shipping.
    world.checkout.afterCall = (ctx, callee) =>
      callee.service !== 'orders' || !enforced.has(ctx.pod)
        ? null
        : {
            status: 504,
            message:
              'connect ETIMEDOUT 10.43.12.7:8080 (shipping.logistics.svc.cluster.local)',
            durationMs: ctx.rng.gauss(1000, 5),
            log: {
              severity: 'ERROR',
              every: 2,
              body: 'ShippingClientError: connect ETIMEDOUT 10.43.12.7:8080 (shipping.logistics.svc.cluster.local) after 1000ms\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)\n    at bookShipment (/app/checkout/shipping-client.js:29:17)\n    at placeOrder (/app/checkout/place.js:141:9)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = shippedAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'shipping',
          `shipping-${i}`,
          SHIPPING_NEW,
          roll,
          'INFO',
          `deployment.rollout: shipping-${i} updated ${OLD} -> ${SHIPPING_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': SHIPPING_NEW,
          },
        );
      const when = enforcedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'checkout',
          `checkout-${i}`,
          OLD,
          when,
          'INFO',
          `k8s.networkpolicy: policy pci-egress-default-deny (SEC-2231 by security) now enforced on checkout-${i}: egress allowed to 9 pod selectors in namespace commerce plus kube-dns, all other egress denied`,
          {
            'event.name': 'k8s.networkpolicy',
            'k8s.networkpolicy.name': 'pci-egress-default-deny',
          },
        );
    }
  },
};
