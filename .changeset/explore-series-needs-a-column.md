---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

Picking an aggregation that needs a column no longer breaks the chart before
you can name one. Explore commits a series edit as you make it, so choosing
"99th percentile" used to query immediately with no column and fail on
`An incorrect number of arguments was specified for function 'toString'` — a
ClickHouse parser error that never mentions the column you were about to pick.
Explore now waits, and says which field it is waiting for.

The query layer no longer accepts a blank aggregation column either. It treated
an empty expression as present and rendered `toFloat64OrDefault(toString())`;
it now reports the missing column, as it already did when the expression was
absent entirely. `count` is unaffected, being the one aggregation that takes no
argument.
