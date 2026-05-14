---
'@hyperdx/api': patch
---

feat(mcp): rewrite dashboard authoring prompts and expose `filters` on `hyperdx_save_dashboard`

The `create_dashboard` prompt now leads with a design checklist (alias every select item including number tiles, schema gap on `groupBy` so tables don't render `arrayElement(SpanAttributes, '...')` as the column header, RED columns with aliases, per-series `numberFormat` for durations, `groupByColumnsOnLeft` for inventory tables, dashboard-level filters instead of per-tile `where` literals, one-metric-per-tile for metric sources, required containers at five or more tiles, post-save validation of every tile, no title-recap markdown). The wall-of-JSON canonical example is gone; the `dashboard_examples` patterns carry the concrete shapes.

The `dashboard_examples` set is replaced with four verified patterns (`service_inventory`, `service_detail`, `log_analytics`, `backend_dependencies`) plus the existing `infrastructure_sql`. Each non-SQL example leads with a "When to use" header and a "Why this shape" note so the model picks by intent, not by surface keyword match. Examples were built and rendered on a live dev stack before landing.

The `query_guide` prompt gains a `DASHBOARD FILTERS` section that documents the `filters: [{ type, name, expression, sourceId, where?, whereLanguage? }]` shape, a `NUMBER FORMAT` section that explains the per-series vs. chart-level distinction, and a `PER-TILE TYPE CONSTRAINTS` note that metric tiles take exactly one select item per tile.

`hyperdx_save_dashboard` now accepts `filters` on its input schema, reusing `externalDashboardFilterSchemaWithId` so the MCP and REST surfaces stay in lockstep and the existing `convertExternalFiltersToInternal` helper handles the conversion without translation. Filters round-trip through create, get, and update.

Voice pass: every prompt string is now em-dash-free.
