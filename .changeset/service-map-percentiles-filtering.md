---
'@hyperdx/app': patch
---

feat(service-map): server-side filtering, latency percentiles, throughput & focus

The Service Map gains server-side filtering (Lucene/SQL `where` plus a
service-name multi-select with inbound/outbound neighbor expansion), latency
percentiles (p50/p95/p99) and request throughput (req/s) in node and edge
tooltips, a "Focus" action to scope the map to a service and its immediate
dependencies, and node sizing by total throughput (incoming + outgoing).
Percentiles are computed server-side via a single GROUPING SETS query.
