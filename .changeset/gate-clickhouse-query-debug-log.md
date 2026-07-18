---
"@hyperdx/common-utils": patch
---

fix: make per-query SQL debug logging opt-in via HYPERDX_LOG_QUERIES (#2416)

`BaseClickhouseClient.logDebugQuery` dumped raw SQL to the console on every
ClickHouse query, unconditionally and outside the pino logger, flooding API
logs with query spam. It is now off by default; set `HYPERDX_LOG_QUERIES=true`
to enable it.
