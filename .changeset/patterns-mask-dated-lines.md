---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: MCP `event_patterns`, `emerging_signals` and search denoise, and the CLI,
no longer split the same log line by its date. The Drain miner masks timestamps,
UUIDs and long hex ids before mining, and `emerging_signals` mines both windows
in one tree, in a fixed order, and compares them by cluster, so dated lines from
yesterday and today are one pattern instead of one "new" and one "gone". New
messages that merge into a baseline pattern are reported as `new_variant`. (The
web app's Event patterns view uses its own drain3 config and is unchanged.)
