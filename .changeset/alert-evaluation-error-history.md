---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Persist alert evaluation errors (query errors, timeouts, webhook failures) as
ERROR-state AlertHistory records instead of only a latest-only snapshot, and
surface them on the alerts page history strip with per-window error details.
Query timeouts are now classified separately (QUERY_TIMEOUT) with an
actionable message. Adds an alert detail page (/alerts/:id) with the alert's
query charted against its threshold and a paginated evaluation event stream.
