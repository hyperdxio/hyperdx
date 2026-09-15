---
'@hyperdx/app': minor
---

Add a "Trace logs" tab to the event side panel, listing the trace's logs as a flat chronological table over the same time window the waterfall uses. It appears on any row that carries a trace id and resolves a log source — a span (via the trace source's correlated log source) or a log (its own source). Previously the only route to a trace's logs was hunting for the green rows interleaved in the waterfall, which a log-heavy trace buries.

The tab honours the log filter set in the Trace tab's waterfall, and "Open in search" hands the same query to the search page — the trace scope plus whatever filter is set, in the language that filter runs in. Picking a log opens it in the panel: a breadcrumb hop from a span, or a row change from another log. Sorting is ascending, which inside a trace is execution order.
