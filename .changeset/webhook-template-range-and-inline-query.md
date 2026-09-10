---
'@hyperdx/api': minor
'@hyperdx/app': minor
'@hyperdx/common-utils': minor
---

Report the whole alert condition in the `{{sourceQuery}}` webhook template
variable. It read only a chart's top-level `where`, so an alert defined by a
per-series `aggCondition` — a common shape — still rendered empty. The variable
now reports every part of the condition the alert query actually applies: a
chart's `where` plus the `aggCondition` of the series the alert reads, and a
saved search's `where` plus its pinned filters. A chart's pinned filters are
deliberately excluded, since a tile or inline alert does not apply them. The
value is truncated at 2000 characters.

Editing an alert off a `between` or `outside` comparator now clears the stored
`thresholdMax` instead of leaving the old bound on the document, where it was
also served by the alerts APIs and would advertise a range that no longer
fires. Webhook templates already guarded against this on read.

The webhook form's variable list and the API's fallback body template both
derive from one list in common-utils, which `buildWebhookTemplateVariables` is
typed against, so a variable cannot be added without appearing in both places.
The "Send test" payload carries a sample value for every variable, so a body
template can be checked before an alert fires.

The documented guard for an optional number is now
`{{#unless (eq thresholdMax undefined)}}` rather than `{{#if thresholdMax}}`,
which treats a legitimate bound of `0` as absent.
