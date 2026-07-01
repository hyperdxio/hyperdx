---
'@hyperdx/app': patch
---

Fix "Add to Filters" on a value inside parsed JSON from a String column (for example `Body`) building invalid SQL. The `JSONExtractString(...)` expression the JSON viewer produces is now passed through unchanged instead of being mis-parsed as a dot-form Map sub-key and mangled into a query ClickHouse rejects.
