---
'@hyperdx/api': patch
---

Add MCP tool annotations (readOnlyHint, destructiveHint) to every MCP tool so
clients can distinguish read-only query tools from mutating ones. Read/query
tools are marked read-only; save/patch and delete tools are marked destructive
since they can overwrite or remove existing resources. Hints that would be
redundant against the MCP spec defaults are omitted (e.g. destructiveHint is
left off read-only tools, where it has no meaning).
