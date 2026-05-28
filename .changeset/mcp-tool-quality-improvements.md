---
'@hyperdx/api': patch
---

feat(mcp): improve MCP tool quality — error hints, shared helpers, better messages

Extract duplicated ClickHouse error handling into a shared helper with
pattern-matched error hints (DateTime64 casting, AS alias quoting, response
size limits) so agents get actionable guidance on common failures. Add
reusable mergeWhereIntoSelectItems() helper for consistent top-level where
injection. Improve source/connection-not-found messages to suggest calling
hyperdx_list_sources.
