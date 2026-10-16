---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: Floor the time filter start to the precision of a coarse timestamp column (DateTime, DateTime64 below ms) when a finer column also filters the range, so a sub-second start no longer drops the rest of that tick; make the external API v2 search `maxResults` cap configurable via `EXTERNAL_API_SEARCH_MAX_RESULTS` (defaults to 2000, the previous hardcoded value)
