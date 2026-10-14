// Per-window (before/after focus date) row cap for the trace waterfall query.
// Kept in its own module so tests can mock it down to a few rows instead of
// rendering 50k spans.
export const TRACE_WATERFALL_ROW_LIMIT = 50000;
// Fetch one extra row so a window that contains *exactly* the cap is not
// mistaken for truncation. A full page of LIMIT is ambiguous; LIMIT+1 is not.
export const TRACE_WATERFALL_FETCH_LIMIT = TRACE_WATERFALL_ROW_LIMIT + 1;
