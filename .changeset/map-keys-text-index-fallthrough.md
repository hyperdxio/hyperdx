---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: fall back to the Map key scan when the text index read fails

`getMapKeys` returned an empty list whenever its `mergeTreeTextIndex` query
failed, so the rollup and bounded `mapKeys` scan paths never ran. ClickHouse
refuses `mergeTreeTextIndex` with `ACCESS_DENIED` on any table with a row
policy, which left search autocomplete with no Map keys on those tables. A
failed text index read now falls through to the next strategy.
