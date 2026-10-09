---
'@hyperdx/app': minor
'@hyperdx/api': minor
'@hyperdx/common-utils': minor
---

Add native NetFlow sources and monitoring with configurable column mappings,
Akvorado schema detection, sampling-aware traffic charts, top talkers, exporter
and interface breakdowns, and flow details. NetFlow tables also support Search
and custom charts.

Support Lucene search with field autocomplete on the NetFlow page, combining
search queries with quick filters across charts and flow records.

Add clickable include/exclude filters to flow IPs, protocols, exporters, and
interfaces, with removable selections preserved in the URL.

Show table column suggestions when focusing an empty NetFlow search input.

Size time-chart Y axes to their formatted labels so rate units do not wrap or
get clipped.

Avoid sending API proxy headers when querying ClickHouse directly in local mode.

Add a Sankey visualization with ordered table dimensions, sampling-adjusted path
weights, average bit rates, configurable path limits, and clickable shared
filters. Include interface classifications in the local demo data.
