---
'@hyperdx/api': minor
---

Fill in two gaps in the Generic and incident.io webhook template variables. A
`between` or `outside` alert now carries its upper bound as `{{thresholdMax}}`,
so a receiver can reconstruct the condition instead of seeing one bound of two.
An inline-query alert now reports its own builder `where` expression or raw SQL
in `{{sourceQuery}}`, which was previously always empty because only a saved
search's query was read.

`{{thresholdMax}}` is gated on the comparator rather than read straight off the
alert: switching an alert off a range comparator leaves the old bound on the
document, and reporting it would advertise a range that no longer fires.
