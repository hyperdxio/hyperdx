---
'@hyperdx/app': patch
---

fix: Don't auto-infer metric tables when editing a metrics source that already has tables configured. Schema inference now only runs for brand-new sources, so an existing source with a missing table (e.g. exponential histogram) no longer appears populated with values that were never saved.
