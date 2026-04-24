---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

fix(alerts): apply `source.tableFilterExpression` in the scheduled alert task
so saved-search alert counts reconcile with what users see in the app search
page

The alert task's saved-search evaluator previously built its chart config
inline and omitted `source.tableFilterExpression`, while the app search page
prepended it as a SQL filter. When a Log source had that expression set, the
alert task counted rows the app was hiding, producing false-positive alerts
whose count did not match the app's results (HDX-4111).

Consolidate the saved-search → chart config assembly into a single shared
helper, `buildSearchChartConfig`, in `@hyperdx/common-utils`
(`core/searchChartConfig.ts`). The app search page, the alert preview chart,
and the scheduled alert task's `SAVED_SEARCH` branch now all route through
that helper, so `tableFilterExpression` (and the other "source × saved
search" fields) are applied identically across all three paths.
