---
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

Fix JSON-backed search sidebar filters and metadata value queries to serialize resource attributes as ClickHouse string expressions, prioritize selected and pinned fields during facet loading, refresh loaded facet values when the active filter context changes, and surface load-more actions for empty facets that can fetch additional values.
