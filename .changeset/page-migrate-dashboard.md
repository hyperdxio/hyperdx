---
'@hyperdx/app': patch
---

chore: migrate the custom Dashboard page to shared `PageLayout` / `PageHeader`. Breadcrumbs, the editable dashboard name, dashboard actions (Favorite, Tags, Menu), and the "Created by … Updated …" meta now live in a single page header, while the query toolbar (SQL/Lucene WHERE, time range, granularity, Live, refresh, edit filters, Run) is pinned to the top of the scroll container as a dedicated sticky row — the chrome above scrolls away and only the toolbar follows the user. The "Updated …" meta moves to the right side of the breadcrumbs row instead of sitting as a separate body line.

`PageHeader` gains a `stickyRow` slot that any page can use to declare a single row that should be the only pinned element, with the rest of the header treated as scrolling chrome. Other pages are unaffected — a `PageHeader` without `stickyRow` keeps the existing fully-sticky behavior.
