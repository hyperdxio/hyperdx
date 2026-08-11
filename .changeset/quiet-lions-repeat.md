---
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Unify the filter sidebar and query input into a single `where` clause so they always stay in sync.

Previously the sidebar filters and the query box held independent state — selecting a value in the sidebar applied it to the search but it never appeared in the query input, and the two could silently drift out of sync. This change makes the `where` clause the single source of truth for both.

**What changed (user-visible):**

- Clicking a value in the sidebar rewrites the matching facet clause directly in the query box (e.g. clicking `error` in the Level facet writes `level:"error"` into the box).
- Editing the query box also updates the sidebar checkboxes — the sidebar reads its checked state back from the `where` text.
- Free-text and complex query content is preserved — only the specific facet clauses are rewritten.
- Works for both query dialects (Lucene and SQL).
- The separate `filters` URL param is removed; a one-time migration moves any legacy persisted filters into the `where` clause on first load.

**New internals in `@hyperdx/common-utils`:**

- `parseWhereClauseToFilterState` — parse a `where` string back into `FilterState`.
- `filterStateToWhereClause` — render `FilterState` to a `where` string.
- `replaceFilterClauses` — surgically replace only the facet clauses in a `where` string, preserving everything else. Supports an `emitLanguage` option to translate facets across query dialects.
- `mergeFilterStateIntoWhereClause` — AND a legacy `filters` state into an existing `where` clause without dropping either side (used for the one-time URL-param migration).
- `dateTimeValueExpr` extracted to `common-utils/core/dateTimeValue.ts` to avoid duplication between `filters.ts` and `queryParser.ts`.
