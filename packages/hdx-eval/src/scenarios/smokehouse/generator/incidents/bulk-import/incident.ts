import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const RAMP_MS = 2 * 60_000;
const WRITE = { mean: 320, sd: 150 },
  READ = { mean: 11, sd: 5 };
const ROWS = 4_200_000,
  BATCH = 5_000,
  BATCHES_PER_MIN = 40;
const PROGRESS_MS = 15_000,
  SLOW_MS = 20_000;
const IMPORTER = 'catalog-3';
const ramp = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / RAMP_MS);

// A supplier feed import run from catalog upserts millions of rows into catalog-db with no
// throttle. catalog-db shares its Postgres instance with inventory-db, so every commit on the
// instance waits and inventory's reservation writes outlast cart's 500 ms timeout. catalog's reads stay fast.
export const bulkImport: Incident = {
  name: 'bulk-import',
  defaultOnsetMs: -18 * 60_000,
  apply(t, onset, world) {
    const f = ramp(t, onset);
    if (f === 0) return world;
    world.inventory.storeLatencyMs = {
      mean: 6 + (WRITE.mean - 6) * f,
      sd: 3 + (WRITE.sd - 3) * f,
    };
    world.catalog.storeLatencyMs = {
      mean: 6 + (READ.mean - 6) * f,
      sd: 3 + (READ.sd - 3) * f,
    };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    const attrs = {
      'event.name': 'catalog.feed_import',
      'server.address': 'commerce-pg-2',
    };
    if (crossed(t, stepMs, at))
      emitLog(
        'catalog',
        IMPORTER,
        OLD,
        at,
        'INFO',
        `supplier feed import vandelay-2026-09 started on ${IMPORTER} by merchandising (MERCH-882): ${ROWS.toLocaleString('en-US')} rows to upsert into catalog-db on commerce-pg-2, batch ${BATCH}, no rate limit`,
        attrs,
      );
    const when = Math.floor(t.getTime() / PROGRESS_MS) * PROGRESS_MS;
    if (when > at && crossed(t, stepMs, when)) {
      const done = Math.floor(((when - at) / 60_000) * BATCHES_PER_MIN);
      emitLog(
        'catalog',
        IMPORTER,
        OLD,
        when,
        'INFO',
        `supplier feed import vandelay-2026-09: batch ${done} of ${ROWS / BATCH} upserted (${(done * BATCH).toLocaleString('en-US')} rows), ${1400 + ((when / PROGRESS_MS) % 300)}ms per batch`,
        attrs,
      );
    }
    const slow = Math.floor(t.getTime() / SLOW_MS) * SLOW_MS;
    if (ramp(new Date(slow), onset) < 0.5 || !crossed(t, stepMs, slow)) return;
    const n = slow / SLOW_MS,
      pod = `inventory-${1 + (n % 6)}`;
    emitLog(
      'inventory',
      pod,
      OLD,
      slow,
      'WARN',
      `slow statement on ${pod}: UPDATE stock_levels SET reserved = reserved + $1 took ${420 + (n % 400)}ms, ${30 + (n % 40)} statements over 250ms in the last 20s (inventory-db on commerce-pg-2)`,
      { 'event.name': 'db.slow_statement', 'server.address': 'commerce-pg-2' },
    );
  },
};
