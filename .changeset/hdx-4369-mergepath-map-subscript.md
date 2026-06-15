---
"@hyperdx/app": patch
---

fix(row-panel): mergePath now emits string-key subscripts for Map columns,
preventing a crash when expanding rows with numeric-looking attribute keys

`mergePath` converted numeric path segments to 1-based array subscripts
(`[N+1]`) regardless of whether the parent column was a Map or an Array.
On a `Map(String, String)` column this produced SQL like `LogAttributes[2]`,
which ClickHouse rejects with `Illegal types of arguments:
Map(String, String), UInt8 for function arrayElement`. The grid row
"expand" view failed for any row whose attribute path included a
numeric-looking key under a Map column.

`mergePath` now accepts a `mapColumns` argument alongside `jsonColumns`.
For Map-typed parents, sub-keys always render as string subscripts
(`Map['1']`) regardless of whether the key looks numeric. The three
callers (`useAutoCompleteOptions`, `DBRowJsonViewer` via the row panels,
`DBSearchPageFilters`) now thread Map-column names from the source
schema. A new `useMapColumns` hook mirrors `useJsonColumns`.

Fixes HDX-4369.
