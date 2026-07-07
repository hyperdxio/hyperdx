---
'@hyperdx/api': patch
---

Classify MCP tool errors as `user` (bad input, not-found) or `server` (infrastructure failure, timeout) so alerting rules can filter on `error_category=server` without noise from agent input mistakes. Adds `error_category` attribute to spans and the `hyperdx.mcp.tool.errors` metric counter. ClickHouse errors are auto-classified by inspecting the error type and walking the cause chain for TCP-level codes.
