---
'@hyperdx/api': minor
---

Add enriched template variables to Generic and incident.io webhook bodies:
`{{alertId}}`, `{{status}}`, `{{alertType}}`, `{{comparator}}`, `{{threshold}}`,
`{{value}}`, `{{groupKey}}`, `{{sourceQuery}}`, `{{teamId}}`, `{{note}}`, and
ISO-8601 `{{startTimeISO}}` / `{{endTimeISO}}` alongside the existing Unix-ms
`{{startTime}}` / `{{endTime}}`.

Receivers can now route, filter and dedupe on an alert's identity and condition
without parsing the rendered message body. Existing templates are unaffected —
every new variable is additive and renders empty when an alert doesn't carry it.
