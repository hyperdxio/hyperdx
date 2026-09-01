---
'@hyperdx/api': minor
---

Support inline chart alerts (source `inline` + `chartConfig`) in the external
API v2 and the MCP `clickstack_save_alert` / `clickstack_get_alert` tools.
Inline alerts can now be created, updated, listed, and deleted through
`/api/v2/alerts` using the same tile-config dialect as v2 dashboards, with the
same validation rules as the internal API (display-type allowlist, metric
formula validation, raw SQL template validation, and team-scoped
source/connection ownership).
