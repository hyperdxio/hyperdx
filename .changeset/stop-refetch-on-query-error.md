---
'@hyperdx/app': patch
---

fix: Stop requesting additional search pages while a query is in an error state.
A failed page (for example a ClickHouse query timeout on a slow time window)
previously kept `hasNextPage` true, so the table re-issued the failing query and
stayed in a loading state that hid the error and reported zero results.
