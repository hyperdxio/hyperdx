/**
 * Quantisation of an exemplar query's time window.
 *
 * Its own module because the exemplar hooks are mocked wholesale in several test
 * files (`jest.mock('@/hooks/useExemplars')`), and these are pure helpers that
 * callers still need for real.
 */

// Live-tail charts advance `dateRange` continuously. Rounding the range to this
// bucket keeps sub-minute ticks on one cache entry — without it every tick mints a
// new key, empties the overlay, and force-closes the hover card the user is
// reaching for.
const EXEMPLAR_KEY_QUANTUM_MS = 30_000;

// Floor the start and ceil the end, so the quantised window always *contains* the
// rendered one. Rounding both ends could produce a zero-width window and served
// markers offset from the chart's.
//
// Load-bearing detail: the quantised window is what gets FETCHED, not just what
// gets keyed. Keying on it while fetching the raw range would make the cache entry
// hold whichever raw window arrived first, so two windows sharing a key would show
// each other's markers. Fetching the quantised window makes the entry a genuine
// superset of every raw window that maps to it, and the render layer then trims to
// the drawn x-domain (see clampExemplarX).
export const quantizeStart = (d: Date) =>
  Math.floor(d.getTime() / EXEMPLAR_KEY_QUANTUM_MS) * EXEMPLAR_KEY_QUANTUM_MS;
export const quantizeEnd = (d: Date) =>
  Math.ceil(d.getTime() / EXEMPLAR_KEY_QUANTUM_MS) * EXEMPLAR_KEY_QUANTUM_MS;
