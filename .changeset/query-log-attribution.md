---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: attribute ClickHouse queries to the dashboard, tile, search or alert that
issued them

A row in `system.query_log` previously couldn't be attributed to the part of
HyperDX that produced it. Now every query HyperDX runs has a small JSON
`log_comment`, plus a `query_id` starting with `hdx-`.

Attribute load after the fact:

```sql
SELECT
    JSONExtractString(log_comment, 'surface') AS surface,
    JSONExtractString(log_comment, 'dashboard') AS dashboard,
    JSONExtractString(log_comment, 'tile') AS tile,
    count(),
    sum(read_rows)
FROM system.query_log
WHERE type = 'QueryFinish' AND log_comment != '' AND query_id like 'hdx-%'
GROUP BY ALL
ORDER BY sum(read_rows) DESC
```

Or spot a query while it is still running, in `system.processes`, where the
`query_id` names the surface with no JSON parsing needed.

The payload records which part of the product asked (a dashboard, a search, an
alert, an MCP tool, the metrics explorer, session replay, field lookups, and so
on), the dashboard and tile or saved search id, the source id, and on the server
the trace id of the request. Field lookups and autocomplete are labelled too, so
they can be told apart from a user's chart queries.

The one exception is the internal `system.settings` lookup, which has its
settings dropped to avoid a loop. It still gets a `query_id`.
