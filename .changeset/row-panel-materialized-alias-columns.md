---
'@hyperdx/app': patch
---

fix: show MATERIALIZED and ALIAS columns in the row details panel

The row details panel fetched the row with `SELECT *`, which ClickHouse runs
without MATERIALIZED and ALIAS columns, so those columns never appeared. The row
query now enables `asterisk_include_materialized_columns` and
`asterisk_include_alias_columns`, except for sources that use a Known Columns
List. A value set for either setting in the source's query settings still takes
precedence.
