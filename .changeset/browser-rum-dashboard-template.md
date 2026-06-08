---
'@hyperdx/app': minor
---

feat: add Browser RUM dashboard template

- New "Browser RUM" template in the dashboards gallery for browser sessions instrumented with the HyperDX Browser SDK (or any OTel browser instrumentation emitting a `rum.sessionId` resource attribute)
- Performance Overview section: page-view/session/error KPIs, Core Web Vitals (LCP/INP/CLS) p75, median/p75/p90 page-load percentiles, and long-task health
- Page Views Breakdown section: traffic grouped by URL, browser (parsed from the `http.user_agent` the document-load instrumentation emits), country, and device size (derived from `screen.xy`)
- Errors section with tabs for an overview, JS exceptions (by message and by page), and failing API calls
- Five dashboard-level filters: Service, Environment, Service Version, Page URL, and Country
- Top Countries tile and the Country filter populate when the OTel collector's `geoip` processor is enabled (geo can't be derived in the browser)
