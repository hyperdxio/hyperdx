---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: MCP `event_patterns`, `emerging_signals` and search denoise, and the CLI,
no longer split the same log line by its date. The Drain miner masks timestamps,
UUIDs and long hex ids before mining (templates show `<TS>` and `<ID>`), so
dated lines from yesterday and today are one pattern instead of one "new" and
one "gone". The `event_patterns` drill-down predicate matches a masked timestamp
(which can span spaces) and a masked id, also inside a token. (The web app's
Event patterns view uses its own drain3 config and is unchanged.)
