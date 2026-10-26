import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const DAY_MS = 86_400_000;
// Minutes after the sync job that each shipping pod refreshes its cached calendar.
const REFRESH_MIN = [0.5, 3, 5.5, 8, 10.5, 13];
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const refreshedAt = (i: number, onset: Date) =>
  onset.getTime() + REFRESH_MIN[i - 1] * 60_000;

// shipping's calendar-sync batch works out the business date in UTC and activates the next day's
// carrier cutoff calendar, while US warehouses look up by their local date. Pods fail bookings as
// they refresh their cache. notification's daily digest starts at the same moment and is harmless.
export const dateRollover: Incident = {
  name: 'date-rollover',
  defaultOnsetMs: -20 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.notification.latencyMs = { mean: 38, sd: 12 };
    const local = date(onset.getTime()),
      active = date(onset.getTime() + DAY_MS);
    world.shipping.failIf = ctx => {
      const i = Number(ctx.pod.split('-').pop());
      if (
        ctx.attrs.region === 'eu-west-1' ||
        t.getTime() < refreshedAt(i, onset)
      )
        return null;
      const wh = ctx.attrs.region === 'us-east-1' ? 'IAD-1' : 'SEA-3';
      return {
        status: 500,
        message: `CalendarLookupError: no carrier cutoff calendar for warehouse ${wh} on ${local} (active calendar ${active})`,
        log: {
          severity: 'ERROR',
          every: 3,
          body: `CalendarLookupError: no carrier cutoff calendar for warehouse ${wh} on ${local} (active calendar ${active}, warehouse tz America/${wh === 'IAD-1' ? 'New_York' : 'Los_Angeles'})\n    at cutoffFor (/app/shipping/calendar.js:71:11)\n    at bookShipment (/app/shipping/book.js:29:18)`,
        },
      };
    };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    if (crossed(t, stepMs, at)) {
      emitLog(
        'shipping',
        'shipping-1',
        '1.4.2',
        at,
        'INFO',
        `batch calendar-sync: business date ${date(at + DAY_MS)} (computed in UTC); activated carrier cutoff calendars for ${date(at + DAY_MS)} across 11 warehouses, retired ${date(at)}`,
        { 'event.name': 'batch.complete', 'batch.job': 'calendar-sync' },
      );
      emitLog(
        'notification',
        'notification-3',
        '1.4.2',
        at,
        'INFO',
        'batch daily-digest started: 41,200 recipients queued, concurrency 16',
        { 'event.name': 'batch.progress', 'batch.job': 'daily-digest' },
      );
    }
    for (let i = 1; i <= 6; i++) {
      const when = refreshedAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'shipping',
          `shipping-${i}`,
          '1.4.2',
          when,
          'INFO',
          `calendar cache refreshed on shipping-${i}: active cutoff calendar ${date(at + DAY_MS)}`,
          { 'event.name': 'shipping.calendar.refresh' },
        );
    }
    const when = Math.floor(t.getTime() / 60_000) * 60_000;
    if (when > at && when < at + 15 * 60_000 && crossed(t, stepMs, when)) {
      const n = Math.round((when - at) / 60_000);
      emitLog(
        'notification',
        'notification-3',
        '1.4.2',
        when,
        'INFO',
        `batch daily-digest: ${Math.min(41_200, n * 2_900)} of 41,200 digests sent`,
        { 'event.name': 'batch.progress', 'batch.job': 'daily-digest' },
      );
    }
  },
};
