---
'@hyperdx/api': patch
---

fix(mcp): quote multi-word aliases in orderBy and steer event-pattern usage

Quote resolved aliases that are not bare identifiers (e.g. `"P95 Latency"`)
in `resolveOrderBy` output, in both the direct alias-match and aggFn-match
paths. Previously an unquoted multi-word alias produced SQL-invalid
`ORDER BY` output. Incoming orderBy values are stripped of surrounding
double-quote/backtick quoting before matching, so agents that already quote
the alias resolve correctly without being double-quoted.

Also document the alias-quoting requirement in the `orderBy` schema
descriptions, and update the `clickstack_event_patterns` tool description to
steer agents toward it (over `clickstack_search` / `clickstack_table`) when
exploring what messages, errors, or events exist.
