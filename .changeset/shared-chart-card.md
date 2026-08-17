---
'@hyperdx/app': patch
---

Introduce a shared `ChartCard` component that gives standalone charts the same
card treatment as custom dashboard tiles (bordered surface + full-bleed header
divider). The card header stays pinned while the card body scrolls (e.g. cards
wrapping a long list like "Top 20 Most Time Consuming Queries"): in card mode
the header is a fixed row and scrollable list content gets its own internal
scroll region, so the header no longer scrolls away once you pass the first
card-height of content. Migrate the Service
Dashboards (HTTP, Database, Errors, endpoint and DB-query side panels) and the
ClickHouse page from the old `ChartBox` wrapper to `ChartCard` so chart surfaces
look consistent across the app.
