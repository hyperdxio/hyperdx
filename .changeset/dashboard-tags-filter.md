---
'@hyperdx/app': patch
---

fix: rework the dashboards list with tabs, sort, and tag filtering

Tagged dashboards no longer repeat under every tag they carry — the grid lists
each dashboard once. Tags are now a filter behind a fixed-width Tags button
with a count badge (a dashboard must carry every selected tag). Favorites
moved from a pinned row of cards into an "All /
Favorites / My dashboards" tab strip, and a sort control offers last updated
(default), name, and recently created. Import and New dashboard moved into the
page header.
