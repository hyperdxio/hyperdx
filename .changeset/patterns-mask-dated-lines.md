---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
---

fix: Event patterns and `emerging_signals` no longer split the same log line by its date. Drain masks timestamps, UUIDs and long hex ids before mining, and `emerging_signals` mines both windows in one tree and compares them by cluster, so dated lines from yesterday and today are one pattern instead of one "new" and one "gone"
