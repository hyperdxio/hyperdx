---
'@hyperdx/app': patch
---

fix: the search page filter key limit (Filter Keys Fetch Limit, default 100)
now applies to each Map column, so keys from `LogAttributes` no longer crowd out
`ResourceAttributes` and other Map columns
