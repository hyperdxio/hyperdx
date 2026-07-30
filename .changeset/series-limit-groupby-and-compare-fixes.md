---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: Use ratio value for series-limit ranking in ratio mode

Charts using "ratio" series return type together with a series limit ranked the
top-N series by the bare numerator instead of by the plotted ratio, so a
low-volume group with a high ratio could lose its slot to a high-volume group
with a much lower ratio. The ranking now uses the same `divide(a, b)` expression
the chart displays. Non-ratio charts generate identical SQL to before.
