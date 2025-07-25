---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
"@hyperdx/app": patch
---

fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.
