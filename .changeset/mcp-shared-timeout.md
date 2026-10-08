---
'@hyperdx/api': patch
---

refactor(mcp): share wall-clock timeout handling across MCP tools via
`runWithTimeout`, and source the 30s ClickHouse query cap from one constant.
