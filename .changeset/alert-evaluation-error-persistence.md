---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
---

Persist alert evaluation errors (query errors, timeouts, webhook failures) as
ERROR-state AlertHistory records instead of only a latest-only snapshot,
upserted per evaluation window so retries collapse into a single row. Query
timeouts are classified separately (QUERY_TIMEOUT, including timeouts wrapped
by the ClickHouse query client) with an actionable message. ERROR rows are
excluded from scheduling/backfill computations so failed windows are still
retried and backfilled, and evaluation analytics (query/webhook durations,
backfilled buckets) are recorded on every history row.
