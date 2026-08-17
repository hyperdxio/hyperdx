---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

Fix multi-series metric charts mixing float and integer aggregations (e.g. histogram quantile + histogram count) failing with "No value columns found in result column metadata". The composed UNION ALL query now normalizes every series value to Float64, so the merged column type is deterministic instead of erroring with NO_COMMON_TYPE or producing a Variant(Float64, Int64) column depending on the ClickHouse server's `use_variant_as_common_type` setting. As a defensive layer, all-numeric `Variant(...)` result columns (e.g. from raw-SQL charts) are now also classified as numeric.
