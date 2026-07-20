---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
"@hyperdx/app": patch
---

fix: route per-query SQL debug logging through an injectable logger (#2416)

`BaseClickhouseClient.logDebugQuery` dumped raw SQL to the console on every
ClickHouse query, unconditionally and outside the pino logger, flooding API
logs (and, via the browser SDK's consoleCapture, telemetry) with query spam.

Query logging is now silent by default and routed through an optional
per-client `customLogger` on `ClickhouseClientOptions` (the `Logger` interface
from `@clickhouse/client-common`). The app enables it in dev builds and in
local mode, where queries hit ClickHouse directly and the devtools console is
the only place to see them; anywhere else, pass a `customLogger` at the client
you're debugging.

`@hyperdx/api` is bumped without source changes: it bundles common-utils, so
its released images stop emitting the per-query dump.
