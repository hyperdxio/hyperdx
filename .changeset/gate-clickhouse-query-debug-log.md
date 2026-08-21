---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: route per-query SQL debug logging through an injectable logger (#2416)

`BaseClickhouseClient` dumped raw SQL to the console on every ClickHouse query,
unconditionally and outside the pino logger, flooding API logs with query spam.

Query logging now goes through an optional per-client `customLogger` on
`ClickhouseClientOptions`, logged at `debug`, and is silent when no logger is
passed. The API injects a pino-backed logger, so query logging follows the
existing `HYPERDX_LOG_LEVEL` setting instead of writing to `console.debug`. The
browser client defaults to a console logger that pretty-prints the SQL as a
single multi-line block, so query SQL stays visible and readable in devtools in
all builds instead of wrapping into one long line.

The API's log level now defaults to `info` (was `debug`), so SQL logging is
silent in production unless `HYPERDX_LOG_LEVEL=debug` is set. Dev and CI env
files already pin their levels explicitly and are unaffected. The default also
now applies when `HYPERDX_LOG_LEVEL` is set but empty — which is what Compose
passes when the variable is unset in the environment, and which previously made
pino throw at startup.
