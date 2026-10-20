---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

fix: make clickstack_event_patterns drill-down snippets executable

Each pattern's `whereSnippet` is now a SQL predicate (`whereLanguage: "sql"`) that keeps the template's token order and variable positions and includes the caller's filter and the source table filter, so passing it to `clickstack_search` returns the pattern's events. Before, a template like `Sending <*> rows` produced `Body:"Sending rows"`, which matched nothing, and map fields produced Lucene that failed to parse. `bodyExpression` now also accepts `JSONExtractString(<column>, '<key>', ...)` to mine a field inside JSON bodies, and the tool reports sample coverage and the actual trend bucket interval and boundaries.

`clickstack_event_patterns`, `clickstack_emerging_signals` and dashboard event-pattern tiles now apply the log source's `tableFilterExpression`, so their counts can drop for sources that set one. `minePatterns` now reports each cluster's own template; before, it could report the template of a different same-length cluster that some members did not fit.
