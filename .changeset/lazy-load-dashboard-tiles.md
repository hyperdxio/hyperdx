---
'@hyperdx/app': minor
---

feat: lazy-load dashboard tiles based on viewport visibility

Dashboard tiles now only run their ClickHouse queries once they scroll into the browser viewport, instead of every tile querying on page load. A tile loads the first time it becomes visible and keeps its data afterward. This significantly reduces the number of queries fired when opening dashboards with many tiles.
