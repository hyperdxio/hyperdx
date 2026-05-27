---
"@hyperdx/common-utils": patch
---

fix: escape colons in Lucene field names so filters on Map sub-keys containing
`:` (e.g. `LogAttributes['foo:bar']`) parse correctly

`filtersToQuery` now backslash-escapes `:` and `\` in the emitted Lucene field
name, and `parseLuceneFilter` + the SQL serializer decode those placeholders
when consuming the AST so the original key is restored end-to-end.
