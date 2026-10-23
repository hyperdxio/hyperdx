---
'@hyperdx/api': patch
---

fix: Reject external API PromQL tiles that reference a non-PromQL source, and keep PromQL tiles when an MCP agent updates a dashboard

`/api/v2/dashboards` now returns a 400 when a PromQL tile's `sourceId` is not a PromQL source. MCP `clickstack_save_dashboard` updates no longer delete the PromQL tiles that MCP hides from agents.
