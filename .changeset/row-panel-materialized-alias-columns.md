---
'@hyperdx/app': patch
---

feat: add an option to show MATERIALIZED and ALIAS columns in the row details panel

ClickHouse leaves MATERIALIZED and ALIAS columns out of `SELECT *`, so the row
details panel never showed them. A new "Show materialized and alias columns"
item in the properties view options menu, off by default, adds
`asterisk_include_materialized_columns` and `asterisk_include_alias_columns` to
the row query. It has no effect on a source with a Known Columns List, and a
value that the source's query settings give for either setting wins. If the row
fails to load while the option is on (for example, because the connection's user
is `readonly = 1`, or an ALIAS column cannot be evaluated), the error state
offers to turn the option off.
