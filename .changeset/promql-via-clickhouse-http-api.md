---
'@hyperdx/api': minor
---

feat: run PromQL against ClickHouse through its Prometheus HTTP API

ClickHouse-backed `/query` and `/query_range` now proxy to the connection's `/prometheus/api/v1/*` endpoint (the `prometheus_api_v1` HTTP handler, ClickHouse 26.8+) instead of calling the `prometheusQuery`/`prometheusQueryRange` table functions. The `database` and `table` query parameters are forwarded so one handler serves any TimeSeries table. ClickHouse holds the Prometheus API forward-compatible while the TimeSeries engine is in preview; the table functions and inner-table schema are not. Bundled ClickHouse images move to 26.8.
