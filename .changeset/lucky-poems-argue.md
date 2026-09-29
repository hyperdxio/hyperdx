---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Highlight the active Lucene query's terms in the search results table, so it is
visible why each row matched. Bare terms highlight in every column; field-scoped
terms (`ServiceName:checkout`) only in that column. Negations, ranges and
regexes are skipped. Find-box matches keep their own colour where the two
overlap, and a toolbar toggle turns query highlighting off.
