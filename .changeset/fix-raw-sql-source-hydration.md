---
'@hyperdx/app': patch
---

fix: hydrate source metadata for raw SQL tiles in all chart rendering contexts

Raw SQL tiles referencing `$__sourceTable` or `$__filters` macros now correctly
resolve the source's table metadata regardless of the rendering context
(dashboards, notebooks, chart explorer). Previously, only the Dashboard Tile
component hydrated the `from`, `metricTables`, and other source-dependent fields
before query execution; other contexts passed the saved config directly, causing
macro expansion to fail with "Macro '$__sourceTable' requires a source to be
selected" despite the source being configured.
