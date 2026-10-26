import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  REVIEW_NEW = '2.3.0';
const POD_STEP_MS = 4_000,
  REVIEW_LEAD_MS = 7 * 60_000,
  LINE_EVERY_MS = 125;
const SLOW = { mean: 220, sd: 90 };
const loudAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * POD_STEP_MS;
const shippedAt = (i: number, onset: Date) =>
  onset.getTime() - REVIEW_LEAD_MS + (i - 1) * 40_000;
const loudPods = (t: Date, onset: Date) =>
  [1, 2, 3, 4, 5, 6].filter(i => t.getTime() >= loudAt(i, onset));

// An engineer raises cart's root logger to DEBUG through the admin endpoint and never sets it back.
// cart writes each debug line synchronously, so its own time grows while its stores and inventory stay fast.
export const debugLogging: Incident = {
  name: 'debug-logging',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= shippedAt(i, onset))
        world.review.versions[`review-${i}`] = REVIEW_NEW;
    const loud = loudPods(t, onset);
    if (loud.length)
      world.cart.podLatencyMs = Object.fromEntries(
        loud.map(i => [`cart-${i}`, SLOW]),
      );
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = shippedAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'review',
          `review-${i}`,
          REVIEW_NEW,
          roll,
          'INFO',
          `deployment.rollout: review-${i} updated ${OLD} -> ${REVIEW_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': REVIEW_NEW,
          },
        );
      const when = loudAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'cart',
          `cart-${i}`,
          OLD,
          when,
          'INFO',
          `logging: level of logger ROOT set INFO -> DEBUG on cart-${i} via POST /admin/loggers by m.okafor (investigating CART-1931), no expiry`,
          { 'event.name': 'logging.level', 'logger.name': 'ROOT' },
        );
    }
    const loud = loudPods(t, onset),
      when = Math.floor(t.getTime() / LINE_EVERY_MS) * LINE_EVERY_MS;
    if (!loud.length || !crossed(t, stepMs, when)) return;
    const n = when / LINE_EVERY_MS,
      pod = `cart-${loud[n % loud.length]}`;
    emitLog(
      'cart',
      pod,
      OLD,
      when,
      'DEBUG',
      `DEBUG c.s.cart.CartRepository - loaded cart ${((n * 2654435761) % 0xffffff).toString(16)} with ${1 + (n % 9)} lines from carts, snapshot ${3 + (n % 40)} KiB: {"lines":[{"sku":"sku-${1000 + (n % 8000)}","qty":${1 + (n % 3)},"reserved":true}, ...]}`,
      { 'event.name': 'log.debug', 'logger.name': 'c.s.cart.CartRepository' },
    );
  },
};
