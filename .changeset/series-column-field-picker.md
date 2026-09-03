---
'@hyperdx/app': patch
---

Pick the column an aggregation reduces over from a list, rather than typing it
into a box labelled "SQL column". The series row now reads
`99th Percentile of Duration`, built as the same labelled field as the
`Group by` and `As <chart type>` pickers beside it, with a SQL tab still one
click away for expressions a list cannot hold like `Duration / 1e6`.

For aggregations the query layer coerces with `toFloat64OrDefault` — sum,
average, min, max, percentiles, increase — only numeric fields are offered.
That wrapper turns a non-numeric column into 0 rather than failing, so
averaging `ServiceName` used to buy a chart of zeroes with nothing to say it
had gone wrong. `Count Distinct` and `Any` pass the column through untouched
and still list every field, and `Custom` keeps its expression editor.

The popover behind Group by, event patterns and the new series column is now
one component instead of three near-copies.
