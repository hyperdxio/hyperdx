---
'@hyperdx/api': minor
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
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

Editing an alert off a range comparator now clears the stored `thresholdMax`
instead of leaving the old bound on the document, where it was also served by
the alerts APIs. The "Send test" payload carries sample values for the enriched
variables, so a body template using them can be checked before an alert fires.

The webhook form's "body supports the following variables" list now advertises
the full set rather than the original seven. It and the API's fallback body
template both derive from one list in common-utils, which
`buildWebhookTemplateVariables` is typed against, so a variable cannot be added
without appearing in both places.
