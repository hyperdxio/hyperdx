---
"@hyperdx/common-utils": patch
---

Skip metadata key/value rollup queries when the date range contains an Invalid Date instead of binding NaN timestamps as ClickHouse `Int64` params, which failed with `BAD_QUERY_PARAMETER` (457).