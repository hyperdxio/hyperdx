---
'@hyperdx/app': patch
---

Fix the alert preview chart highlighting the region below the threshold for "above" alerts. Recharts v3 flipped the default edge for open-ended reference areas, so "above" and "not between" alerts shaded the wrong side of the threshold line.
