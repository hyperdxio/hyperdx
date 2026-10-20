---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

perf: read Map keys and filter values from the text index of a sample of parts
instead of every part in the time range

Keys (e.g. `LogAttributes`) and text-indexed filter values come from a few
recent, mid-sized parts, plus the parts needed to cover each value of the
string primary key columns (e.g. every `ServiceName`), picked in the same query
that reads the index. The search page filter panel shows how many parts were
read and can read 10%, 50% or 100% of them to find rarer keys and values.
"Load more" on a filter still reads every part.
