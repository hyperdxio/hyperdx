---
'@hyperdx/common-utils': minor
---

"Convert to SQL" now supports multi-series, ratio, and formula metric charts. The composed UNION ALL + pivot query is emitted as a macro-based raw-SQL template with a `$__sourceTable(<metricType>)` macro per series branch, instead of returning a "cannot be auto-converted" error. Non-time-series metric charts remain unsupported, matching the existing single-series restriction.
