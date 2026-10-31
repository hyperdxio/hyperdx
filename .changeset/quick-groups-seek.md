---
'@hyperdx/api': patch
---

fix: Grouped alerts with many groups no longer slow down every alert check: the previous state of each group is read with one index seek per group instead of every history row of the last 7 days
