---
"@hyperdx/common-utils": patch
---

fix: unknown Lucene field no longer falls through as a raw SQL identifier

A Lucene field that doesn't resolve to a real column is now gated on the set of known SELECT aliases — a known alias renders as a bare identifier (ClickHouse resolves SELECT aliases in WHERE) while anything genuinely unknown renders the no-match predicate `(1 = 0)` instead of being injected as raw SQL that ClickHouse rejects with "Unknown identifier" (which previously killed both the histogram and the row table at once). As part of this, `chSqlToAliasMap` now parses selects containing ClickHouse parametric aggregate functions — the double-paren `func(params)(args)` form (e.g. `groupUniqArray(20)(col)`, `quantile(0.9)(col)`) — instead of throwing and logging "Error parsing alias map" on every value-autocomplete fetch.
