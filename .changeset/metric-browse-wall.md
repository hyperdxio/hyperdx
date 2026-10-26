---
'@hyperdx/app': minor
---

feat: browse-first metric explorer in Explore

Metric sources now open on a "Browse" view: a wall of every metric the source
reports, each already charted with a default aggregation for its kind (avg for
gauges, increase for sums, p95 for histograms). Metrics are grouped by the
service or host that reports them and banded by what they measure (latency,
errors and counts, throughput, saturation, queue depth), classified from the
declared unit, then the name's tail, then the kind; the rest are shown as
Unclassified.

A rail and one search box narrow the wall by quantity, attribute, attribute
value, kind and unit. Clicking a tile opens it in place with the other
aggregations for its kind, split-by chips ranked by cardinality, and a choice
of one chart or small multiples on a shared scale. "Edit as chart" carries the
same query into the time series view.
