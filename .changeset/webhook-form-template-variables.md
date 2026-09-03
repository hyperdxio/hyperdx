---
'@hyperdx/app': patch
---

List every supported template variable in the webhook form, including the
enriched set added to Generic and incident.io bodies (`{{alertId}}`,
`{{status}}`, `{{alertType}}`, `{{comparator}}`, `{{threshold}}`,
`{{thresholdMax}}`, `{{value}}`, `{{groupKey}}`, `{{sourceQuery}}`,
`{{teamId}}`, `{{note}}` and ISO-8601 `{{startTimeISO}}` / `{{endTimeISO}}`).
Each variable now carries a one-line description, so a webhook body can be
written without leaving the form.
