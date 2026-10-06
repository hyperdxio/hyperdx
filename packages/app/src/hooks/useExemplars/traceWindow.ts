/**
 * Half-width of the window an exemplar's trace is looked up in, and that the
 * Inspect deep link opens. Wide enough to absorb clock skew between the metric
 * pipeline and the trace store, narrow enough that the lookup reads a couple of
 * partitions rather than the whole table and the trace is not buried among
 * unrelated ones.
 */
export const EXEMPLAR_TRACE_WINDOW_MS = 5 * 60 * 1000;

/** Epoch-ms [from, to] bracketing an exemplar. */
export function exemplarTraceWindow(timestampMs: number): [number, number] {
  return [
    timestampMs - EXEMPLAR_TRACE_WINDOW_MS,
    timestampMs + EXEMPLAR_TRACE_WINDOW_MS,
  ];
}
