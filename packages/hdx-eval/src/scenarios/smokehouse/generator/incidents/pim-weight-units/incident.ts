import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const SYNC_MS = 30 * 60_000,
  SYNC_LEAD_MS = 20_000,
  AFFECTED_SHARE = 0.25,
  PRINTER_LEAD_MS = 6 * 60_000;
const syncAt = (onset: Date) => onset.getTime() - SYNC_LEAD_MS;

// The PIM vendor's feed switched its weight unit from grams to kilograms. catalog stores the numbers
// as grams, so 0.45 kg becomes 0 g and the carrier rejects any order holding one of those products.
export const pimWeightUnits: Incident = {
  name: 'pim-weight-units',
  defaultOnsetMs: -10 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.shipping.failIf = ctx =>
      ctx.route !== 'POST /checkout' || ctx.rng.next() >= AFFECTED_SHARE
        ? null
        : {
            status: 500,
            message:
              'CarrierRateError: ups rejected shipment: package weight 0 g is below the minimum of 1 g',
            log: {
              severity: 'ERROR',
              every: 3,
              body: `CarrierRateError: ups rejected shipment: package weight 0 g is below the minimum of 1 g (sku-${1000 + Math.floor(ctx.rng.next() * 8000)} weight_grams=0.${10 + Math.floor(ctx.rng.next() * 89)} rounded to 0)\n    at rateParcel (/app/shipping/carriers/ups.js:73:13)\n    at bookShipment (/app/shipping/book.js:29:20)`,
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    // The sync runs every thirty minutes; only the batch before onset carries the new unit.
    for (let k = 0; k <= 4; k++) {
      const when = syncAt(onset) - k * SYNC_MS;
      if (!crossed(t, stepMs, when)) continue;
      const body =
        k === 0
          ? 'pim sync batch 4418 applied to catalog-db: 6,412 products updated (weight, dimensions); feed header weight_unit=kg, catalog stores weight_grams'
          : `pim sync batch ${4418 - k} applied to catalog-db: ${900 + k * 137} products updated (price, title); feed header weight_unit=g, catalog stores weight_grams`;
      emitLog('catalog', 'catalog-2', OLD, when, 'INFO', body, {
        'event.name': 'pim.sync',
      });
    }
    // Unrelated: a label printer backlog at one warehouse, logged by shipping.
    const start = onset.getTime() - PRINTER_LEAD_MS;
    const tick = start + Math.floor((t.getTime() - start) / 30_000) * 30_000;
    if (tick < start || !crossed(t, stepMs, tick)) return;
    const n = (tick - start) / 30_000,
      pod = `shipping-${1 + (n % 6)}`;
    emitLog(
      'shipping',
      pod,
      OLD,
      tick,
      'WARN',
      `label printer queue at warehouse IAD-1: ${20 + (n % 30)} print requests pending, oldest ${40 + (n % 90)}s (seen by ${pod})`,
      { 'event.name': 'warehouse.printer' },
    );
  },
};
