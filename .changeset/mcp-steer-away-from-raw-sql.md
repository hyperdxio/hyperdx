---
'@hyperdx/api': patch
---

fix(mcp): steer agents toward builder query tools instead of raw SQL (HDX-4892). Telemetry showed agents (notebook investigations) using `clickstack_sql` for ~73% of data queries — usually for single-source aggregations, top-N, and time-series that the builder tools express more reliably (raw SQL also had ~2x the error rate). Reworded the `clickstack_sql` description to mark it a last resort, added a reciprocal "prefer me over SQL" nudge to `clickstack_table`, `clickstack_timeseries`, and `clickstack_search`, and added a server-level `instructions` tool-selection policy so the guidance is surfaced on `initialize` rather than only via the opt-in `query_guide` prompt.
