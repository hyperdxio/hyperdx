import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 3 * 60_000;
const PEAK_MS = 700,
  PEAK_SD = 250;
const STATS_MS = 15_000,
  NOTICE_MS = 5 * 60_000;
const degraded = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// The third-party geocoder's EU endpoint slows down. shipping validates every destination address
// before booking and still answers 200, but eu-west-1 bookings outlast checkout's 500 ms timeout.
// The payment provider's EU maintenance notice lands at the same time and changes nothing.
export const geocodeLatency: Incident = {
  name: 'geocode-latency',
  defaultOnsetMs: -14 * 60_000,
  apply(t, onset, world) {
    const f = degraded(t, onset);
    if (f === 0) return world;
    world.shipping.delayMs = ctx =>
      ctx.attrs.region !== 'eu-west-1'
        ? 0
        : ctx.rng.gauss(PEAK_MS * f, PEAK_SD * f + 5);
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    const window = `${new Date(at - 5 * 60_000).toISOString().slice(11, 16)}-${new Date(at + 40 * 60_000).toISOString().slice(11, 16)} UTC`;
    const notice = at - 2 * 60_000;
    for (let when = notice; when <= t.getTime(); when += NOTICE_MS) {
      if (crossed(t, stepMs, when))
        emitLog(
          'payment',
          `payment-${1 + ((when / NOTICE_MS) % 6)}`,
          OLD,
          when,
          'WARN',
          `payments.example.com status: scheduled maintenance in eu-west-1 ${window}, card authorisations may see elevated latency (notice PGW-5521)`,
          { 'event.name': 'provider.notice' },
        );
    }
    // Emitted before onset too, so the healthy EU latency is there to compare against.
    const stat = Math.floor(t.getTime() / STATS_MS) * STATS_MS;
    if (!crossed(t, stepMs, stat)) return;
    const n = stat / STATS_MS,
      pod = `shipping-${1 + (n % 6)}`,
      f = degraded(new Date(stat), onset);
    const eu = Math.round(55 + (n % 20) + (PEAK_MS + 600) * f);
    emitLog(
      'shipping',
      pod,
      OLD,
      stat,
      eu > 300 ? 'WARN' : 'INFO',
      `address validation on ${pod}: geocoder eu.geo.example.com p99 ${eu}ms, us.geo.example.com p99 ${48 + (n % 15)}ms over the last 15s (budget 300ms)`,
      { 'event.name': 'geocoder.client.stats' },
    );
  },
};
