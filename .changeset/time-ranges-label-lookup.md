---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

fix: PromQL label lookups (dashboard variables, label autocomplete) now work on TimeSeries tables of schema version 8, the default from ClickHouse 26.10. These keep each series' time range in a separate time ranges table instead of the tags table's min_time/max_time, so match[] failed with "requires store_min_time_and_max_time = 1" and time-bounded lookups read the whole tags table.
