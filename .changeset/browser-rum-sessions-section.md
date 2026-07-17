---
'@hyperdx/app': patch
---

feat(dashboards): expand the out-of-the-box Browser RUM dashboard with two new
sections.

**Sessions**: a **Recent Sessions** table lists client-side sessions (page
views, errors, distinct traces, user, service, last-active time) ordered by
recency; clicking a row drills into the Traces search view filtered to that
session, surfacing its client-side spans (the client-side trace).

**Memory**: per-page JS heap tiles (median and p90 used heap, plus a "Memory by
Page" table) sourced from `performance.memory.*` attributes on `documentLoad`
spans. These reflect Chromium visitors only (Firefox/Safari don't expose
per-page memory) and require a Browser SDK build that emits the heap attributes.

Implemented entirely via existing tile mechanisms (table `onClick`
drill-through, Markdown tiles, byte number-format) — no renderer changes.
