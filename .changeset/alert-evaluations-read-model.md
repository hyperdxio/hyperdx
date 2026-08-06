---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': patch
---

Add the AlertHistory evaluations read model and GET /alerts/:id/evaluations
endpoint: per-window evaluation history scoped to a time range (clamped to the
retention window) with per-group breakdown for group-by alerts, evaluation
analytics fields, deduped error surfacing for ERROR-state windows, and
cursor-based pagination that always advances across gaps. Adds read-side
schema/type support for ERROR-state AlertHistory rows and evaluation analytics.
