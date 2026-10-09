---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Highlight the active Lucene query's terms in the search results table, so it is
visible why each row matched. Bare terms highlight in every column; field-scoped
terms (`ServiceName:checkout`) only in that column. Negations, ranges and
regexes are skipped. Query terms get a yellow wash and find-box matches keep
their solid yellow, so the two stay apart where they overlap, and a toolbar
toggle turns query highlighting off.
