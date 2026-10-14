---
'@hyperdx/app': patch
---

fix: a multi-column `ORDER BY` without an explicit `ASC`/`DESC` (e.g.
`(TimestampTime, Timestamp)`) no longer corrupts the search query into
`(TimestampTime, ASC`. The sort-state parser now only maps a single bare column
with an explicit direction onto a table header and otherwise leaves the raw
`ORDER BY` string untouched.
