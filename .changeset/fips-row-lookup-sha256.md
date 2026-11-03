---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/cli': patch
---

fix: use SHA256 instead of MD5 for JSON row lookup WHERE clauses so row
details and drill-down work on FIPS-enabled ClickHouse deployments
