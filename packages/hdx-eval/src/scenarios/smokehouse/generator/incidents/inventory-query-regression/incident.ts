import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  NEW = '1.9.0';
const ROLL_STEP_MS = 60_000,
  DBA_LAG_MS = 70_000,
  SLOW_MS = 20_000;
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() + (i - 1) * ROLL_STEP_MS;
const upgraded = (t: Date, onset: Date) =>
  [1, 2, 3, 4, 5, 6].filter(i => t.getTime() >= rolledAt(i, onset));

// inventory 1.9.0's ORM binds sku as text, so the reserve UPDATE no longer uses the sku index and scans
// stock_levels. Each upgraded pod adds scans to the one inventory-db, so every pod's writes slow, old ones too.
export const inventoryQueryRegression: Incident = {
  name: 'inventory-query-regression',
  defaultOnsetMs: -12 * 60_000,
  apply(t, onset, world) {
    const pods = upgraded(t, onset);
    for (const i of pods) world.inventory.versions[`inventory-${i}`] = NEW;
    if (pods.length === 0) return world;
    world.inventory.storeLatencyMs = {
      mean: 6 + 30 * pods.length,
      sd: 3 + 14 * pods.length,
    };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const roll = rolledAt(i, onset);
      if (crossed(t, stepMs, roll))
        emitLog(
          'inventory',
          `inventory-${i}`,
          NEW,
          roll,
          'INFO',
          `deployment.rollout: inventory-${i} updated ${OLD} -> ${NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': NEW,
          },
        );
    }
    // A harmless logging change on the database lands a minute in, and is why slow statements show up at all.
    const dba = onset.getTime() + DBA_LAG_MS;
    if (crossed(t, stepMs, dba))
      emitLog(
        'inventory',
        'inventory-5',
        OLD,
        dba,
        'INFO',
        'inventory-db parameter group change applied by data-platform (DBA-3517): log_min_duration_statement 1000ms -> 250ms, no restart needed',
        {
          'event.name': 'db.parameter_change',
          'server.address': 'inventory-db',
        },
      );
    const slow = Math.floor(t.getTime() / SLOW_MS) * SLOW_MS;
    const pods = upgraded(new Date(slow), onset);
    if (slow < dba || pods.length === 0 || !crossed(t, stepMs, slow)) return;
    const n = slow / SLOW_MS,
      i = pods[n % pods.length];
    emitLog(
      'inventory',
      `inventory-${i}`,
      NEW,
      slow,
      'WARN',
      `slow statement on inventory-${i}: UPDATE stock_levels SET reserved = reserved + $1 WHERE sku = $2::text took ${300 + (n % 500)}ms, Seq Scan on stock_levels (2,180,400 rows)`,
      { 'event.name': 'db.slow_statement', 'server.address': 'inventory-db' },
    );
  },
};
