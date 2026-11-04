---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: MCP `emerging_signals` mines both windows in one Drain tree, in a fixed
order (baseline first), and compares them by cluster, so a token that is
constant in one window and varies in the other no longer splits a pattern into
one "new" and one "gone". New messages that Drain merges into a baseline pattern
are reported as `new_variant`, so they aren't hidden by the merge. The baseline
window excludes its end, so a row at the boundary is counted once.
