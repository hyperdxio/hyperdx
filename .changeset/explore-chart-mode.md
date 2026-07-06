---
"@hyperdx/app": minor
---

Unify Search and Chart Explorer into a single "Explore" page. The analysis mode
(Events / Chart / Deltas / Patterns) is now a top-level control in the page
header, and the page-level source, query, and time controls are the single
source of truth across all modes: in Chart mode the embedded chart builder
hides its own duplicate source/name/time controls and inherits the current
source and query, so you can pivot from raw events to an aggregated chart
without re-entering anything. The AI assistant carries over into chart mode,
the primary nav entry is renamed from "Search" to "Explore", the standalone
Chart Explorer nav entry is removed, and the legacy `/chart` route now
redirects to the Explore page's chart mode (preserving deep links).
