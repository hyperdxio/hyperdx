---
'@hyperdx/api': minor
---

Support inline chart alerts (source `inline` + `chartConfig`) in the external
API v2 and the MCP `clickstack_save_alert` / `clickstack_get_alert` tools.
Inline alerts can now be created, updated, listed, and deleted through
`/api/v2/alerts` using the same tile-config dialect as v2 dashboards, with the
same validation rules as the internal API: display-type allowlist, metric
formula validation, the formula source-kind gate, raw SQL template validation,
and team-scoped source/connection ownership. Passing a `chartConfig` to a
`tile` or `saved_search` alert is now rejected instead of silently dropped,
and reading an inline alert whose config carries internal-only fields omits
`chartConfig` rather than returning a lossy approximation.

Also fixes the external v2 dashboards dialect dropping the gauge `isDelta`
flag when converting tile select items to the internal shape.
