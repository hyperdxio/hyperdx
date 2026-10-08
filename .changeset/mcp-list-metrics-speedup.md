---
'@hyperdx/api': patch
---

perf(mcp): speed up `clickstack_list_metrics` and give the metric discovery
tools a 30s budget

`clickstack_list_metrics` now scans metric names only (about 9x fewer bytes read
per kind), fetches unit and description just for the returned page, and scans
kinds in parallel. When the time budget runs out it returns the kinds that
finished, reports the rest in `partialFailure`, and returns a `nextCursor` that
resumes at the timed-out kind instead of failing the whole call. It also no
longer drops later kinds when one kind exactly fills a page.
`clickstack_list_metrics` and `clickstack_describe_metric` now allow 30s instead
of 10s, matching the other MCP query tools.
