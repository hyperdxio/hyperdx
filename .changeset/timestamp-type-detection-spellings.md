---
'@hyperdx/common-utils': patch
---

Detect ClickHouse timestamp types that carry a timezone or a type wrapper

`DateTime('UTC')` was not classified as a DateTime, so a source whose timestamp
column listed both a `Date` partition column and a `DateTime` column bucketed
charts on the `Date` — collapsing a whole day into one bar at midnight. The time
filter also only wrapped bounds in `toDate()` for an exact `Date` type, so a
`Date32` or `Nullable(Date)` column was compared against a DateTime bound and
lost the whole start day.
