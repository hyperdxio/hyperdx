---
'@hyperdx/app': minor
---

Add a "Trace logs" tab to the event side panel, listing every log in the trace as a flat chronological table. It appears on any row that carries a trace id and resolves a log source — a span (via the trace source's correlated log source) or a log (its own source, with the row you came from highlighted). Previously the only route to a trace's logs was hunting for the green rows interleaved in the waterfall, which a log-heavy trace buries.

The tab shares the waterfall's log filter, so a filter set in either place applies to both, and picking a log opens it in the panel: a breadcrumb hop from a span, or a row change from another log. Sorting is ascending, which inside a trace is execution order.
