---
'@hyperdx/api': patch
---

Bound `max_execution_time` on every query the `clickhouse-proxy` forwards. The setting arrives as a client-supplied URL parameter, so a client could send any value or omit it entirely — and omitting it meant the query ran to whatever the ClickHouse deployment allowed. Because each in-flight proxied query holds a slot on a tier shared by every team, one client polling with unbounded queries could saturate the proxy and fail other teams' queries. The proxy now applies `CLICKHOUSE_PROXY_DEFAULT_MAX_EXECUTION_TIME_SECONDS` (default 180) when the client sends no timeout, and caps anything above `CLICKHOUSE_PROXY_MAX_EXECUTION_TIME_SECONDS` (default 800, above the longest timeout a team can configure) so configured long-running queries still work. Note this bounds the URL setting only — ClickHouse also honours `SETTINGS max_execution_time` inside the SQL, so the hard bound remains a constraint on the ClickHouse user the proxy connects as.
