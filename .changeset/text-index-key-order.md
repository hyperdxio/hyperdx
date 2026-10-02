---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: rank Map keys by frequency when a text index serves key discovery

The two `mergeTreeTextIndex` paths in `getMapKeys` grouped keys and applied
`LIMIT maxKeys` with no `ORDER BY`, so on a column with more keys than the
limit the filter sidebar showed an arbitrary subset. They now order by
`sum(cardinality) DESC, key`, which keeps the most frequent keys, as the key
rollup path already does with `sum(count) DESC`.
