---
'@hyperdx/api': patch
---

refactor(mcp): simplify ObjectId validation with shared helpers and schema-level checks

Add `mcpError()` and `validateObjectId()` utilities to reduce boilerplate
across MCP tool handlers. Move ObjectId validation into Zod input schemas
for always-required ID fields, eliminating inline checks entirely. Remaining
conditional checks use the new one-liner helper.
