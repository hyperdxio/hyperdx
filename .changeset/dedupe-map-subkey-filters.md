---
'@hyperdx/app': patch
---

fix: collapse duplicate map sub-key entries in the search filter sidebar (HDX-4340)

A map sub-field stored in `filterState` under dot notation (e.g. `LogAttributes.time`,
from a Lucene URL round-trip) and the same key returned by the facet query under
bracket notation (e.g. `LogAttributes['time']`) no longer render as two separate
accordion items. The merged entry keeps the bracket form so "Load more" stays
valid, and the user's selection still resolves via a tolerant filterState lookup.
