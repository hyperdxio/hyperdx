---
'@hyperdx/api': patch
---

feat(mcp): add hyperdx_describe_source tool and slim list_sources to catalog

Add `hyperdx_describe_source` — returns full column schema, map attribute
keys, and sampled low-cardinality values (SeverityText, StatusCode,
ServiceName, etc.) for a single source. Uses existing rollup tables for
performant value sampling.

Slim `hyperdx_list_sources` to a lightweight MongoDB-only catalog (no
ClickHouse queries). Source tools moved to a dedicated `tools/sources/`
module.

All query tool descriptions and prompts updated to reference the two-step
`list_sources → describe_source` discovery workflow.
