---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

feat(mcp): add hyperdx_event_deltas tool

Add `hyperdx_event_deltas` MCP tool that compares two row groups (target
vs baseline) and ranks properties by how much their value distributions
differ. Same algorithm as the in-app Event Deltas view.

Extract shared event-deltas algorithm from the UI into
`@hyperdx/common-utils/src/core/eventDeltas.ts` so it can be used by
both the frontend and the MCP server.
