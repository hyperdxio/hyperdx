---
'@hyperdx/otel-collector': patch
---

feat(otel-collector): tune batch processor defaults for ClickHouse and make
them configurable

The bundled OTel Collector config now sets `processors.batch.send_batch_size`
to `10000` and `timeout` to `5s` (was upstream defaults of `8192` / `200ms`),
matching the values recommended by the ClickHouse exporter and ClickStack
docs. The upstream defaults were too aggressive for ClickHouse — they
produced very small inserts under low load, hurting insert performance and
inflating the number of MergeTree parts.

Each setting can also be overridden via environment variables:

- `HYPERDX_OTEL_BATCH_SEND_BATCH_SIZE` (default: `10000`)
- `HYPERDX_OTEL_BATCH_SEND_BATCH_MAX_SIZE` (default: `0`, meaning no upper
  bound)
- `HYPERDX_OTEL_BATCH_TIMEOUT` (default: `5s`)
