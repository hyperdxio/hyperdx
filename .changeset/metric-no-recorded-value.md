---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: leave metric points with no recorded value out of charts and alerts

When a scraped series goes away or a scrape fails, the collector's `prometheus`
receiver sends a point flagged "no recorded value" (a Prometheus staleness
marker), and the ClickHouse exporter stores it as zeros. Metric charts and
alerts read it as a real value: a gauge's `min` and `avg` dropped and `count`
included the series that went away, and a counter or histogram that came back
after the marker counted its whole total again. Metric queries now skip points
with this flag.
