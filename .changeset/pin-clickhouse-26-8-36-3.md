---
'@hyperdx/api': patch
---

fix: pin bundled ClickHouse to 26.8.36.3 for a security fix

The all-in-one image and the Docker Compose files now use
`clickhouse/clickhouse-server:26.8.36.3-alpine` instead of the floating
`26.8-alpine` tag.
