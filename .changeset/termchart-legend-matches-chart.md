---
'@hyperdx/cli': patch
---

fix: stacked bar charts in `hdx` give palette colors to the largest series
first, list only series that are visible in the legend (with a count of the
rest), color a partial top cell by the series filling most of it, and separate
wide bars with a gap.
