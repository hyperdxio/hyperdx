---
'@hyperdx/common-utils': patch
---

fix: recover the SELECT-alias map when a query has ClickHouse-specific SQL the parser rejects

`chSqlToAliasMap` returned an empty map whenever the rendered query contained
SQL that node-sql-parser's Postgresql dialect cannot parse, for example a
sampling CTE with `greatest(CAST(total / N AS UInt32), 1)`. An empty alias map
drops the `WITH` clauses that define the source's select aliases, so filters on
aliased columns (Event Patterns, histogram, alerts) failed with `Unknown
identifier`. It now falls back to parsing only the outer SELECT projection,
which is all the alias map needs, so the aliases are recovered even when the
rest of the statement is unparseable.
