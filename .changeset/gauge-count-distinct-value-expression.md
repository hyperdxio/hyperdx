---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: count distinct attribute values on gauge metric charts

`count_distinct` on a gauge metric ignored its value expression and counted the
distinct metric values instead, so counting `Attributes['name']` on an info
metric returned 1 or 2. It now counts the given expression. The default `Value`
expression and every other aggregation still use the bucketed metric value.
