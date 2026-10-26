import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const JOB = 'catalog-migrate-7f9c2';
const RELEASE = '1.5.0';
const MIGRATION = '0042_widen_products_sku';
const ROWS = 48_000_000;
const PROGRESS_MS = 30_000;
const ROWS_PER_MS = 25;

// catalog 1.5.0's pre-upgrade hook rewrites the products table under an ACCESS EXCLUSIVE lock.
// Every read of products queues behind it until statement_timeout; the app pods never roll.
export const migrationLock: Incident = {
  name: 'migration-lock',
  defaultOnsetMs: -8 * 60_000,
  apply(t, onset, world) {
    if (t < onset) return world;
    world.catalog.storeLatencyMs = { mean: 1500, sd: 350 };
    world.catalog.failIf = ctx =>
      ctx.rng.next() >= 0.3
        ? null
        : {
            status: 500,
            message:
              'QueryFailedError: canceling statement due to statement timeout',
            durationMs: ctx.rng.gauss(2000, 20),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'QueryFailedError: canceling statement due to statement timeout\n    query: SELECT id, sku, title, price_cents FROM products WHERE id = $1\n    at PgConnection.query (/app/node_modules/pg/lib/client.js:526:17)\n    at getProduct (/app/catalog/products.js:31:22)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    const attrs = {
      'event.name': 'db.migration',
      'db.migration.id': MIGRATION,
      'server.address': 'catalog-db',
    };
    if (crossed(t, stepMs, onset.getTime() - 2_000))
      emitLog(
        'catalog',
        JOB,
        RELEASE,
        onset.getTime() - 2_000,
        'INFO',
        `helm pre-upgrade hook: running migrations for catalog ${RELEASE} before rollout`,
        attrs,
      );
    if (crossed(t, stepMs, onset.getTime()))
      emitLog(
        'catalog',
        JOB,
        RELEASE,
        onset.getTime(),
        'INFO',
        `migration ${MIGRATION} started: ALTER TABLE products ALTER COLUMN sku TYPE varchar(64) (table rewrite, ${ROWS} rows)`,
        attrs,
      );
    const when = Math.floor(t.getTime() / PROGRESS_MS) * PROGRESS_MS;
    if (when <= onset.getTime() || !crossed(t, stepMs, when)) return;
    const done = Math.min(
      ROWS - 1,
      Math.round((when - onset.getTime()) * ROWS_PER_MS),
    );
    emitLog(
      'catalog',
      JOB,
      RELEASE,
      when,
      'INFO',
      `migration ${MIGRATION} still running: rewrote ${done} of ${ROWS} rows, holding AccessExclusiveLock on products`,
      attrs,
    );
    emitLog(
      'catalog',
      JOB,
      RELEASE,
      when + 1,
      'WARN',
      `pg: ${20 + ((when / PROGRESS_MS) % 40)} sessions waiting for AccessShareLock on relation products behind pid 48213 (${MIGRATION})`,
      { ...attrs, 'event.name': 'db.lock_wait' },
    );
  },
};
