---
'@hyperdx/common-utils': minor
---

Fix legacy `filters` migration to merge with the existing `where` clause instead of replacing it, so filters are never dropped when both are present.

- Add `mergeFilterStateIntoWhereClause` to AND existing `where` text with migrated filters (verbatim preservation, OR-wrapping of the residual, SQL-safe when needed).
- Fix invalid/incomplete Lucene clauses (e.g. mid-edit `service:`) so `replaceLuceneFacetClauses` now emits the new clause instead of no-oping, and `replaceFilterClauses` reports them via `getWhereParseError`.
- Support Lucene `NOT` negation (`NOT field:"v"`, `field:"v" AND NOT other:"w"`) in facet parsing so the sidebar shows an excluded (indeterminate) state instead of a checked one.
- Add `getUnrepresentableWhereReason` so cross-field `OR` queries can be surfaced to the user rather than silently misrepresented as AND.
- Add `emitLanguage` to `replaceFilterClauses` so facet clauses can be rewritten across query languages (Lucene ↔ SQL) while preserving non-facet text — used by the UI on language switch.
