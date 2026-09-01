---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Fixed multi-series metric charts failing with "Unknown expression or function identifier" when sorted by an expression group-by (e.g. `ResourceAttributes['service.name']`). Table tiles default their ORDER BY to the group-by text, so any multi-series metric table grouped by a resource/attribute-derived expression failed to render. Such sort expressions are now evaluated inside each per-series branch through internal companion columns instead of being re-evaluated in the composed outer query, where the source columns no longer exist.
