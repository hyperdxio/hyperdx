---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: don't scan the whole table to discover Map keys

`getMapKeys` only applied a time predicate when the caller passed both a date
range and a timestamp expression; otherwise the raw `sampledKeys` scan ran with
no `WHERE` and touched every part of the table. It now defaults a missing date
range to the last 24 hours and skips the raw scan entirely when there is no
timestamp expression to filter on. The chart, alert and dashboard-filter
editors pass the source and date range they already have so Map keys keep
autocompleting there.
