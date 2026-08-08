---
'@hyperdx/common-utils': patch
---

Escape the Map subscript once in numeric and Bool field searches

The three equality branches for `Bool` and numeric value types escaped the
column expression as an identifier even when it was already a rendered map
subscript, so `Measures.latency_ms:250` wrapped `` `Measures`['latency_ms'] ``
in a second layer of backticks that ClickHouse reads as one identifier rather
than a map lookup. Quoting the term worked around it for numeric maps; for
`Map(String, Bool)` columns both spellings were affected.
