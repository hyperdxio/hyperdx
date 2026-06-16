---
'@hyperdx/app': patch
---

feat(chart-explorer): duplicate a series in the chart builder

Add a Duplicate button to each series row in the chart builder that inserts a
copy of that series directly below it, so building a near-identical variant
(for example avg and p95 of the same column) no longer requires re-entering
every field by hand. "Add Series" still creates a blank series. The copy
starts with an empty alias so it does not collide with the original's alias in
the generated SQL.
