---
'@hyperdx/app': patch
---

fix: browser ClickHouse queries are no longer left uncapped when no query timeout is configured. `ClickhouseClient` only sends `max_execution_time` when it is given a positive `queryTimeout`, and most call sites built a client without one — including the search results table, which passes the team's configured timeout straight through and so passed `undefined` for any team with no override. Those queries ran to the server-side default instead of the intended 60s, and because each one occupies a `clickhouse-proxy` slot for its whole run, a single browser tab polling a search page could saturate the proxy and make other users' queries fail. `getClickhouseClient` now applies `DEFAULT_QUERY_TIMEOUT` unless a caller supplies one, so the team override still wins where it is set.
