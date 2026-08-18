---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
---

Fix filter sidebar values disappearing behind query proxies. Batched facet-value
queries (KV rollup and map text-index lookups) previously bound one query
parameter per key; with ~100 keys this exceeded the ClickHouse web client's URL
parameter budget, silently promoting the request to a multipart/form-data body
that proxy gateways can reject — every LowCardinality-column and map-attribute
filter then vanished without an error. Keys are now inlined as SQL-escaped
literals so the query rides the POST body. Also fixes an operator-precedence
bug that applied the rollup time filter to only the last OR branch, and hardens
the API's /clickhouse-proxy body forwarding (multipart passthrough, charset-
suffixed JSON content types, urlencoded re-serialization, accurate
Content-Length).
