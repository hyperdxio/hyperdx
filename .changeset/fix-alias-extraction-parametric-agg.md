---
"@hyperdx/common-utils": patch
---

fix: handle ClickHouse parametric aggregate functions in alias extraction. `chSqlToAliasMap` now parses selects containing the double-paren `func(params)(args)` form (e.g. `groupUniqArray(20)(col)`, `quantile(0.9)(col)`) instead of throwing and logging "Error parsing alias map" — which surfaced on every value-autocomplete fetch.
