---
"@hyperdx/api": patch
"@hyperdx/common-utils": patch
---

refactor(mcp): rename all MCP tool prefixes from `hyperdx_` to `clickstack_`

Rename the MCP server name from `hyperdx` to `clickstack` and update all 19
tool names (e.g. `hyperdx_search` → `clickstack_search`), along with
descriptions, prompts, error messages, and test references.
