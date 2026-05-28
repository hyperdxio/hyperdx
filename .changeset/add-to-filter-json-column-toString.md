---
"@hyperdx/app": patch
---

fix: "Add to Filters" on a JSON-typed ClickHouse column no longer produces an
unparseable Lucene query

Previously, clicking "Add to Filters" on a field under a JSON column wrapped
the field path with `toString(...)` before handing it off as a Lucene filter
key. Lucene's grammar forbids parentheses inside field names, so the resulting
condition like `toString(JSONColumn.\`foo\`):"…"` failed to parse with
`Expected … but ":" found.`

The handler now passes the clean dot-notation path (e.g. `JSONColumn.foo`)
to the filter setter.
