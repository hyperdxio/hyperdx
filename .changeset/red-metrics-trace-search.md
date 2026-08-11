---
'@hyperdx/app': minor
---

Show RED metrics (Throughput, Errors, Duration) above the trace search results instead of the single count histogram. The three charts share a synced hover cursor, Errors toggles between rate and volume, and a RED/Heatmap switch flips the area to the duration heatmap. Logs and other sources keep the existing histogram.

The shared "error span" definition now also matches the legacy `STATUS_CODE_ERROR` status value in addition to `Error`, so error counts on the Services and LLM dashboards include those spans too.
