---
'@hyperdx/api': minor
---

feat: accept exemplar settings on API- and agent-authored dashboard tiles

`enableExemplars` and `exemplarTraceSourceId` are now accepted on line and
stacked-bar tiles through the external v2 API and the MCP dashboard tools,
survive the tile conversion in both directions, and are documented in the
OpenAPI spec. Previously they validated on write and were dropped before
persistence, so they could not be set through any surface.

`exemplarTraceSourceId` is checked three ways, because a marker's "view trace"
link is only as good as the source behind it: an ObjectId on both surfaces, the
source must exist for the team, and it must actually be a Trace source. The
existence and kind checks mirror the heatmap gate. Without them a well-formed id
for a metric source saved cleanly and left every marker linking nowhere.
