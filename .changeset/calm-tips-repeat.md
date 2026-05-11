---
"@hyperdx/otel-collector": minor
---

feat: new optimized otel schema based on weeks of benchmarks.

The Primary Key is now grouped by `toStartOfFiveMinutes`. At extremely large
data sizes, it may be helpful to reduce granularity to 1 minute instead of 5.
Bloom Filter indexes can be used instead, but full text search performs better
across the board. Additionally, tests show that TimestampTime is effectively
not necessary, which is especially true with data grouped by 5 minute
boundaries by default.
