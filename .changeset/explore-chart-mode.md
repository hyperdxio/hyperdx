---
"@hyperdx/app": minor
---

Unify Search and Chart Explorer into a single "Explore" page. The search page
gains a "Chart" mode (alongside Results Table / Event Deltas / Event Patterns)
that embeds the chart builder and AI assistant, seeded from the current source
and query so you can pivot from raw events to an aggregated chart without
losing context. The primary nav entry is renamed from "Search" to "Explore",
the standalone Chart Explorer nav entry is removed, and the legacy `/chart`
route now redirects to the Explore page's chart mode (preserving deep links).
