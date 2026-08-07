---
'@hyperdx/api': patch
---

Add MCP tool annotations (readOnlyHint, destructiveHint) to every MCP tool so
clients can distinguish read-only query tools from mutating and destructive
ones. Read/query tools are marked read-only, save/patch tools as
non-destructive writes, and delete tools as destructive.
