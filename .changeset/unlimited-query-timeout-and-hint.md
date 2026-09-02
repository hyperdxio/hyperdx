---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: a team configured with an unlimited query timeout no longer gets the tightest bound instead of the loosest. `0` means "no limit", but the client omitted `max_execution_time` entirely for it — indistinguishable from a client that never set one, which the proxy has to bound with its default. The setting is now sent explicitly as `0`, so whatever enforces the bound can tell the difference and apply the ceiling rather than the default.

Search results now explain a query timeout instead of showing a bare SQL error. Hitting `max_execution_time` previously surfaced ClickHouse's raw `TIMEOUT_EXCEEDED` message, which does not suggest the fix; the error state now says the query was stopped and points at narrowing the range or raising the team's query timeout.
