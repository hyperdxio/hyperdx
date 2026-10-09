---
'@hyperdx/api': patch
---

fix(mcp): return partial `clickstack_describe_source` results on timeout

The describe deadline is raised from 10s to 30s to match the other MCP query
tools. When it is hit, the tool now returns the schema and samples gathered so
far, flagged `partial` with `skippedStages`, instead of failing outright. It
only returns a timeout error if the column schema never loaded.
