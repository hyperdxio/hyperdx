---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
---

Move the pinned-filter query parser (`parseQuery`) into `@hyperdx/common-utils`
as the inverse of `filtersToQuery`, and add an `isRenderablePinnedFilter`
helper. The app re-exports `parseQuery` from its previous location, so there is
no behavior change in the UI. The helper lets the external saved-search API
validate that a pinned filter will actually render as a sidebar facet (a
`type: 'sql'` `<column> IN (...)` / `NOT IN` / `BETWEEN` predicate) and reject
shapes that would be stored but never shown.
