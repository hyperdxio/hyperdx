---
"@hyperdx/api": patch
---

fix(mcp): time-bound the trace waterfall span/log fetches so they prune
partitions instead of scanning the full retention window. The
`clickstack_trace_waterfall` tool now threads the search window into its span
and correlated-log queries, adds a `max_execution_time` ceiling, and probes a
trace's `[min, max]` span extent so an explicit `traceId` older than the
default window — or a trace that ran longer than an hour — still resolves in
full. The probe also runs for auto-picked traces, so a picked trace whose root
predates the window is no longer truncated into a partial tree. The fetch window
is width-clamped to the recent tail so a reused or sentinel `traceId` (e.g. an
all-zero id from an uninstrumented emitter) can't widen the scan back toward the
retention edge or stitch unrelated occurrences into one tree. Empty-result hints
now name the recoverable action (pass an explicit `startTime`) instead of the
misleading "widen the window", and a probe that fails is surfaced rather than
silently swallowed. ClickHouse query timeouts are also reclassified from `user`
to `server` errors.
