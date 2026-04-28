---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

refactor(alerts/search): consolidate the saved-search → chart-config builder
into a single shared helper, `buildSearchChartConfig`, in
`@hyperdx/common-utils/core/searchChartConfig.ts`. The app search page, the
alert preview chart, and the scheduled alert task's `SAVED_SEARCH` branch now
all route through it, so `tableFilterExpression`, `implicitColumnExpression`,
sample-weight expressions, SELECT precedence, and the `count()` default
SELECT shape are applied identically by construction.

Behavior fixes that fall out of consolidation:
- The alert task and the alert preview now apply `source.tableFilterExpression`
  on Log sources, matching what the search page already did.
- A latent bug in the search-page builder is fixed: a non-null `filters`
  array no longer silently drops the `tableFilterExpression` SQL filter via
  spread-overwrite.
