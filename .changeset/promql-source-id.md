---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: Resolve PromQL queries through the source instead of a caller-supplied connection and table

The `/api/v1/prometheus/*` routes now take `sourceId` instead of `connectionId`, and read the connection and TimeSeries table from that PromQL source. Caller-supplied `database`/`table` params are ignored for ClickHouse and no longer forwarded to external Prometheus endpoints. Saved PromQL chart configs now require `source` and no longer persist `connection`, so provisioned dashboards with PromQL tiles must set `source`.
