---
"@hyperdx/api": patch
---

feat: include the source Section in MCP source tools

The `clickstack_list_sources` and `clickstack_describe_source` MCP tools now
return the optional Section label on each source, so agents see the same source
grouping that the source selector shows. Sources without a section are
unchanged.
