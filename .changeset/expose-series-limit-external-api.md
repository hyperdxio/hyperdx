---
'@hyperdx/api': patch
---

Expose `seriesLimit` on line and stacked_bar dashboard tiles via the External
API. Previously the field was silently dropped when saving these tiles (it now
round-trips on create, update, and get, matching the `limit` field already
supported on pie/bar tiles).
