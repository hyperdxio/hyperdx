---
'@hyperdx/api': minor
---

Fill in two gaps in the Generic and incident.io webhook template variables. A
`between` or `outside` alert now carries its upper bound as `{{thresholdMax}}`,
so a receiver can reconstruct the condition instead of seeing one bound of two.
And `{{sourceQuery}}` now reports the query for every alert source: it read
only a saved search's `where` expression, leaving dashboard-tile and
inline-query alerts empty. Raw SQL and PromQL charts report their SQL template
and PromQL expression respectively.

`{{thresholdMax}}` is gated on the comparator rather than read straight off the
alert: switching an alert off a range comparator leaves the old bound on the
document, and reporting it would advertise a range that no longer fires.
