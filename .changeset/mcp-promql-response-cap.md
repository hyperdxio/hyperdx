---
'@hyperdx/api': patch
---

fix: Refuse Prometheus endpoint responses over 8 MB in MCP PromQL label lookups and queries, instead of buffering them whole
