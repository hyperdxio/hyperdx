---
'@hyperdx/api': minor
---

feat: Support PromQL dashboard tiles in the external API

`/api/v2/dashboards` now returns PromQL tiles and accepts them on create and update, as `configType: "promql"` with a `sourceId` and a list of `expressions`. Previously PromQL tiles were left out of responses, so saving a dashboard back through the API deleted them. MCP dashboard tools still hide PromQL tiles until they support editing them.
