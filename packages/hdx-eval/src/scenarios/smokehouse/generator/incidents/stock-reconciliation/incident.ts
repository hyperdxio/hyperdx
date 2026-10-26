import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const WRITE_MS = 41_000,
  BAD_SHARE = 0.18,
  VICTIM_EVERY_MS = 20_000;
const written = (t: Date, onset: Date) =>
  t < onset ? 0 : Math.min(1, (t.getTime() - onset.getTime()) / WRITE_MS);

// Fulfilment ops loads a warehouse management snapshot into inventory's stock_levels. The snapshot
// counts in-transit units as negative stock, so reserving any of those SKUs breaks the table's check
// constraint. inventory fails fast and inventory-db stays as fast as before.
export const stockReconciliation: Incident = {
  name: 'stock-reconciliation',
  defaultOnsetMs: -11 * 60_000,
  apply(t, onset, world) {
    const f = written(t, onset);
    if (f === 0) return world;
    world.inventory.failIf = ctx =>
      ctx.rng.next() >= BAD_SHARE * f
        ? null
        : {
            status: 500,
            message:
              'error: new row for relation "stock_levels" violates check constraint "stock_levels_available_nonnegative"',
            durationMs: ctx.rng.gauss(9, 3),
            log: {
              severity: 'ERROR',
              every: 3,
              body: `error: new row for relation "stock_levels" violates check constraint "stock_levels_available_nonnegative"\nDETAIL: Failing row contains (sku-${40000 + Math.floor(ctx.rng.next() * 9000)}, iad-1, 0, ${1 + Math.floor(ctx.rng.next() * 4)}, -${2 + Math.floor(ctx.rng.next() * 60)}).\n    at reserve (/app/inventory/reserve.js:52:19)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime(),
      attrs = {
        'event.name': 'wms.reconciliation',
        'wms.snapshot': 'wms-iad-1@2026-09-22T09:40Z',
      };
    if (crossed(t, stepMs, at))
      emitLog(
        'inventory',
        'inventory-4',
        OLD,
        at,
        'INFO',
        'wms reconciliation FUL-3318 requested by fulfilment-ops: applying snapshot wms-iad-1@2026-09-22T09:40Z to stock_levels (18,240 SKUs) on inventory-4',
        attrs,
      );
    if (crossed(t, stepMs, at + WRITE_MS))
      emitLog(
        'inventory',
        'inventory-4',
        OLD,
        at + WRITE_MS,
        'INFO',
        'wms reconciliation FUL-3318: 18,240 stock_levels rows written in 41s, 0 rejected',
        attrs,
      );
    // cart reports what its customers see, without saying why.
    const when = Math.floor(t.getTime() / VICTIM_EVERY_MS) * VICTIM_EVERY_MS;
    if (written(new Date(when), onset) === 0 || !crossed(t, stepMs, when))
      return;
    const n = when / VICTIM_EVERY_MS,
      pod = `cart-${1 + (n % 6)}`;
    emitLog(
      'cart',
      pod,
      OLD,
      when,
      'WARN',
      `${pod}: ${4 + (n % 9)} carts marked lines unavailable in the last 20s after reservation failures; customers see "item no longer available"`,
      { 'event.name': 'cart.lines_unavailable' },
    );
  },
};
