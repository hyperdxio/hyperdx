---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Add an alert detail page (/alerts/:id) with the alert's query charted against
its threshold, a widened evaluation-history strip, and a paginated evaluation
event stream (per-group breakdown for group-by alerts, evaluation analytics
columns, time-range-scoped cursor pagination). Adds the
GET /alerts/:id/evaluations endpoint and the AlertHistory read-side support
for ERROR-state rows and evaluation analytics; the alerts page history strip
renders errored evaluation windows with per-window error details.
