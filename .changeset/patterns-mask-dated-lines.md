---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/cli': patch
---

fix: MCP `event_patterns`, `emerging_signals` and search denoise, and the CLI,
no longer split the same log line by its date. Before mining, the Drain miner
masks the date of a timestamp (weekday, day, month, year) to `<DATE>`, so dated
lines from different days, months or years get the same template instead of one
"new" and one "gone". Times and ids are not masked. Within one day lines group
as before, except that klog lines with different severity letters are no longer
merged. No mask changes a line's token count: the `event_patterns` drill-down
predicate matches `<DATE>` as one or more non-whitespace characters, also inside
a token, and search denoise masks bodies the same way before matching. Masking
instructions get an optional `perWord` flag (default off, as in drain3). The web
app's Event patterns view uses its own drain3 config and is unchanged.
