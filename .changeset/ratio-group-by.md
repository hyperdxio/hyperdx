---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
---

fix: support Group By on ratio charts

A ratio chart (`seriesReturnType: 'ratio'`) with a Group By previously collapsed
to a single line. Two issues in the multi-series merge: (1) rows were keyed by
time bucket only, so groups at the same bucket overwrote each other, and (2) the
ratio computation dropped every non-value column, discarding the group
dimension. The merge now keys by (time bucket + group dimensions) and the ratio
result carries the group columns through, so a grouped ratio renders one series
per group.

Grouped ratios use share-of-total semantics: each group's denominator is the
total of the denominator column across all groups in the same time bucket, so
the grouped lines are each group's contribution to the overall ratio and sum to
the ungrouped value (e.g. each tenant's share of the overall error rate), rather
than each group's in-group rate. Ungrouped ratios are unchanged (one row per
bucket → the bucket total is that row's denominator). A group absent from the
filtered numerator (e.g. a tenant with zero errors) contributes 0%, not N/A.

Also fixed alongside grouped ratios:

- A ratio whose two series resolve to the same value-column alias (e.g.
  `count(request)` filtered / unfiltered for an error rate) previously collapsed
  to one column and threw "Unable to compute ratio". The two operands are now
  kept distinct through the merge.
- The chart-level Group By for metric sources offered the union of every
  series' fields, which could suggest a native column that exists in one metric
  table (e.g. gauge) but not another (e.g. sum), making that series' query fail.
  It now offers only fields valid for every series (the intersection).
