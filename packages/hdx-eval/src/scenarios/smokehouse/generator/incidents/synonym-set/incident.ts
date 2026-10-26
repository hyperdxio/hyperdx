import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2',
  PRICING_NEW = '1.4.4';
const ROLL_LEAD_MS = 6 * 60_000,
  ROLL_STEP_MS = 30_000,
  SLOW_MS = 20_000;
const ES = { mean: 210, sd: 160 },
  CLAUSE_SHARE = 0.06;
const TERMS = [
  'black dress',
  'kids set',
  'usb c cable',
  'running shoes',
  'gift set',
  'phone case',
];
const rolledAt = (i: number, onset: Date) =>
  onset.getTime() - ROLL_LEAD_MS + (i - 1) * ROLL_STEP_MS;

// The relevance team publishes a synonym set whose multi-way rules chain common words. Elasticsearch
// reloads the search analyzer in place, so queries with those words expand to thousands of clauses:
// slow for every search, rejected outright past the 4096 clause limit.
export const synonymSet: Incident = {
  name: 'synonym-set',
  defaultOnsetMs: -13 * 60_000,
  apply(t, onset, world) {
    for (let i = 1; i <= 6; i++)
      if (t.getTime() >= rolledAt(i, onset))
        world.pricing.versions[`pricing-${i}`] = PRICING_NEW;
    if (t < onset) return world;
    world.search.storeLatencyMs = { ...ES };
    world.search.failIf = ctx =>
      ctx.rng.next() >= CLAUSE_SHARE
        ? null
        : {
            status: 500,
            message:
              'search_phase_execution_exception: too_many_clauses: maxClauseCount is set to 4096',
            durationMs: ctx.rng.gauss(95, 20),
            log: {
              severity: 'ERROR',
              every: 3,
              body: 'ResponseError: search_phase_execution_exception: [too_many_clauses] Reason: maxClauseCount is set to 4096\n    at SniffingTransport.request (/app/node_modules/@elastic/transport/lib/Transport.js:479:27)\n    at searchProducts (/app/search/query.js:58:17)',
            },
          };
    return world;
  },
  events(t, onset, stepMs) {
    for (let i = 1; i <= 6; i++) {
      const when = rolledAt(i, onset);
      if (crossed(t, stepMs, when))
        emitLog(
          'pricing',
          `pricing-${i}`,
          PRICING_NEW,
          when,
          'INFO',
          `deployment.rollout: pricing-${i} updated ${OLD} -> ${PRICING_NEW} (${i}/6)`,
          {
            'event.name': 'deployment.rollout',
            'deployment.from': OLD,
            'deployment.to': PRICING_NEW,
          },
        );
    }
    const at = onset.getTime();
    if (crossed(t, stepMs, at))
      emitLog(
        'search',
        'search-1',
        OLD,
        at,
        'INFO',
        'synonyms: published synonym set catalog-synonyms v58 from relevance-team upload SRCH-611 (14,212 rules, was v57 with 2,904) and reloaded search analyzers on catalog-index, no reindex',
        {
          'event.name': 'search.synonyms.publish',
          'server.address': 'catalog-index',
        },
      );
    const when = Math.floor(t.getTime() / SLOW_MS) * SLOW_MS;
    if (when <= at || !crossed(t, stepMs, when)) return;
    const n = when / SLOW_MS,
      pod = `search-${1 + (n % 6)}`;
    emitLog(
      'search',
      pod,
      OLD,
      when,
      'WARN',
      `es.search on ${pod} took ${380 + ((n * 37) % 520)}ms: query "${TERMS[n % TERMS.length]}" rewrote to ${1800 + ((n * 211) % 2200)} clauses after synonym expansion`,
      { 'event.name': 'es.slow_search', 'server.address': 'catalog-index' },
    );
  },
};
