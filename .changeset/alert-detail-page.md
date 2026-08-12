---
'@hyperdx/app': minor
---

Add an alert detail page (/alerts/:id) with the alert's query charted against
its threshold, a widened evaluation-history strip, and a paginated evaluation
event stream (per-group breakdown for group-by alerts, evaluation analytics
columns, time-range-scoped cursor pagination). The alerts page history strip
renders errored evaluation windows with per-window error details. Gated behind
NEXT_PUBLIC_ENABLE_ALERT_DETAILS (default off).
