---
'@hyperdx/app': patch
---

Fix the search page defaulting to an incompatible source. When no source is set
in the URL, the page now defaults to the first log or trace source (preferring
enabled sources) instead of the first configured source, which could be a metric
or session source that shows no data and triggers a compatibility warning.
