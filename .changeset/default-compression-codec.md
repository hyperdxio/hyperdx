---
'@hyperdx/otel-collector': patch
---

perf: compress the seed schemas with `ZSTD(3)` instead of `ZSTD(1)`

The seed schemas pinned `ZSTD(1)` on almost every column. Level 3 gives a better
compression ratio at a small insert-time CPU cost, without affecting reads, and
it is the default codec of ClickHouse since 26.9. It is pinned explicitly so
that older ClickHouse versions, whose default is `LZ4`, get it too. `Delta`
codecs drop their byte-size argument, which ClickHouse infers from the column
type. Only newly created tables are affected; existing tables keep their codecs.
