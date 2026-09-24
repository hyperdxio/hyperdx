---
'@hyperdx/app': minor
'@hyperdx/api': minor
'@hyperdx/common-utils': patch
---

feat: team setting to restrict the WHERE query language to Lucene or SQL

Team settings → Query settings now has a "Query language" option. Setting it to
"Lucene only" or "SQL only" locks every WHERE search input to that language and
hides the language switch. Inputs that only accept one language are unaffected.
