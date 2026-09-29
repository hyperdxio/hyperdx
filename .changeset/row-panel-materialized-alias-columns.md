---
'@hyperdx/app': patch
---

feat: add an option to show MATERIALIZED and ALIAS columns in the row details panel

ClickHouse leaves MATERIALIZED and ALIAS columns out of `SELECT *`, so the row
details panel never showed them. A new "Show materialized and alias columns"
item in the properties view options menu, off by default, adds
`asterisk_include_materialized_columns` and `asterisk_include_alias_columns` to
the row query. It has no effect on a source with a Known Columns List, and a
value that the source's query settings give for either setting wins. If the
connection's user cannot change these settings (for example, `readonly = 1`),
the panel loads the row without them.
