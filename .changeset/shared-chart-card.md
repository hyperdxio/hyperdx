---
'@hyperdx/app': patch
---

Introduce a shared `ChartCard` component that gives standalone charts the same
card treatment as custom dashboard tiles (bordered surface + full-bleed header
divider). The card header is sticky, so it stays visible while the card body
scrolls (e.g. cards wrapping a long table or list). Migrate the Service
Dashboards (HTTP, Database, Errors, endpoint and DB-query side panels) and the
ClickHouse page from the old `ChartBox` wrapper to `ChartCard` so chart surfaces
look consistent across the app.
