---
'@hyperdx/common-utils': patch
---

HAVING, ORDER BY and LIMIT on multi-series metric charts now apply to the final joined result instead of leaking into each per-series branch. They reference the chart's output columns — operand aliases, formula names/aliases, the ratio column, group-by columns and the time bucket — so a HAVING like `"err rate" > 0.5` filters the joined rows, ORDER BY actually orders the result (previously it was applied per branch and then discarded by the join), and LIMIT/OFFSET paginate one consistent group set across all series.
